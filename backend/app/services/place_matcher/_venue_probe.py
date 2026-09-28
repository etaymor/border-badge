"""Venue probe: a shared, rated lookup for nearby major venues (KTD3, U6).

A cluster inside the Louvre is ranked against whatever micro-POIs the
distance-ranked Nearby tiers find: exhibits, departments, kiosks. The museum's
single map point sits 85-255m away and is usually never fetched. The venue
probe is ONE Nearby call ranked by POPULARITY, restricted to major-venue types,
whose field mask carries ``rating``, ``userRatingCount`` and ``viewport`` so
the parent arrives already rated and with a footprint.

Isolation (KTD3) is the load-bearing property. Probe results are returned as a
separate per-cluster map and never join the first-pass candidates, the
backfill pool or the un-gated filler. Only the KTD4 roll-up (U7) reads them, so
while the roll-up does not fire, ``places`` is byte-identical with the probe on
or off.

Cost (R7): the request is centered on the centroid rounded to 3 decimals
(~110m), and the cache key is that cell plus a mask/version token, so every
cluster in the cell -- and every later user -- shares one cached call through
the same L1 -> L2 -> single-flight stack as the other searches.

This lives beside ``_matcher_search`` rather than inside it only to keep that
module from growing; it reuses its retry, slot and cache helpers unchanged.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

import httpx

from ._matcher_search import _cached_search, places_outbound_slot
from .cache import UncacheableResult
from .constants import (
    MAX_PLACES_PER_SEARCH,
    NEARBY_SEARCH_URL,
    VENUE_PROBE_CACHE_VERSION,
    VENUE_PROBE_FIELD_MASK,
    VENUE_PROBE_INCLUDED_TYPES,
    VENUE_PROBE_TRIGGER_HINTS,
    VENUE_PROBE_TRIGGER_TYPES,
)
from .exceptions import ConfigurationError
from .instrumentation import (
    METHOD_VENUE_PROBE,
    RETRY_SEARCH_TIMEOUT,
    SITE_VENUE_PROBE,
    record_retry,
    track_outbound,
)
from .rate_limit import retry_budget_scope, with_google_retry

logger = logging.getLogger(__name__)

# Settings fallbacks for a settings object that does not carry a well-typed
# value (a MagicMock stand-in in tests, an older partial object). The flag's
# fallback is OFF on purpose: Settings itself defaults it ON, but a stand-in
# that never heard of the probe must keep its pre-probe behavior and outbound
# call sequence.
_PROBE_FLAG_FALLBACK = False
_RADIUS_FALLBACK_M = 400

# Mask + included types + version: a change to any of them yields new keys.
_VENUE_PROBE_KEY_TOKEN = (
    VENUE_PROBE_CACHE_VERSION
    + "_"
    + hashlib.sha256(
        (
            VENUE_PROBE_FIELD_MASK + "|" + ",".join(sorted(VENUE_PROBE_INCLUDED_TYPES))
        ).encode()
    ).hexdigest()[:8]
)


def _guarded(settings: Any, name: str, default: Any, types: type | tuple) -> Any:
    """Read a setting, falling back on a missing or wrong-typed value.

    Same contract as ``_guarded_setting`` in ``_matcher_cluster_processing``;
    repeated here so this module does not import the orchestrator. ``bool`` is
    excluded from numeric reads because it subclasses ``int``.
    """
    value = getattr(settings, name, default)
    if isinstance(value, bool) and bool not in (
        types if isinstance(types, tuple) else (types,)
    ):
        return default
    return value if isinstance(value, types) else default


def venue_probe_enabled(settings: Any) -> bool:
    """Whether the venue probe runs (``places_venue_probe``)."""
    return bool(_guarded(settings, "places_venue_probe", _PROBE_FLAG_FALLBACK, bool))


def venue_probe_radius(settings: Any) -> int:
    """The probe radius in meters (``places_venue_probe_radius_m``)."""
    radius = _guarded(
        settings, "places_venue_probe_radius_m", _RADIUS_FALLBACK_M, (int, float)
    )
    return int(radius) if radius > 0 else _RADIUS_FALLBACK_M


def venue_probe_cell(latitude: float, longitude: float) -> tuple[float, float]:
    """The ~110m cell a centroid falls in (coordinates rounded to 3 decimals)."""
    return round(latitude, 3), round(longitude, 3)


def venue_probe_cache_key(latitude: float, longitude: float, radius: int) -> str:
    """Cache key for one venue probe.

    ``venue_`` never collides with the legacy popularity probe's ``pop_`` keys
    or with the ``nearby_`` / ``text_`` keys, and the token changes with the
    mask, the included types and the version, so an old-shape row (e.g. one
    without ratings) is never read back as a rated one.
    """
    lat, lng = venue_probe_cell(latitude, longitude)
    return f"venue_{_VENUE_PROBE_KEY_TOKEN}_{lat:.3f}_{lng:.3f}_{int(radius)}"


def _hint_label(hint: Any) -> str | None:
    """Normalize one scene hint (a label string, or a mapping/object with one)."""
    if isinstance(hint, str):
        return hint
    if isinstance(hint, Mapping):
        label = hint.get("label", hint.get("name"))
    else:
        label = getattr(hint, "label", None)
    return label if isinstance(label, str) else None


def should_probe_venue(
    candidates: Iterable[Mapping[str, Any]],
    scene_hints: Sequence[Any] | None = None,
) -> bool:
    """Decide whether a cluster gets a venue probe. Density plays no part.

    Fires when either holds:

    * a local candidate (from the rings already searched) carries a museum,
      landmark or attraction-family type anywhere in its ``types``;
    * an on-device scene hint says ``museum_interior`` or ``artwork``.

    ``scene_hints`` is the KTD6 per-cluster hint list: label strings or
    ``{"label": ..., "weight": ...}`` items. Clients that predate the hints
    send none (``None``), which leaves only the candidate branch.
    """
    for hint in scene_hints or ():
        if _hint_label(hint) in VENUE_PROBE_TRIGGER_HINTS:
            return True
    for place in candidates:
        types = set(place.get("types") or ())
        primary = place.get("primaryType")
        if primary:
            types.add(primary)
        if types & VENUE_PROBE_TRIGGER_TYPES:
            return True
    return False


class VenueProbeMixin:
    """The venue-probe call and its per-cluster fan-out (SearchMixin-side)."""

    async def _execute_venue_probe(
        self, latitude: float, longitude: float
    ) -> list[dict]:
        """One POPULARITY venue probe for the cell containing a centroid.

        The request is centered on the ROUNDED cell, not the raw centroid, so
        the cached answer is exactly the answer for every cluster that shares
        the key. A rate limit is retried with jittered backoff (U3); a timeout
        or transport error on this optional call is not re-paid and degrades to
        ``[]``; a non-200 degrades to ``[]`` without being cached. Permanently
        closed places are dropped (the review floor is the ordinary one).
        """
        lat, lng = venue_probe_cell(latitude, longitude)
        places = await with_google_retry(
            lambda: self._execute_venue_probe_once(lat, lng),
            site=SITE_VENUE_PROBE,
            retry_on_timeout=False,
        )
        if not places:
            return []
        return self._filter_low_quality_places(places)  # type: ignore[attr-defined]

    async def _execute_venue_probe_once(
        self, latitude: float, longitude: float
    ) -> list[dict]:
        """One venue-probe attempt. See :meth:`_execute_venue_probe`."""
        settings = self._settings  # type: ignore[attr-defined]
        if not settings.google_places_api_key:
            raise ConfigurationError("Google Places API key not configured")
        radius = venue_probe_radius(settings)
        cache_key = venue_probe_cache_key(latitude, longitude, radius)

        async def fetch_from_api() -> list[dict]:
            # U7: process-wide slot around the outbound call only.
            async with places_outbound_slot():
                with track_outbound(METHOD_VENUE_PROBE):
                    response = await self._client.post(  # type: ignore[attr-defined]
                        NEARBY_SEARCH_URL,
                        json={
                            "maxResultCount": MAX_PLACES_PER_SEARCH,
                            "rankPreference": "POPULARITY",
                            "locationRestriction": {
                                "circle": {
                                    "center": {
                                        "latitude": latitude,
                                        "longitude": longitude,
                                    },
                                    "radius": radius,
                                }
                            },
                            "includedTypes": VENUE_PROBE_INCLUDED_TYPES,
                        },
                        headers={
                            "Content-Type": "application/json",
                            "X-Goog-Api-Key": settings.google_places_api_key,
                            "X-Goog-FieldMask": VENUE_PROBE_FIELD_MASK,
                        },
                    )

            self._raise_if_rate_limited(response)  # type: ignore[attr-defined]

            if response.status_code != 200:
                logger.warning(f"Venue probe API error: status={response.status_code}")
                # Degraded, not knowledge: never write a transient fault through
                # to the 60-day L2 (see cache.UncacheableResult).
                raise UncacheableResult([])

            places = response.json().get("places", [])
            # R27: coordinates only at the diagnostics gate.
            if settings.places_diagnostics is True:
                logger.info(
                    f"Venue probe at ({latitude:.3f}, {longitude:.3f}) "
                    f"radius={radius}m: found {len(places)} places"
                )
            return places

        try:
            return await _cached_search(cache_key, fetch_from_api)
        except httpx.PoolTimeout:
            # Local pool saturation, not a slow upstream (see _execute_search).
            logger.warning("Places connection pool saturated; venue probe skipped")
            return []
        except httpx.TimeoutException:
            record_retry(RETRY_SEARCH_TIMEOUT)
            logger.warning("Venue probe timed out; continuing without it")
            return []
        except httpx.RequestError as e:
            logger.warning(f"Venue probe request failed: {e}")
            return []

    async def _venue_probes_for_clusters(
        self,
        search_results: Sequence[tuple[dict[str, Any], list[dict], int]],
        *,
        semaphore: asyncio.Semaphore,
        remaining_budget: Callable[[], float],
        retry_budget: float,
        cluster_timeout: float,
        scene_hints_by_cluster: Mapping[str, Sequence[Any]] | None = None,
    ) -> dict[str, list[dict]]:
        """Run the venue probe for every eligible cluster; never raises.

        Returns ``{cluster_id: probe_places}`` for the clusters that triggered
        (``[]`` when the probe failed or found nothing); clusters that did not
        trigger are absent. Every failure -- timeout, rate limit, circuit
        breaker, slot, anything -- degrades that cluster's entry to ``[]``: the
        probe is an optional ranking input and must never fail a cluster.

        ``scene_hints_by_cluster`` is the U9 wiring point for on-device hints.
        """
        if not venue_probe_enabled(self._settings):  # type: ignore[attr-defined]
            return {}

        async def probe_one(cluster_id: str, lat: float, lng: float) -> list[dict]:
            # Request-budget dispatch gate (U8): an optional extra call is the
            # first thing to skip once the budget is spent.
            if remaining_budget() <= 0:
                logger.warning("Request budget spent; skipping a venue probe")
                return []
            async with semaphore:
                if remaining_budget() <= 0:
                    logger.warning("Request budget spent; skipping a venue probe")
                    return []
                try:
                    with retry_budget_scope(retry_budget):
                        return await asyncio.wait_for(
                            self._execute_venue_probe(lat, lng),
                            timeout=cluster_timeout,
                        )
                except TimeoutError:
                    logger.warning(
                        f"Venue probe timed out after {cluster_timeout}s; skipped"
                    )
                except Exception as e:  # never fail a cluster on the probe
                    # R27: no cluster id or coordinate on an always-on line.
                    logger.warning(f"Venue probe unavailable ({type(e).__name__})")
                return []

        cluster_ids: list[str] = []
        tasks = []
        for cluster, nearby_places, _radius_used in search_results:
            cluster_id = cluster["id"]
            hints = (scene_hints_by_cluster or {}).get(cluster_id)
            if not should_probe_venue(nearby_places, hints):
                continue
            cluster_ids.append(cluster_id)
            lat, lng = venue_probe_cell(
                cluster["centroid"]["latitude"], cluster["centroid"]["longitude"]
            )
            tasks.append(probe_one(cluster_id, lat, lng))
        if not tasks:
            return {}

        results = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            cluster_id: (result if isinstance(result, list) else [])
            for cluster_id, result in zip(cluster_ids, results, strict=True)
        }
