"""Search and filtering logic for PlaceMatcher."""

import asyncio
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from .cache import places_cache
from .constants import (
    DENSITY_SEARCH_RADII,
    DENSITY_THRESHOLD_DENSE,
    DENSITY_THRESHOLD_MEDIUM,
    ENRICH_FIELD_MASK,
    INSTITUTIONAL_TYPES,
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_PLACES_PER_SEARCH,
    NEARBY_SEARCH_URL,
    NON_TOURIST_TYPES,
    PLACE_DETAILS_URL,
    SEARCH_RADII_METERS,
    SEARCHABLE_PLACE_TYPES,
    TEXT_SEARCH_URL,
    TYPE_TO_CATEGORY,
    WIDE_FIELD_MASK,
    DensityLevel,
)
from .exceptions import ConfigurationError, QuotaExhaustedError, RateLimitError
from .instrumentation import (
    METHOD_NEARBY,
    METHOD_PLACE_DETAILS,
    METHOD_POPULARITY_PROBE,
    METHOD_TEXT_SEARCH,
    RETRY_QUOTA_EXHAUSTED,
    RETRY_RATE_LIMITED,
    RETRY_SEARCH_TIMEOUT,
    SITE_ENRICHMENT,
    SITE_NEARBY,
    SITE_POPULARITY_PROBE,
    SITE_TEXT_SEARCH,
    SOURCE_API,
    SOURCE_L2,
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
from .rate_limit import budget_seconds_for, retry_budget_scope, with_google_retry

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

            if response.status_code == 429:
                # Parse response to differentiate rate limit vs quota exhaustion
                # Google returns error details in the response body
                error_reason = self._parse_error_reason(response)
                if error_reason == "QUOTA_EXCEEDED":
                    record_retry(RETRY_QUOTA_EXHAUSTED)
                    logger.error("Google Places API quota exhausted (daily limit)")
                    raise QuotaExhaustedError("Daily quota exceeded")
                else:
                    record_retry(RETRY_RATE_LIMITED)
                    logger.warning("Google Places API rate limited (temporary)")
                    raise RateLimitError("Rate limit exceeded")

            if response.status_code != 200:
                # Log error details for debugging (no PII in error responses)
                logger.error(
                    f"Google Places API error: status={response.status_code}, "
                    f"body={response.text[:500]}"
                )
                return []

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
                    f"  [{i+1}] {name} | type={primary_type} | "
                    f"rating={rating} | reviews={review_count}"
                )
            return places

        try:
            # Use single-flight pattern to prevent cache stampedes.
            # Persistent L2 (Postgres) sits behind the in-memory L1 so popular
            # locations survive deploys and are shared across instances/users.
            return await places_cache.get_or_fetch(
                cache_key,
                fetch_from_api,
                l2_get=get_search_cache,
                l2_set=set_search_cache,
                on_source=record_cache_lookup,
            )

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

            if response.status_code == 429:
                error_reason = self._parse_error_reason(response)
                if error_reason == "QUOTA_EXCEEDED":
                    record_retry(RETRY_QUOTA_EXHAUSTED)
                    raise QuotaExhaustedError("Daily quota exceeded")
                record_retry(RETRY_RATE_LIMITED)
                raise RateLimitError("Rate limit exceeded")

            if response.status_code != 200:
                logger.warning(f"Text Search API error: status={response.status_code}")
                return []

            places = response.json().get("places", [])
            logger.info(f"Text Search for '{text_query}': found {len(places)} places")
            return places

        try:
            return await places_cache.get_or_fetch(
                cache_key,
                fetch_from_api,
                l2_get=get_search_cache,
                l2_set=set_search_cache,
                on_source=record_cache_lookup,
            )
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

            if response.status_code == 429:
                error_reason = self._parse_error_reason(response)
                if error_reason == "QUOTA_EXCEEDED":
                    record_retry(RETRY_QUOTA_EXHAUSTED)
                    raise QuotaExhaustedError("Daily quota exceeded")
                record_retry(RETRY_RATE_LIMITED)
                raise RateLimitError("Rate limit exceeded")

            if response.status_code != 200:
                logger.warning(
                    f"Popularity probe API error: status={response.status_code}"
                )
                return []

            places = response.json().get("places", [])
            # R27: coordinates only at the diagnostics gate (see _execute_search).
            if self._settings.places_diagnostics:
                logger.info(
                    f"Popularity probe at ({latitude:.4f}, {longitude:.4f}) "
                    f"radius={radius}m: found {len(places)} places"
                )
            return places

        try:
            return await places_cache.get_or_fetch(
                cache_key,
                fetch_from_api,
                l2_get=get_search_cache,
                l2_set=set_search_cache,
                on_source=record_cache_lookup,
            )
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

        # Bound concurrency to the same limit as the wide searches so a deep
        # finalist set never bursts past the API rate limit.
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_PLACES_REQUESTS)

        async def fetch_one(place_id: str) -> tuple[str, dict[str, Any]] | None:
            # Persistent by-ID cache stores full Place Details dicts; reuse the
            # rating fields when present to avoid a paid call.
            cached = await get_place_details_cache(place_id)
            if cached is not None and cached.get("userRatingCount") is not None:
                record_cache_lookup(SOURCE_L2)
                return place_id, {
                    "rating": cached.get("rating"),
                    "userRatingCount": cached.get("userRatingCount"),
                }

            record_cache_lookup(SOURCE_API)

            async def attempt() -> httpx.Response | None:
                # The semaphore is INSIDE the attempt so a backoff sleep
                # releases the slot instead of holding it idle while waiting.
                async with semaphore:
                    try:
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

                if response.status_code == 429:
                    reason = self._parse_error_reason(response)
                    if reason == "QUOTA_EXCEEDED":
                        record_retry(RETRY_QUOTA_EXHAUSTED)
                        raise QuotaExhaustedError("Daily quota exceeded")
                    record_retry(RETRY_RATE_LIMITED)
                    raise RateLimitError("Rate limit exceeded")

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
            except (RateLimitError, QuotaExhaustedError):
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
            return place_id, ratings

        # One retry budget for the whole enrichment fan-out. Tasks copy the
        # context but share the budget object, so the finalists cannot each
        # spend the full allowance.
        with retry_budget_scope(budget_seconds_for(self._settings)):
            results = await asyncio.gather(
                *[fetch_one(pid) for pid in place_ids],
                return_exceptions=True,
            )

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
