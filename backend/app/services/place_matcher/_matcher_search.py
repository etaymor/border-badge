"""Search and filtering logic for PlaceMatcher."""

import asyncio
import hashlib
import logging
import weakref
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import get_settings

from .cache import UncacheableResult, places_cache
from .constants import (
    DENSITY_SEARCH_RADII,
    DENSITY_THRESHOLD_DENSE,
    DENSITY_THRESHOLD_MEDIUM,
    ENRICH_FIELD_MASK,
    INSTITUTIONAL_TYPES,
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_CONCURRENT_PLACES_REQUESTS_PROCESS,
    MAX_PLACES_PER_SEARCH,
    NEARBY_SEARCH_URL,
    NON_TOURIST_TYPES,
    PLACE_DETAILS_URL,
    PLACES_SLOT_WAIT_CEILING_SECONDS,
    SEARCH_RADII_METERS,
    SEARCHABLE_PLACE_TYPES,
    TEXT_SEARCH_URL,
    TYPE_TO_CATEGORY,
    WIDE_FIELD_MASK,
    DensityLevel,
)
from .exceptions import (
    ConfigurationError,
    QuotaExhaustedError,
    RateLimitError,
    SlotUnavailableError,
)
from .instrumentation import (
    METHOD_NEARBY,
    METHOD_PLACE_DETAILS,
    METHOD_POPULARITY_PROBE,
    METHOD_TEXT_SEARCH,
    RETRY_QUOTA_EXHAUSTED,
    RETRY_RATE_LIMITED,
    RETRY_SEARCH_TIMEOUT,
    RETRY_SLOT_UNAVAILABLE,
    SITE_ENRICHMENT,
    SITE_NEARBY,
    SITE_POPULARITY_PROBE,
    SITE_TEXT_SEARCH,
    SOURCE_API,
    SOURCE_L2,
    SOURCE_SINGLE_FLIGHT,
    record_cache_lookup,
    record_dropped_ranking_input,
    record_retry,
    track_outbound,
)
from .persistent_cache import (
    get_place_details_cache,
    get_search_cache,
    set_place_details_cache,
    set_search_cache,
)
from .rate_limit import (
    budget_seconds_for,
    cluster_timeout_for,
    raise_if_circuit_open,
    retry_budget_scope,
    with_google_retry,
)

logger = logging.getLogger(__name__)


def _type_set_hash(types: list[str]) -> str:
    """Short, order-independent hash of an included-type set for cache keys.

    Two searches with the same set of ``includedTypes`` (regardless of order)
    share a cache entry; a narrowed set gets its own entry. Reserved for future
    per-cluster type narrowing — today every search uses the full
    ``SEARCHABLE_PLACE_TYPES`` set, so the hash is precomputed once below.
    """
    canonical = ",".join(sorted(types))
    return hashlib.sha256(canonical.encode()).hexdigest()[:8]


# Precomputed once: every Nearby/Text search currently uses the full type set, so
# there is no need to re-hash it on each (hot-path) search call.
_SEARCHABLE_TYPE_SET_HASH = _type_set_hash(SEARCHABLE_PLACE_TYPES)


# ---------------------------------------------------------------------------
# Bounded outbound concurrency (U7)
# ---------------------------------------------------------------------------


def _positive_int(value: Any) -> int | None:
    """Return ``value`` when it is a usable positive int, else None.

    Deliberately an ``isinstance`` check rather than ``int(value)``: a
    ``MagicMock`` settings stand-in coerces to 1 under ``int()``, which would
    silently pin the bound to 1 wherever settings are mocked.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 1 else None


# How many place-matching requests are currently in flight in this process.
# Plain int: asyncio is single-threaded here, and a uvicorn worker or replica
# is a separate process with its own count (exactly like the process-wide
# semaphore and the route's request-rate limit).
_in_flight_place_requests = 0


@contextmanager
def places_request_scope() -> Iterator[None]:
    """Register one in-flight place-matching request for the duration.

    Entered by :meth:`PlaceMatcher.find_places_for_clusters`. Its only job is to
    make :func:`resolve_places_concurrency` able to divide the process-wide
    ceiling by the number of callers competing for it (see there).
    """
    global _in_flight_place_requests
    _in_flight_place_requests += 1
    try:
        yield
    finally:
        _in_flight_place_requests -= 1


def in_flight_place_requests() -> int:
    """Number of place-matching requests currently registered in this process."""
    return _in_flight_place_requests


def resolve_places_concurrency(
    settings: Any | None = None,
    *,
    default_per_request: int = MAX_CONCURRENT_PLACES_REQUESTS,
) -> tuple[int, int]:
    """Return the ``(per_request, process_wide)`` Places concurrency bounds.

    Both come from settings and fall back to the module constants when the
    field is absent or unusable, so an older settings object degrades to
    today's behaviour rather than to an unbounded fan-out. The per-request
    bound is clamped to the process-wide ceiling: a misconfigured value must
    never let one caller hold every global slot.

    ADAPTIVE SHARE. The configured per-request bound is sized for ONE importing
    user (the planned client concurrency of 3 x 5 = the process ceiling of 15),
    which leaves a second concurrent importer nothing: six requests would want
    30 slots against 15, and the losers would burn the 2s slot-wait ceiling and
    surface as ``failed_cluster_count`` with no upstream fault anywhere. So the
    share is also divided by the number of requests registered via
    :func:`places_request_scope`, floored at 1. N importers then queue on their
    OWN (unbounded, charged-to-nobody) per-request semaphore and degrade evenly,
    instead of the first N x 5 winning every global slot and the rest failing.

    Outside a request scope (a direct call, a unit test) the count is 0 and the
    divisor is 1, so the bound is exactly the configured one.

    ``default_per_request`` lets a caller supply its own module-level fallback
    so the bound stays patchable where it is used.
    """
    if settings is None:
        settings = get_settings()

    per_request = (
        _positive_int(getattr(settings, "places_max_concurrent_requests", None))
        or default_per_request
    )
    process_wide = (
        _positive_int(getattr(settings, "places_max_concurrent_requests_process", None))
        or MAX_CONCURRENT_PLACES_REQUESTS_PROCESS
    )
    fair_share = max(1, process_wide // max(1, _in_flight_place_requests))
    return min(per_request, process_wide, fair_share), process_wide


# PER-PROCESS outbound bound, keyed by event loop so a semaphore is never
# awaited from a loop other than the one it was created on (each test gets its
# own loop), and rebuilt when the configured limit changes.
#
# NOTE: per *process*, exactly like the route's request-rate limit in
# `app.api.photos`. A uvicorn worker or replica added on either side multiplies
# BOTH the accepted request rate and this outbound fan-out, so capacity changes
# have to be reasoned about as one number.
_process_semaphores: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, tuple[int, asyncio.Semaphore]
] = weakref.WeakKeyDictionary()


def _get_process_semaphore(limit: int) -> asyncio.Semaphore:
    """Return the process-wide Places semaphore for the running loop."""
    loop = asyncio.get_running_loop()
    entry = _process_semaphores.get(loop)
    if entry is not None and entry[0] == limit:
        return entry[1]
    semaphore = asyncio.Semaphore(limit)
    _process_semaphores[loop] = (limit, semaphore)
    return semaphore


@asynccontextmanager
async def places_outbound_slot() -> AsyncIterator[None]:
    """Hold one process-wide slot for the duration of ONE outbound Google call.

    Placed around the outbound call ONLY. Wrapping the cached lookup instead
    would make pure cache hits and single-flight waiters consume global slots
    while doing no network work — throttling exactly the callers that cost
    nothing.

    Acquisition has its own short ceiling
    (:data:`PLACES_SLOT_WAIT_CEILING_SECONDS`) and raises
    :class:`SlotUnavailableError` when it expires, so a starved cluster fails
    fast and retryable instead of spending its whole per-cluster budget queuing
    and surfacing as an indistinguishable timeout.

    This is also where the rate-limit circuit breaker gates, for the SAME
    reason the slot is held here: at the retry wrapper the gate refused pure
    cache hits and single-flight waiters, which issue no network call at all —
    and the landmark rescue quantizes its bias center to ~110m precisely so
    many clusters share ONE cached paid search, making that refused-but-free
    fraction large.
    """
    raise_if_circuit_open()
    _, process_limit = resolve_places_concurrency()
    semaphore = _get_process_semaphore(process_limit)
    try:
        await asyncio.wait_for(
            semaphore.acquire(), timeout=PLACES_SLOT_WAIT_CEILING_SECONDS
        )
    except TimeoutError as e:
        # R27: static text only — no coordinate, cluster id, or place id.
        record_retry(RETRY_SLOT_UNAVAILABLE)
        logger.warning(
            "No Places outbound slot within %.1fs (process bound %d)",
            PLACES_SLOT_WAIT_CEILING_SECONDS,
            process_limit,
        )
        raise SlotUnavailableError(
            "No outbound Places slot available; try again shortly"
        ) from e
    try:
        yield
    finally:
        semaphore.release()


# Process-wide single-flight for finalist enrichment, keyed by event loop.
# Values map a Google place id to the in-flight lookup's future.
_details_in_flight_by_loop: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, dict[str, asyncio.Future[dict[str, Any] | None]]
] = weakref.WeakKeyDictionary()


def _details_in_flight() -> dict[str, asyncio.Future[dict[str, Any] | None]]:
    """Return the running loop's in-flight Place Details map."""
    loop = asyncio.get_running_loop()
    in_flight = _details_in_flight_by_loop.get(loop)
    if in_flight is None:
        in_flight = {}
        _details_in_flight_by_loop[loop] = in_flight
    return in_flight


async def _details_single_flight(
    place_id: str,
    fetch: Callable[[], Awaitable[dict[str, Any] | None]],
) -> dict[str, Any] | None:
    """Single-flight one place's Details lookup across the whole process (U7).

    The Nearby/Text search path has had single-flight since day one; the
    enrichment path had none, so two concurrent batches containing clusters at
    the same venue each bought the same (Enterprise-SKU) Place Details call.
    The first caller owns the lookup and the rest await its result.

    Owner failures resolve waiters with ``None`` rather than an exception:
    enrichment is best-effort, so a waiter degrades to the un-enriched
    first-pass ranking exactly as it would have on its own failure — and a
    future nobody awaits never logs a stray "exception was never retrieved".
    """
    in_flight = _details_in_flight()
    existing = in_flight.get(place_id)
    if existing is not None:
        record_cache_lookup(SOURCE_SINGLE_FLIGHT)
        try:
            return await existing
        except asyncio.CancelledError:
            current = asyncio.current_task()
            # Distinguish "the owner was cancelled" from "WE were cancelled".
            # Only the former is safe to recover from.
            if current is not None and current.cancelling() > 0:
                raise
            return await fetch()

    loop = asyncio.get_running_loop()
    future: asyncio.Future[dict[str, Any] | None] = loop.create_future()
    in_flight[place_id] = future
    try:
        result = await fetch()
    except asyncio.CancelledError:
        in_flight.pop(place_id, None)
        if not future.done():
            future.cancel()
        raise
    except BaseException:
        in_flight.pop(place_id, None)
        if not future.done():
            future.set_result(None)
        raise
    in_flight.pop(place_id, None)
    if not future.done():
        future.set_result(result)
    return result


async def _cached_search(
    cache_key: str, fetch: Callable[[], Awaitable[list[dict]]]
) -> list[dict]:
    """Run one search behind the shared L1 -> L2 -> single-flight cache stack.

    Every search-shaped call (Nearby, Text, popularity probe) goes through here
    so the three cannot drift apart on which layers they consult: the in-memory
    L1 fronts a persistent L2 (Postgres) so popular locations survive deploys
    and are shared across instances and users, single-flight prevents a stampede
    on a cold key, and ``record_cache_lookup`` attributes the hit to its source.
    """
    return await places_cache.get_or_fetch(
        cache_key,
        fetch,
        l2_get=get_search_cache,
        l2_set=set_search_cache,
        on_source=record_cache_lookup,
    )


@dataclass
class TieredSearchResult:
    """Result of a density-adaptive tiered Nearby search.

    Surfaces enough per-radius metadata for the diagnostic trace (U4) to dump
    the full pre-filter candidate world. The scalar fields are always populated
    (cheap); ``raw_places_per_radius`` is only retained when diagnostics is on,
    since holding the full raw world has a hot-path memory cost.
    """

    # Quality (filtered, deduped) places — the production search result.
    places: list[dict]
    # Largest radius that contributed a new quality candidate.
    radius_used: int
    # Every radius an _execute_search call was actually issued at.
    radii_searched: set[int] = field(default_factory=set)
    # Count of RAW (pre-filter) _execute_search results per radius.
    raw_count_per_radius: dict[int, int] = field(default_factory=dict)
    # Full raw places per radius (the diagnostic full-world dump). Empty unless
    # diagnostics is enabled, to avoid retaining the world on the hot path.
    raw_places_per_radius: dict[int, list[dict]] = field(default_factory=dict)
    # True when the search stopped on hitting the quality-result threshold
    # before exhausting the configured radii.
    stopped_early: bool = False
    # Detected area density (from the first-tier raw result count).
    density: DensityLevel = DensityLevel.SPARSE


class SearchMixin:
    """Search and filtering behaviors for PlaceMatcher."""

    @classmethod
    def _raise_if_rate_limited(
        cls, response: httpx.Response, *, log: bool = False
    ) -> None:
        """Translate a Google 429 into the exception it really is.

        Google answers BOTH a temporary rate limit and daily quota exhaustion
        with 429, and the two need opposite handling: a rate limit is worth
        retrying with jittered backoff, quota exhaustion is not (U3). Shared by
        every outbound site so a new call site cannot classify them differently.

        ``log`` is set only by the always-on Nearby path. The rescue, probe and
        enrichment paths degrade quietly to an un-rescued / un-enriched result,
        and their 429s are already counted by ``record_retry``.
        """
        if response.status_code != 429:
            return
        # Google returns the specific reason in the response body.
        if cls._parse_error_reason(response) == "QUOTA_EXCEEDED":
            record_retry(RETRY_QUOTA_EXHAUSTED)
            if log:
                logger.error("Google Places API quota exhausted (daily limit)")
            raise QuotaExhaustedError("Daily quota exceeded")
        record_retry(RETRY_RATE_LIMITED)
        if log:
            logger.warning("Google Places API rate limited (temporary)")
        raise RateLimitError("Rate limit exceeded")

    @staticmethod
    def _detect_density(result_count_at_first_radius: int) -> DensityLevel:
        """Detect area density from first-tier search result count.

        Thresholds are calibrated for type-filtered results (our 49
        SEARCHABLE_PLACE_TYPES), not raw unfiltered counts.
        """
        if result_count_at_first_radius >= DENSITY_THRESHOLD_DENSE:
            return DensityLevel.DENSE
        elif result_count_at_first_radius >= DENSITY_THRESHOLD_MEDIUM:
            return DensityLevel.MEDIUM
        else:
            return DensityLevel.SPARSE

    async def _search_nearby_tiered(
        self,
        latitude: float,
        longitude: float,
    ) -> TieredSearchResult:
        """
        Density-adaptive tiered radius search.

        First search at smallest radius detects density level, then expands
        through density-appropriate radii, ACCUMULATING quality candidates
        (deduped by place id) until the configured stop threshold
        (``places_min_quality_results_before_stop``) is reached or the tiers are
        exhausted. Stopping at the first non-empty tier capped recall: with
        typical indoor GPS drift the visited place is often one tier further out
        than the nearest match.

        Returns:
            A :class:`TieredSearchResult` carrying the quality places and
            per-radius metadata. The scalar fields are always populated; the
            full raw per-radius world (``raw_places_per_radius``) is only
            retained when ``places_diagnostics`` is enabled.
        """
        stop_threshold = self._settings.places_min_quality_results_before_stop
        diagnostics = self._settings.places_diagnostics

        # First search at smallest radius (always 15m for density detection).
        # Track every radius we've actually searched so later tiers never re-issue
        # a call at an already-searched radius (each Nearby call is a paid call).
        first_radius = SEARCH_RADII_METERS[0]
        searched_radii: set[int] = {first_radius}
        raw_count_per_radius: dict[int, int] = {}
        raw_places_per_radius: dict[int, list[dict]] = {}
        first_places = await self._execute_search(latitude, longitude, first_radius)
        raw_count_per_radius[first_radius] = len(first_places)
        if diagnostics:
            raw_places_per_radius[first_radius] = first_places

        # Detect density from raw result count (BEFORE quality filtering)
        density = self._detect_density(len(first_places))
        logger.debug(
            f"Density detection: {len(first_places)} results at "
            f"{first_radius}m -> {density.value}"
        )

        quality_places: list[dict] = []
        seen_place_ids: set[str] = set()
        radius_used = 0

        def absorb(places: list[dict], radius: int) -> None:
            nonlocal radius_used
            for place in self._filter_low_quality_places(places):
                place_id = place.get("id")
                if place_id in seen_place_ids:
                    continue
                seen_place_ids.add(place_id)
                quality_places.append(place)
                radius_used = radius

        def build(stopped_early: bool) -> TieredSearchResult:
            return TieredSearchResult(
                places=quality_places,
                radius_used=radius_used,
                radii_searched=searched_radii,
                raw_count_per_radius=raw_count_per_radius,
                raw_places_per_radius=raw_places_per_radius,
                stopped_early=stopped_early,
                density=density,
            )

        absorb(first_places, first_radius)
        if len(quality_places) >= stop_threshold:
            return build(stopped_early=True)

        # Expand through the density-appropriate radii, skipping any radius we've
        # already searched. (Filtering by value rather than slicing by position
        # also ensures a profile tier differing from the 15m probe is not
        # silently dropped.) An optional extra outer tier (C1/U12,
        # places_extra_search_tier_m) is appended last so a venue one tier past
        # the profile — pushed out by GPS drift — is still reachable when the
        # threshold has not been met. None preserves the current profiles.
        radii = list(DENSITY_SEARCH_RADII[density.value])
        extra_tier = self._settings.places_extra_search_tier_m
        if extra_tier is not None:
            radii.append(extra_tier)
        for radius in radii:
            if radius in searched_radii:
                continue
            searched_radii.add(radius)
            places = await self._execute_search(latitude, longitude, radius)
            raw_count_per_radius[radius] = len(places)
            if diagnostics:
                raw_places_per_radius[radius] = places
            if places:
                absorb(places, radius)
                if len(quality_places) >= stop_threshold:
                    return build(stopped_early=True)

        # Radii exhausted without reaching the threshold.
        return build(stopped_early=False)

    async def _execute_search(
        self,
        latitude: float,
        longitude: float,
        radius: float,
    ) -> list[dict]:
        """
        Execute a single Places API search with retry logic and caching.

        Retries both timeouts and upstream rate limits with jittered backoff
        (U3). The decorator this replaced retried on timeout ALONE, so a 429
        propagated out of the tiered search and failed the cluster outright.

        Args:
            latitude: Center latitude
            longitude: Center longitude
            radius: Search radius in meters

        Returns:
            List of place results
        """
        return await with_google_retry(
            lambda: self._execute_search_once(latitude, longitude, radius),
            site=SITE_NEARBY,
        )

    async def _execute_search_once(
        self,
        latitude: float,
        longitude: float,
        radius: float,
    ) -> list[dict]:
        """One Nearby search attempt (single-flight cached).

        Uses in-memory cache with truncated coordinates to avoid redundant API
        calls. See :meth:`_execute_search` for the retry policy wrapping this.
        """
        if not self._settings.google_places_api_key:
            logger.error("Google Places API key not configured")
            raise ConfigurationError("Google Places API key not configured")

        cache_key = places_cache.get_cache_key(
            latitude,
            longitude,
            int(radius),
            type_set_hash=_SEARCHABLE_TYPE_SET_HASH,
        )

        async def fetch_from_api() -> list[dict]:
            """Fetch places from Google Places API."""
            # U7: the process-wide slot is held around the outbound call only,
            # so an L1/L2 hit or a single-flight wait costs no global slot.
            async with places_outbound_slot():
                with track_outbound(METHOD_NEARBY):
                    response = await self._client.post(
                        NEARBY_SEARCH_URL,
                        json={
                            "maxResultCount": MAX_PLACES_PER_SEARCH,
                            "rankPreference": "DISTANCE",
                            "locationRestriction": {
                                "circle": {
                                    "center": {
                                        "latitude": latitude,
                                        "longitude": longitude,
                                    },
                                    "radius": radius,
                                }
                            },
                            "includedTypes": SEARCHABLE_PLACE_TYPES,
                        },
                        headers={
                            "Content-Type": "application/json",
                            "X-Goog-Api-Key": self._settings.google_places_api_key,
                            "X-Goog-FieldMask": WIDE_FIELD_MASK,
                        },
                    )

            self._raise_if_rate_limited(response, log=True)

            if response.status_code != 200:
                # Log error details for debugging (no PII in error responses)
                logger.error(
                    f"Google Places API error: status={response.status_code}, "
                    f"body={response.text[:500]}"
                )
                # Degrade to an empty result, but NEVER cache it: a 30s upstream
                # 503 must not become 60 days of "there is nothing here" for
                # every user (see cache.UncacheableResult).
                raise UncacheableResult([])

            response_json = response.json()
            places = response_json.get("places", [])
            # R27: coordinates never reach a default-level log line. The
            # per-call detail stays available behind the diagnostics gate; the
            # always-on view is the aggregate metrics line (U15).
            if self._settings.places_diagnostics:
                logger.info(
                    f"Places API at ({latitude:.4f}, {longitude:.4f}) "
                    f"radius={radius}m: found {len(places)} places"
                )
            # Log all places with their details for debugging
            for i, p in enumerate(places):
                name = p.get("displayName", {}).get("text", "N/A")
                primary_type = p.get("primaryType", "unknown")
                rating = p.get("rating", 0)
                review_count = p.get("userRatingCount", 0)
                logger.debug(
                    f"  [{i + 1}] {name} | type={primary_type} | "
                    f"rating={rating} | reviews={review_count}"
                )
            return places

        try:
            return await _cached_search(cache_key, fetch_from_api)

        except httpx.PoolTimeout:
            # Local pool saturation, not a slow upstream. Handled ahead of
            # TimeoutException (which it subclasses) so it is neither retried
            # nor counted as a Google search timeout -- counting it there would
            # inflate the upstream-latency metric with a purely local signal.
            logger.warning("Places connection pool saturated; search not issued")
            raise
        except httpx.TimeoutException:
            # Never log coordinates (PII) - use hash for debugging
            record_retry(RETRY_SEARCH_TIMEOUT)
            coord_hash = hashlib.sha256(
                f"{latitude:.4f},{longitude:.4f}".encode()
            ).hexdigest()[:8]
            logger.warning(
                f"Google Places API timeout at loc={coord_hash}, radius={radius}m"
            )
            raise
        except httpx.RequestError as e:
            logger.error(f"Google Places API request failed: {e}")
            return []

    async def _execute_text_search(
        self,
        text_query: str,
        latitude: float,
        longitude: float,
        radius: float = 200.0,
    ) -> list[dict]:
        """Search for a place by name using Google Places Text Search API.

        Used when vision detects readable business-name text on a sign/facade.
        Location bias centers results near the cluster centroid.
        Results are cached using the same single-flight cache as nearby search.

        Args:
            text_query: Business name text to search for
            latitude: Cluster centroid latitude for location bias
            longitude: Cluster centroid longitude for location bias
            radius: Location bias radius in meters (default 200m)

        A rate-limited text search is retried with jittered backoff rather than
        swallowed (U3): a throttled rescue used to fall through to the
        distance-ranked nearby results, letting a different place win with no
        failed cluster recorded anywhere.

        Returns:
            List of place results (same format as Nearby Search)
        """
        return await with_google_retry(
            lambda: self._execute_text_search_once(
                text_query, latitude, longitude, radius
            ),
            site=SITE_TEXT_SEARCH,
            # Transport failures (timeout / connection) are already absorbed
            # inside the attempt, which degrades to an empty rescue exactly as
            # before; only a rate limit reaches the retry loop.
            retry_on_timeout=False,
        )

    async def _execute_text_search_once(
        self,
        text_query: str,
        latitude: float,
        longitude: float,
        radius: float = 200.0,
    ) -> list[dict]:
        """One Text Search attempt. See :meth:`_execute_text_search`."""
        if not self._settings.google_places_api_key:
            raise ConfigurationError("Google Places API key not configured")

        # Cache key includes query text and truncated coordinates
        cache_key = f"text_{text_query}_{round(latitude, 5)}_{round(longitude, 5)}"

        async def fetch_from_api() -> list[dict]:
            # U7: process-wide slot around the outbound call only.
            async with places_outbound_slot():
                with track_outbound(METHOD_TEXT_SEARCH):
                    response = await self._client.post(
                        TEXT_SEARCH_URL,
                        json={
                            "textQuery": text_query,
                            "maxResultCount": MAX_PLACES_PER_SEARCH,
                            "locationBias": {
                                "circle": {
                                    "center": {
                                        "latitude": latitude,
                                        "longitude": longitude,
                                    },
                                    "radius": radius,
                                }
                            },
                        },
                        headers={
                            "Content-Type": "application/json",
                            "X-Goog-Api-Key": self._settings.google_places_api_key,
                            "X-Goog-FieldMask": WIDE_FIELD_MASK,
                        },
                    )

            self._raise_if_rate_limited(response)

            if response.status_code != 200:
                logger.warning(f"Text Search API error: status={response.status_code}")
                # Degraded, not knowledge: never write a transient fault through
                # to the 60-day L2 (see cache.UncacheableResult).
                raise UncacheableResult([])

            places = response.json().get("places", [])
            logger.info(f"Text Search for '{text_query}': found {len(places)} places")
            return places

        try:
            return await _cached_search(cache_key, fetch_from_api)
        except (httpx.TimeoutException, httpx.RequestError) as e:
            logger.warning(f"Text Search failed for '{text_query}': {e}")
            return []

    async def _execute_popularity_probe(
        self,
        latitude: float,
        longitude: float,
        radius: float = 200.0,
    ) -> list[dict]:
        """One Nearby call ranked by POPULARITY instead of DISTANCE (U6).

        Last-resort recovery for landmark clusters with no text signal: the
        distance-ranked tiers return whatever micro-POI sits nearest the photo
        GPS, while the actual venue's Google point can sit hundreds of meters
        away. Popularity ranking surfaces the prominent venue regardless.

        The cache key carries a ``pop_`` marker so POPULARITY results never
        collide with the DISTANCE-ranked Nearby entries at the same spot.

        A rate limit here is retried with jittered backoff (U3) rather than
        turned into a silent "no prominent venue nearby".
        """
        return await with_google_retry(
            lambda: self._execute_popularity_probe_once(latitude, longitude, radius),
            site=SITE_POPULARITY_PROBE,
            # Transport failures are absorbed inside the attempt (empty probe),
            # so only a rate limit reaches the retry loop.
            retry_on_timeout=False,
        )

    async def _execute_popularity_probe_once(
        self,
        latitude: float,
        longitude: float,
        radius: float = 200.0,
    ) -> list[dict]:
        """One POPULARITY probe attempt. See :meth:`_execute_popularity_probe`."""
        if not self._settings.google_places_api_key:
            raise ConfigurationError("Google Places API key not configured")

        cache_key = "pop_" + places_cache.get_cache_key(
            latitude,
            longitude,
            int(radius),
            type_set_hash=_SEARCHABLE_TYPE_SET_HASH,
        )

        async def fetch_from_api() -> list[dict]:
            # U7: process-wide slot around the outbound call only.
            async with places_outbound_slot():
                with track_outbound(METHOD_POPULARITY_PROBE):
                    response = await self._client.post(
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
                            "includedTypes": SEARCHABLE_PLACE_TYPES,
                        },
                        headers={
                            "Content-Type": "application/json",
                            "X-Goog-Api-Key": self._settings.google_places_api_key,
                            "X-Goog-FieldMask": WIDE_FIELD_MASK,
                        },
                    )

            self._raise_if_rate_limited(response)

            if response.status_code != 200:
                logger.warning(
                    f"Popularity probe API error: status={response.status_code}"
                )
                # Degraded, not knowledge: never write a transient fault through
                # to the 60-day L2 (see cache.UncacheableResult).
                raise UncacheableResult([])

            places = response.json().get("places", [])
            # R27: coordinates only at the diagnostics gate (see _execute_search).
            if self._settings.places_diagnostics:
                logger.info(
                    f"Popularity probe at ({latitude:.4f}, {longitude:.4f}) "
                    f"radius={radius}m: found {len(places)} places"
                )
            return places

        try:
            return await _cached_search(cache_key, fetch_from_api)
        except (httpx.TimeoutException, httpx.RequestError) as e:
            logger.warning(f"Popularity probe failed: {e}")
            return []

    async def _enrich_place_ratings(
        self,
        place_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        """Fetch live rating signals for a small set of finalist place IDs.

        The WIDE Nearby/Text Search omits ``rating``/``userRatingCount`` to keep
        that bulk call off the Enterprise SKU. The ranking still needs those
        signals for the handful of candidates that surface to the user, so they
        are fetched here via per-place Place Details calls — only for finalists.

        Best-effort: a failed or empty lookup is simply omitted from the result
        so the caller can fall back to the un-enriched first-pass ranking. The
        cross-user persistent by-ID cache is consulted first so a finalist that
        was enriched before (any user/deploy) costs nothing.

        A 429 used to land in the generic non-200 branch, so a throttled
        enrichment quietly removed rating and review count — two of the seven
        ranking weights — from the comparison. It is now recognised as a rate
        limit, retried with jittered backoff, and, if it still fails, counted as
        a dropped ranking input rather than an absent one (U3).

        Args:
            place_ids: Distinct Google place IDs to enrich.

        Returns:
            Mapping of place_id -> {"rating": float, "userRatingCount": int} for
            every ID that resolved. IDs that failed/missing are omitted.
        """
        if not self._settings.google_places_api_key or not place_ids:
            return {}

        # This request's SHARE of the global bound (U7). It bounds one request;
        # the process-wide ceiling is acquired inside, around the outbound call.
        per_request_limit, _ = resolve_places_concurrency(self._settings)
        semaphore = asyncio.Semaphore(per_request_limit)

        async def fetch_ratings(place_id: str) -> dict[str, Any] | None:
            """Owner path for one place: L2 lookup, else one paid Details call."""
            # Persistent by-ID cache stores full Place Details dicts; reuse the
            # rating fields when present to avoid a paid call.
            cached = await get_place_details_cache(place_id)
            if cached is not None and cached.get("userRatingCount") is not None:
                record_cache_lookup(SOURCE_L2)
                return {
                    "rating": cached.get("rating"),
                    "userRatingCount": cached.get("userRatingCount"),
                }

            record_cache_lookup(SOURCE_API)

            async def attempt() -> httpx.Response | None:
                # The semaphore is INSIDE the attempt so a backoff sleep
                # releases the slot instead of holding it idle while waiting.
                # Acquired outer-to-inner: this request's share first, then the
                # process-wide slot around the call itself.
                async with semaphore:
                    try:
                        async with places_outbound_slot():
                            with track_outbound(METHOD_PLACE_DETAILS):
                                response = await self._client.get(
                                    f"{PLACE_DETAILS_URL}/{place_id}",
                                    headers={
                                        "X-Goog-Api-Key": (
                                            self._settings.google_places_api_key
                                        ),
                                        "X-Goog-FieldMask": ENRICH_FIELD_MASK,
                                    },
                                )
                    except (httpx.TimeoutException, httpx.RequestError) as e:
                        # R27: the place id never reaches a default-level log line.
                        logger.warning(f"Rating enrichment request failed: {e}")
                        return None

                self._raise_if_rate_limited(response)

                if response.status_code != 200:
                    logger.warning(
                        f"Rating enrichment error: status={response.status_code}"
                    )
                    return None

                return response

            try:
                response = await with_google_retry(
                    attempt,
                    site=SITE_ENRICHMENT,
                    # Transport failures are absorbed inside the attempt; only a
                    # rate limit reaches the retry loop.
                    retry_on_timeout=False,
                )
            except (RateLimitError, QuotaExhaustedError, SlotUnavailableError):
                # Already counted as a dropped ranking input by the retry
                # wrapper. Degrade to the un-enriched first-pass ranking rather
                # than failing every other finalist in the batch.
                return None
            if response is None:
                record_dropped_ranking_input(SITE_ENRICHMENT)
                return None

            data = response.json()
            ratings = {
                "rating": data.get("rating"),
                "userRatingCount": data.get("userRatingCount"),
            }
            # Write rating fields through to the persistent by-ID cache so future
            # enrichments of this place (any user/deploy) skip the paid call.
            # set_place_details_cache merges onto any existing full-details blob,
            # so this preserves (and is preserved by) social-ingest writes.
            await set_place_details_cache(place_id, ratings)
            return ratings

        async def fetch_one(place_id: str) -> tuple[str, dict[str, Any]] | None:
            # Single-flight across the whole process: concurrent batches with
            # clusters at the same venue buy this place's details ONCE.
            ratings = await _details_single_flight(
                place_id, lambda: fetch_ratings(place_id)
            )
            if ratings is None:
                return None
            return place_id, ratings

        # One retry budget for the whole enrichment fan-out. Tasks copy the
        # context but share the budget object, so the finalists cannot each
        # spend the full allowance.
        #
        # And ONE wall-clock ceiling over the phase (U8). The retry budget only
        # caps *sleeping*; before this, enrichment opened a fresh budget with no
        # enclosing timeout, so the phase's real ceiling was however long Google
        # took, and the only thing that ever stopped it was the mobile client's
        # 90s timeout failing the whole chunk. Enrichment is best-effort by
        # design, so expiry degrades to the un-enriched first-pass ranking.
        with retry_budget_scope(budget_seconds_for(self._settings)):
            try:
                results = await asyncio.wait_for(
                    asyncio.gather(
                        *[fetch_one(pid) for pid in place_ids],
                        return_exceptions=True,
                    ),
                    timeout=cluster_timeout_for(self._settings),
                )
            except TimeoutError:
                # R27: static text only.
                logger.warning(
                    "Rating enrichment exceeded its phase budget; "
                    "falling back to un-enriched ranking"
                )
                for _ in place_ids:
                    record_dropped_ranking_input(SITE_ENRICHMENT)
                return {}

        enriched: dict[str, dict[str, Any]] = {}
        for r in results:
            if isinstance(r, tuple):
                enriched[r[0]] = r[1]
        return enriched

    @staticmethod
    def _parse_error_reason(response: httpx.Response) -> str | None:
        """
        Parse Google API error response to extract the error reason.

        Google Places API returns errors in this format:
        {
          "error": {
            "code": 429,
            "message": "...",
            "status": "RESOURCE_EXHAUSTED",
            "details": [{"reason": "RATE_LIMIT_EXCEEDED" or "QUOTA_EXCEEDED", ...}]
          }
        }

        Returns:
            Error reason string (e.g., "RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED") or None
        """
        try:
            error_body = response.json()
            error_info = error_body.get("error", {})

            # Check status first (most reliable)
            status = error_info.get("status", "")
            if status == "RESOURCE_EXHAUSTED":
                # Check details for specific reason
                details = error_info.get("details", [])
                for detail in details:
                    reason = detail.get("reason")
                    if reason in ("RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"):
                        return reason

                # Fallback: check message for hints
                message = error_info.get("message", "").lower()
                if "quota" in message or "daily" in message:
                    return "QUOTA_EXCEEDED"

            return None
        except Exception:
            return None

    def _filter_low_quality_places(
        self,
        places: list[dict[str, Any]],
        drop_counts: dict[str, int] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Filter out low-quality and non-tourist places.

        Filtering criteria (must pass ALL):
        - Not a non-tourist type (laundromats, gas stations, etc.)
        - Not permanently closed
        - Has a non-empty display name
        - Has at least ``places_min_review_count`` reviews (or is institutional)

        The review-count gate only applies when ``userRatingCount`` is present.
        The WIDE search pass omits rating fields (cost: they would force the
        Enterprise SKU), so those places have no review count yet and skip this
        gate here — it is re-applied after the finalists are enriched. Places that
        DO carry ``userRatingCount`` (enriched results, unit tests) are gated
        exactly as before.

        Args:
            places: Raw places from API response
            drop_counts: Optional mutable dict; when provided, per-reason drop
                tallies (``non_tourist``, ``closed``, ``no_name``,
                ``low_reviews``) are added in-place. Callers pass a fresh dict
                per phase so the diagnostic trace (U4) can attribute drops to the
                search vs. enrich pass. ``low_reviews`` is structurally 0 in the
                wide/search phase (no ``userRatingCount`` present), so a 0 there
                means "the gate could not fire", NOT "reviews never filter". The
                filtered result is identical whether or not this is passed.

        Returns:
            Filtered list of quality places
        """
        filtered = []
        counts = {"non_tourist": 0, "closed": 0, "no_name": 0, "low_reviews": 0}

        for place in places:
            display_name = place.get("displayName", {})
            name = display_name.get("text", "").strip()
            has_rating_count = place.get("userRatingCount") is not None
            rating_count = place.get("userRatingCount", 0) or 0
            business_status = place.get("businessStatus", "OPERATIONAL")
            primary_type = place.get("primaryType", "unknown")
            place_types = set(place.get("types", []))

            # Hard filter: non-tourist types. Drop on a non-tourist PRIMARY type,
            # but only drop on a non-tourist SECONDARY type when the primary type
            # is not itself clearly touristy — a museum housed in a historic bank
            # carries "bank" in its secondary types and must stay recallable.
            primary_category = TYPE_TO_CATEGORY.get(primary_type)
            primary_is_touristy = (
                primary_category is not None and primary_category != "place"
            )
            if primary_type in NON_TOURIST_TYPES or (
                place_types & NON_TOURIST_TYPES and not primary_is_touristy
            ):
                logger.debug(f"Filtered (non-tourist): {name} | type={primary_type}")
                counts["non_tourist"] += 1
                continue

            # Skip permanently closed
            if business_status == "CLOSED_PERMANENTLY":
                logger.debug(f"Filtered (closed): {name}")
                counts["closed"] += 1
                continue

            # Must have a non-empty name
            if not name:
                logger.debug(f"Filtered (no name): place_id={place.get('id')}")
                counts["no_name"] += 1
                continue

            # Must have enough reviews OR be an institutional type.
            # Skipped when the rating count is absent (wide pass) — deferred until
            # the finalist is enriched with live rating signals. The threshold is
            # config-driven (C3/U13, places_min_review_count); the constant is the
            # default. This gate re-applies to enriched finalists, so lowering it
            # keeps small/new real places that distance alone surfaced.
            min_review_count = self._settings.places_min_review_count
            is_institutional = primary_type in INSTITUTIONAL_TYPES
            if (
                is_institutional
                and primary_type in ("hotel", "resort_hotel")
                and has_rating_count
                and rating_count == 0
            ):
                # Aparthotel/OYO-style rental inventory surfaces with
                # primaryType=hotel and zero reviews. The institutional
                # exemption exists for legitimate small venues, not for
                # review-less listings — let the review gate judge them.
                is_institutional = False
            if (
                has_rating_count
                and rating_count < min_review_count
                and not is_institutional
            ):
                logger.debug(
                    f"Filtered (low reviews): {name} | type={primary_type} | "
                    f"reviews={rating_count} < {min_review_count}"
                )
                counts["low_reviews"] += 1
                continue

            filtered.append(place)

        logger.debug(
            f"Quality filter: {len(places)} -> {len(filtered)} places "
            f"(filtered {len(places) - len(filtered)})"
        )
        if drop_counts is not None:
            for reason, n in counts.items():
                drop_counts[reason] = drop_counts.get(reason, 0) + n
        return filtered
