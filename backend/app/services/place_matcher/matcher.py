"""PlaceMatcher class for matching photo clusters to nearby places."""

import asyncio
import hashlib
import logging
import math
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import get_settings

from .cache import places_cache
from .constants import (
    BAYESIAN_CONFIDENCE,
    BAYESIAN_PRIOR_MEAN,
    DENSITY_SEARCH_RADII,
    DENSITY_THRESHOLD_DENSE,
    DENSITY_THRESHOLD_MEDIUM,
    DWELL_BONUS_TIERS,
    FAME_FLOOR_REVIEWS,
    FAME_SCALE,
    FIELD_MASK,
    INSTITUTIONAL_TYPES,
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_PLACES_PER_SEARCH,
    MAX_SUGGESTIONS_PER_CLUSTER,
    MIN_REVIEW_COUNT,
    NEARBY_SEARCH_URL,
    NON_TOURIST_TYPES,
    SEARCH_RADII_METERS,
    SEARCHABLE_PLACE_TYPES,
    TIME_HINT_TYPE_MATCHES,
    TYPE_TO_CATEGORY,
    DensityLevel,
)
from .exceptions import ConfigurationError, QuotaExhaustedError, RateLimitError
from .utils import haversine, sanitize_address, sanitize_place_name

logger = logging.getLogger(__name__)


class PlaceMatcher:
    """
    Matches photo clusters to nearby places using Google Places API.

    Caller owns the httpx.AsyncClient lifecycle - use with `async with` pattern.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient,
    ) -> None:
        """
        Initialize the place matcher.

        Args:
            http_client: Async HTTP client (caller owns lifecycle)
        """
        self._client = http_client
        self._settings = get_settings()

    async def find_places_for_clusters(
        self, clusters: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Find place suggestions for photo clusters.

        Uses parallel execution with bounded concurrency to respect rate limits
        while improving performance for multiple clusters.

        Each cluster has a per-cluster timeout to prevent long-running requests
        from blocking when the semaphore queue is deep (e.g., 50 clusters with
        semaphore=5 means 45 waiting tasks).

        Args:
            clusters: List of cluster dicts with centroid and photos

        Returns:
            Tuple of (cluster_suggestions, failed_cluster_count)
        """
        logger.info(
            f"Processing {len(clusters)} clusters",
            extra={"cluster_ids": [c.get("id") for c in clusters]},
        )
        for c in clusters:
            logger.debug(
                f"Cluster {c.get('id')}: centroid=({c['centroid']['latitude']:.4f}, "
                f"{c['centroid']['longitude']:.4f}), photos={len(c.get('photos', []))}"
            )

        # Bounded concurrency to respect Google Places API rate limits
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_PLACES_REQUESTS)
        cluster_timeout = self._settings.places_cluster_timeout_seconds

        async def search_with_timeout(cluster: dict[str, Any]) -> dict[str, Any] | None:
            """Search for places with semaphore-bounded concurrency and timeout.

            The semaphore acquisition is inside the timeout so cluster_timeout
            covers both waiting for a slot and the search itself. This prevents
            tasks from waiting indefinitely when the semaphore queue is deep
            (e.g., 50 clusters with semaphore=5 means 45 waiting tasks).
            """

            async def inner() -> tuple[list[dict], int]:
                """Acquire semaphore and run search, releasing in finally."""
                await semaphore.acquire()
                try:
                    return await self._search_nearby_tiered(
                        latitude=cluster["centroid"]["latitude"],
                        longitude=cluster["centroid"]["longitude"],
                    )
                finally:
                    semaphore.release()

            try:
                places, radius_used = await asyncio.wait_for(
                    inner(),
                    timeout=cluster_timeout,
                )
            except TimeoutError:
                logger.warning(
                    f"Cluster search timed out after {cluster_timeout}s",
                    extra={"cluster_id": cluster.get("id")},
                )
                return None

            lat = cluster["centroid"]["latitude"]
            lng = cluster["centroid"]["longitude"]
            logger.info(
                f"Cluster {cluster['id']}: centroid=({lat:.5f}, {lng:.5f}), "
                f"found {len(places)} quality places at radius={radius_used}m"
            )

            # Places are already quality-filtered by _search_nearby_tiered
            ranked_places = self._rank_by_distance(
                places=places,
                cluster=cluster,
                time_hint=cluster.get("time_hint"),
            )

            # Always return cluster (with or without suggestions)
            # Empty places array allows UI to show "photo-only" cards for manual entry
            suggestions = (
                ranked_places[:MAX_SUGGESTIONS_PER_CLUSTER] if ranked_places else []
            )
            logger.info(
                f"Cluster {cluster['id']}: returning {len(suggestions)} suggestions"
                + (f", top={suggestions[0]['name']}" if suggestions else "")
            )
            return {
                "cluster_id": cluster["id"],
                "photo_ids": [p["asset_id"] for p in cluster.get("photos", [])],
                "places": suggestions,
            }

        # Execute all searches in parallel with bounded concurrency and per-cluster timeout
        results = await asyncio.gather(
            *[search_with_timeout(c) for c in clusters],
            return_exceptions=True,
        )

        # Filter out None results (timeouts) and exceptions (errors)
        # Note: Clusters with no places return empty places array, not None
        successful = [
            r for r in results if r is not None and not isinstance(r, BaseException)
        ]
        failed_count = sum(
            1 for r in results if r is None or isinstance(r, BaseException)
        )

        if failed_count > 0:
            logger.warning(
                f"Failed to process {failed_count}/{len(clusters)} clusters "
                "(timeouts or errors)"
            )

        return successful, failed_count

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
        # First search at smallest radius (always 15m for density detection)
        first_radius = SEARCH_RADII_METERS[0]
        first_places = await self._execute_search(
            latitude, longitude, first_radius
        )

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

        # Use density-adaptive radii for remaining tiers (skip first)
        remaining_radii = DENSITY_SEARCH_RADII[density.value][1:]
        for radius in remaining_radii:
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

        cache_key = places_cache.get_cache_key(latitude, longitude, int(radius))

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
                    "X-Goog-FieldMask": FIELD_MASK,
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
            # Use single-flight pattern to prevent cache stampedes
            return await places_cache.get_or_fetch(cache_key, fetch_from_api)

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
        places: list[dict],
    ) -> list[dict]:
        """
        Filter out low-quality and non-tourist places.

        Filtering criteria (must pass ALL):
        - Not a non-tourist type (laundromats, gas stations, etc.)
        - Not permanently closed
        - Has a non-empty display name
        - Has at least MIN_REVIEW_COUNT reviews (or is institutional)

        Args:
            places: Raw places from API response

        Returns:
            Filtered list of quality places
        """
        filtered = []

        for place in places:
            display_name = place.get("displayName", {})
            name = display_name.get("text", "").strip()
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

            # Must have enough reviews OR be an institutional type
            is_institutional = primary_type in INSTITUTIONAL_TYPES
            if rating_count < MIN_REVIEW_COUNT and not is_institutional:
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

    @staticmethod
    def _bayesian_rating(rating: float, review_count: int) -> float:
        """Shrink raw rating toward global mean based on review count.

        Places with few reviews collapse toward 3.8 (average).
        Places with many reviews keep their actual rating.

        Examples:
          4.8 stars, 5 reviews   -> 3.89
          4.2 stars, 500 reviews  -> 4.16
          4.5 stars, 2000 reviews -> 4.48
        """
        if not rating or review_count == 0:
            return BAYESIAN_PRIOR_MEAN
        return (review_count * rating + BAYESIAN_CONFIDENCE * BAYESIAN_PRIOR_MEAN) / (
            review_count + BAYESIAN_CONFIDENCE
        )

    @staticmethod
    def _fame_bonus(review_count: int) -> float:
        """Continuous fame signal with diminishing returns.

        Returns: 0.0 for <50 reviews, ~0.5 for 500, ~1.0 for 5000
        """
        if review_count < FAME_FLOOR_REVIEWS:
            return 0.0
        return max(
            0,
            (math.log10(review_count) - math.log10(FAME_FLOOR_REVIEWS)) * FAME_SCALE,
        )

    @staticmethod
    def _dwell_category_bonus(
        dwell_minutes: float | None,
        place_types: list[str],
        time_hint: str | None,
    ) -> float:
        """Dwell-tiered time bonus with category matching.

        Dwell time is a stronger signal than time-of-day.
        Category matching adds a soft bonus, never a hard filter.
        """
        bonus = 0.0

        # Dwell-based bonus
        if dwell_minutes is not None:
            for min_m, max_m, tier_bonus in DWELL_BONUS_TIERS:
                if min_m <= dwell_minutes < max_m:
                    bonus = tier_bonus
                    break

        # Time hint category match bonus (soft)
        if time_hint and time_hint in TIME_HINT_TYPE_MATCHES:
            matching_types = TIME_HINT_TYPE_MATCHES[time_hint]
            if any(t in matching_types for t in place_types):
                bonus += 0.3

        return bonus

    def _rank_by_distance(
        self,
        places: list[dict],
        cluster: dict,
        time_hint: str | None = None,
    ) -> list[dict]:
        """
        Rank places by enhanced scoring algorithm.

        Scoring: distance/20 - log10(reviews) - bayesian_rating_bonus
                 - fame - dwell_category_bonus

        Args:
            places: Places from API response
            cluster: Cluster with centroid and time data
            time_hint: Optional time hint (food/attraction/nightlife/quick_stop)

        Returns:
            List of place suggestions sorted by score (lower = better)
        """
        ranked = []
        cluster_lat = cluster["centroid"]["latitude"]
        cluster_lng = cluster["centroid"]["longitude"]

        # Compute dwell minutes from cluster time range
        dwell_minutes: float | None = None
        start_time = cluster.get("start_time")
        end_time = cluster.get("end_time")
        if start_time and end_time:
            # Handle both datetime objects and ISO strings
            if isinstance(start_time, str):
                from datetime import datetime

                start_time = datetime.fromisoformat(
                    start_time.replace("Z", "+00:00")
                )
                end_time = datetime.fromisoformat(
                    end_time.replace("Z", "+00:00")
                )
            dwell_ms = (end_time - start_time).total_seconds() * 1000
            dwell_minutes = dwell_ms / (1000 * 60)

        for place in places:
            place_loc = place.get("location", {})
            place_lat = place_loc.get("latitude", 0)
            place_lng = place_loc.get("longitude", 0)

            distance_m = haversine(cluster_lat, cluster_lng, place_lat, place_lng)

            # Map type to category
            primary_type = place.get("primaryType", "point_of_interest")
            category = TYPE_TO_CATEGORY.get(primary_type, "place")

            # Quality signals
            rating_count = place.get("userRatingCount", 0) or 0
            rating = place.get("rating", 0) or 0
            place_types = place.get("types", [])

            # Defensive access for displayName with sanitization
            display_name = place.get("displayName", {})
            raw_name = display_name.get("text", "") or "Unknown Place"
            raw_address = place.get("formattedAddress", "")

            ranked.append(
                {
                    "place_id": place["id"],
                    "name": sanitize_place_name(raw_name),
                    "address": sanitize_address(raw_address),
                    "location": {
                        "latitude": place_lat,
                        "longitude": place_lng,
                    },
                    "category": category,
                    "distance_m": round(distance_m, 1),
                    "types": place_types,
                    "_rating_count": rating_count,
                    "_rating": rating,
                    "_primary_type": primary_type,
                }
            )

        def sort_key(x: dict) -> float:
            distance_m = x["distance_m"]
            review_count = x["_rating_count"]
            r = x["_rating"]

            # Distance penalty: 1 point per 20m bucket (unchanged)
            distance_penalty = distance_m / 20.0

            # Review bonus: log scale (unchanged)
            review_bonus = math.log10(max(review_count, 1) + 1)

            # Rating bonus: Bayesian-adjusted
            adj_rating = self._bayesian_rating(r, review_count)
            rating_bonus = max(0, (adj_rating - BAYESIAN_PRIOR_MEAN) * 0.75)

            # Fame bonus: continuous log scale
            fame = self._fame_bonus(review_count)

            # Dwell-aware category bonus
            dwell_cat = self._dwell_category_bonus(
                dwell_minutes, x["types"], time_hint
            )

            # Lower score = better rank
            return distance_penalty - review_bonus - rating_bonus - fame - dwell_cat

        ranked.sort(key=sort_key)

        # Remove internal fields before returning
        for r in ranked:
            del r["_rating_count"]
            del r["_rating"]
            del r["_primary_type"]

        return ranked

    # Keep static method for backward compatibility with tests
    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Backward-compatible wrapper for haversine function."""
        return haversine(lat1, lon1, lat2, lon2)
