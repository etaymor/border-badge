"""Search and filtering logic for PlaceMatcher."""

import asyncio
import hashlib
import logging
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .cache import places_cache
from .constants import (
    DENSITY_SEARCH_RADII,
    DENSITY_THRESHOLD_DENSE,
    DENSITY_THRESHOLD_MEDIUM,
    ENRICH_FIELD_MASK,
    INSTITUTIONAL_TYPES,
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_PLACES_PER_SEARCH,
    MIN_REVIEW_COUNT,
    NEARBY_SEARCH_URL,
    NON_TOURIST_TYPES,
    PLACE_DETAILS_URL,
    SEARCH_RADII_METERS,
    SEARCHABLE_PLACE_TYPES,
    TEXT_SEARCH_URL,
    WIDE_FIELD_MASK,
    DensityLevel,
)
from .exceptions import ConfigurationError, QuotaExhaustedError, RateLimitError
from .persistent_cache import (
    get_place_details_cache,
    get_search_cache,
    set_place_details_cache,
    set_search_cache,
)

logger = logging.getLogger(__name__)


def _type_set_hash(types: list[str]) -> str:
    """Short, order-independent hash of an included-type set for cache keys.

    Two searches with the same set of ``includedTypes`` (regardless of order)
    share a cache entry; a narrowed set gets its own entry.
    """
    canonical = ",".join(sorted(types))
    return hashlib.sha256(canonical.encode()).hexdigest()[:8]


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
    ) -> tuple[list[dict], int]:
        """
        Density-adaptive tiered radius search.

        First search at smallest radius detects density level, then uses
        density-appropriate radii for subsequent tiers.

        Returns:
            Tuple of (quality_places, radius_used)
        """
        # First search at smallest radius (always 15m for density detection).
        # Track every radius we've actually searched so later tiers never re-issue
        # a call at an already-searched radius (each Nearby call is Enterprise-tier).
        first_radius = SEARCH_RADII_METERS[0]
        searched_radii: set[int] = {first_radius}
        first_places = await self._execute_search(latitude, longitude, first_radius)

        # Detect density from raw result count (BEFORE quality filtering)
        density = self._detect_density(len(first_places))
        logger.debug(
            f"Density detection: {len(first_places)} results at "
            f"{first_radius}m -> {density.value}"
        )

        # Quality-filter the first tier results
        if first_places:
            quality_places = self._filter_low_quality_places(first_places)
            if quality_places:
                return quality_places, first_radius
            logger.debug(
                f"Radius {first_radius}m: {len(first_places)} places found "
                f"but 0 passed quality filter, expanding"
            )

        # Expand through the density-appropriate radii, skipping any radius we've
        # already searched. (Filtering by value rather than slicing by position
        # also ensures the sparse profile's smallest tier — which differs from the
        # 15m probe — is not silently dropped.)
        for radius in DENSITY_SEARCH_RADII[density.value]:
            if radius in searched_radii:
                continue
            searched_radii.add(radius)
            places = await self._execute_search(latitude, longitude, radius)
            if places:
                quality_places = self._filter_low_quality_places(places)
                if quality_places:
                    return quality_places, radius
                logger.debug(
                    f"Radius {radius}m: {len(places)} places found but "
                    f"0 passed quality filter, expanding"
                )

        return [], 0

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=5),
        retry=retry_if_exception_type(httpx.TimeoutException),
        reraise=True,
    )
    async def _execute_search(
        self,
        latitude: float,
        longitude: float,
        radius: float,
    ) -> list[dict]:
        """
        Execute a single Places API search with retry logic and caching.

        Uses in-memory cache with truncated coordinates to avoid redundant API calls.

        Args:
            latitude: Center latitude
            longitude: Center longitude
            radius: Search radius in meters

        Returns:
            List of place results
        """
        if not self._settings.google_places_api_key:
            logger.error("Google Places API key not configured")
            raise ConfigurationError("Google Places API key not configured")

        cache_key = places_cache.get_cache_key(
            latitude,
            longitude,
            int(radius),
            type_set_hash=_type_set_hash(SEARCHABLE_PLACE_TYPES),
        )

        async def fetch_from_api() -> list[dict]:
            """Fetch places from Google Places API."""
            response = await self._client.post(
                NEARBY_SEARCH_URL,
                json={
                    "maxResultCount": MAX_PLACES_PER_SEARCH,
                    "rankPreference": "DISTANCE",
                    "locationRestriction": {
                        "circle": {
                            "center": {"latitude": latitude, "longitude": longitude},
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
                    logger.error("Google Places API quota exhausted (daily limit)")
                    raise QuotaExhaustedError("Daily quota exceeded")
                else:
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
            logger.info(
                f"Places API at ({latitude:.4f}, {longitude:.4f}) radius={radius}m: "
                f"found {len(places)} places"
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
            )

        except httpx.TimeoutException:
            # Never log coordinates (PII) - use hash for debugging
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

        Returns:
            List of place results (same format as Nearby Search)
        """
        if not self._settings.google_places_api_key:
            raise ConfigurationError("Google Places API key not configured")

        # Cache key includes query text and truncated coordinates
        cache_key = f"text_{text_query}_{round(latitude, 5)}_{round(longitude, 5)}"

        async def fetch_from_api() -> list[dict]:
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
                    raise QuotaExhaustedError("Daily quota exceeded")
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
            )
        except (httpx.TimeoutException, httpx.RequestError) as e:
            logger.warning(f"Text Search failed for '{text_query}': {e}")
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
                return place_id, {
                    "rating": cached.get("rating"),
                    "userRatingCount": cached.get("userRatingCount"),
                }

            async with semaphore:
                try:
                    response = await self._client.get(
                        f"{PLACE_DETAILS_URL}/{place_id}",
                        headers={
                            "X-Goog-Api-Key": self._settings.google_places_api_key,
                            "X-Goog-FieldMask": ENRICH_FIELD_MASK,
                        },
                    )
                except (httpx.TimeoutException, httpx.RequestError) as e:
                    logger.warning(f"Rating enrichment failed for {place_id}: {e}")
                    return None

            if response.status_code != 200:
                logger.warning(
                    f"Rating enrichment error for {place_id}: "
                    f"status={response.status_code}"
                )
                return None

            data = response.json()
            ratings = {
                "rating": data.get("rating"),
                "userRatingCount": data.get("userRatingCount"),
            }
            # Write rating fields through to the persistent by-ID cache so future
            # enrichments of this place (any user/deploy) skip the paid call.
            await set_place_details_cache(place_id, {**(cached or {}), **ratings})
            return place_id, ratings

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
    ) -> list[dict[str, Any]]:
        """
        Filter out low-quality and non-tourist places.

        Filtering criteria (must pass ALL):
        - Not a non-tourist type (laundromats, gas stations, etc.)
        - Not permanently closed
        - Has a non-empty display name
        - Has at least MIN_REVIEW_COUNT reviews (or is institutional)

        The review-count gate only applies when ``userRatingCount`` is present.
        The WIDE search pass omits rating fields (cost: they would force the
        Enterprise SKU), so those places have no review count yet and skip this
        gate here — it is re-applied after the finalists are enriched. Places that
        DO carry ``userRatingCount`` (enriched results, unit tests) are gated
        exactly as before.

        Args:
            places: Raw places from API response

        Returns:
            Filtered list of quality places
        """
        filtered = []

        for place in places:
            display_name = place.get("displayName", {})
            name = display_name.get("text", "").strip()
            has_rating_count = place.get("userRatingCount") is not None
            rating_count = place.get("userRatingCount", 0) or 0
            business_status = place.get("businessStatus", "OPERATIONAL")
            primary_type = place.get("primaryType", "unknown")
            place_types = set(place.get("types", []))

            # Hard filter: non-tourist types (check primary type AND all types)
            if primary_type in NON_TOURIST_TYPES or place_types & NON_TOURIST_TYPES:
                logger.debug(f"Filtered (non-tourist): {name} | type={primary_type}")
                continue

            # Skip permanently closed
            if business_status == "CLOSED_PERMANENTLY":
                logger.debug(f"Filtered (closed): {name}")
                continue

            # Must have a non-empty name
            if not name:
                logger.debug(f"Filtered (no name): place_id={place.get('id')}")
                continue

            # Must have enough reviews OR be an institutional type.
            # Skipped when the rating count is absent (wide pass) — deferred until
            # the finalist is enriched with live rating signals.
            is_institutional = primary_type in INSTITUTIONAL_TYPES
            if (
                has_rating_count
                and rating_count < MIN_REVIEW_COUNT
                and not is_institutional
            ):
                logger.debug(
                    f"Filtered (low reviews): {name} | type={primary_type} | "
                    f"reviews={rating_count} < {MIN_REVIEW_COUNT}"
                )
                continue

            filtered.append(place)

        logger.debug(
            f"Quality filter: {len(places)} -> {len(filtered)} places "
            f"(filtered {len(places) - len(filtered)})"
        )
        return filtered
