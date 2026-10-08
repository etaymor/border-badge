"""containingPlaces lookup for the venue roll-up tie-breaker (U8, KTD9).

Google's ``containingPlaces`` names the place a POI sits inside. U4's live
capture found it populated for Louvre exhibits (Mona Lisa, two departments) and
empty for the Pyramid and Le Cafe Marly, so it breaks ties the KTD4 roll-up
cannot settle on geometry and review counts alone; it never detects a parent.

Cost. The field is a Place Details **Pro** SKU field, so one lookup is one Pro
Details call (field mask ``id,containingPlaces``; it deliberately does not ride
the Enterprise rating enrichment, which covers every finalist). It is made only
for a cluster's TOP finalist, only when ``venue_rollup.containment_fetch_target``
says the answer could change the outcome, and the answer is cached in the
``cached_google_place.details`` JSON blob next to the rating fields. A row
without the ``containingPlaces`` key (every row written before U8) refetches
once; after that, including an empty answer (stored as ``[]``), it is served
from cache. No schema change.

Every failure degrades to "no answer", which leaves the U7 roll-up untouched.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable, Sequence
from typing import Any

import httpx

from ._matcher_search import _details_single_flight, places_outbound_slot
from ._venue_probe import _guarded
from .constants import PLACE_DETAILS_URL
from .exceptions import QuotaExhaustedError, RateLimitError, SlotUnavailableError
from .instrumentation import (
    METHOD_PLACE_DETAILS,
    SITE_VENUE_PROBE,
    SOURCE_API,
    SOURCE_L2,
    record_cache_lookup,
    track_outbound,
)
from .persistent_cache import get_place_details_cache, set_place_details_cache
from .rate_limit import with_google_retry

logger = logging.getLogger(__name__)

CONTAINING_PLACES_FIELD_MASK = "id,containingPlaces"
CONTAINING_PLACES_KEY = "containingPlaces"
# Separate single-flight namespace: the rating enrichment shares the map but
# resolves a different shape for the same place id.
_SINGLE_FLIGHT_PREFIX = "containing:"
# Off for a settings stand-in that never heard of the knob (keeps its outbound
# call sequence); Settings itself defaults it on.
_FLAG_FALLBACK = False


def containing_places_enabled(settings: Any) -> bool:
    """Whether the U8 tie-breaker may fetch (``places_rollup_containing_places``)."""
    return bool(
        _guarded(settings, "places_rollup_containing_places", _FLAG_FALLBACK, bool)
    )


def parse_containing_ids(value: Any) -> tuple[str, ...]:
    """Place ids from a ``containingPlaces`` list (``id``, else ``places/<id>``)."""
    ids: list[str] = []
    for entry in value if isinstance(value, list) else ():
        if not isinstance(entry, dict):
            continue
        place_id = entry.get("id")
        if not isinstance(place_id, str) or not place_id:
            name = entry.get("name")
            place_id = (
                name.removeprefix("places/")
                if isinstance(name, str) and name.startswith("places/")
                else None
            )
        if place_id and place_id not in ids:
            ids.append(place_id)
    return tuple(ids)


class ContainingPlacesMixin:
    """The containingPlaces fetch and its application to probed clusters."""

    async def _fetch_one_containing(self, place_id: str) -> tuple[str, ...] | None:
        """L2 lookup, else one paid Details (Pro) call. ``None`` = no answer."""
        cached = await get_place_details_cache(place_id)
        if cached is not None and CONTAINING_PLACES_KEY in cached:
            record_cache_lookup(SOURCE_L2)
            return parse_containing_ids(cached[CONTAINING_PLACES_KEY])
        record_cache_lookup(SOURCE_API)
        settings = self._settings  # type: ignore[attr-defined]

        async def attempt() -> httpx.Response | None:
            try:
                async with places_outbound_slot():
                    with track_outbound(METHOD_PLACE_DETAILS):
                        response = await self._client.get(  # type: ignore[attr-defined]
                            f"{PLACE_DETAILS_URL}/{place_id}",
                            headers={
                                "X-Goog-Api-Key": settings.google_places_api_key,
                                "X-Goog-FieldMask": CONTAINING_PLACES_FIELD_MASK,
                            },
                        )
            except (httpx.TimeoutException, httpx.RequestError) as e:
                logger.warning(f"containingPlaces request failed: {e}")
                return None
            self._raise_if_rate_limited(response)  # type: ignore[attr-defined]
            if response.status_code != 200:
                logger.warning(f"containingPlaces error: status={response.status_code}")
                return None
            return response

        try:
            response = await with_google_retry(
                attempt, site=SITE_VENUE_PROBE, retry_on_timeout=False
            )
        except (RateLimitError, QuotaExhaustedError, SlotUnavailableError):
            return None
        if response is None:
            return None
        ids = parse_containing_ids(response.json().get(CONTAINING_PLACES_KEY))
        # Merged onto the rating row; an empty answer is cached as [] so the
        # place is never re-bought.
        await set_place_details_cache(
            place_id, {CONTAINING_PLACES_KEY: [{"id": i} for i in ids]}
        )
        return ids

    async def _fetch_containing_places(
        self, place_ids: Iterable[str], *, timeout: float | None = None
    ) -> dict[str, tuple[str, ...]]:
        """``{place_id: containing ids}`` for the ids that resolved. Never raises."""
        unique = list(dict.fromkeys(pid for pid in place_ids if pid))
        if not unique or not getattr(
            self._settings,  # type: ignore[attr-defined]
            "google_places_api_key",
            None,
        ):
            return {}

        async def one(pid: str) -> tuple[str, ...] | None:
            return await _details_single_flight(
                _SINGLE_FLIGHT_PREFIX + pid, lambda: self._fetch_one_containing(pid)
            )

        try:
            results = await asyncio.wait_for(
                asyncio.gather(*(one(p) for p in unique), return_exceptions=True),
                timeout=timeout,
            )
        except Exception as e:  # never fail a cluster on the tie-breaker
            logger.warning(f"containingPlaces unavailable ({type(e).__name__})")
            return {}
        return {
            pid: result
            for pid, result in zip(unique, results, strict=True)
            if isinstance(result, tuple)
        }

    async def _apply_containment_tiebreaks(
        self,
        pending: Sequence[tuple[dict[str, Any], str, Any]],
        *,
        timeout: float | None = None,
    ) -> list[tuple[dict[str, Any], Any]]:
        """Re-run the roll-up for clusters whose top finalist Google places
        inside a probe parent.

        ``pending`` holds ``(result_entry, top_place_id, rerun)`` where
        ``rerun(containing_place_ids=...)`` returns ``(places, decision)``.
        Entries whose roll-up changed get their ``places`` replaced; the
        ``(entry, decision)`` pairs that changed are returned for tracing.
        """
        if not pending:
            return []
        try:
            containing = await self._fetch_containing_places(
                [top for _entry, top, _rerun in pending], timeout=timeout
            )
        except Exception as e:  # belt and braces: the fetch already never raises
            logger.warning(f"containingPlaces unavailable ({type(e).__name__})")
            return []
        changed: list[tuple[dict[str, Any], Any]] = []
        for entry, top, rerun in pending:
            ids = containing.get(top)
            if not ids:
                continue
            places, decision = rerun(containing_place_ids=ids)
            if decision.rolled_up:
                entry["places"] = places
                changed.append((entry, decision))
        return changed
