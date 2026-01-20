"""PlaceMatcher class for matching photo clusters to nearby places."""

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

from app.core.config import get_settings

from .cache import places_cache
from .constants import (
    FIELD_MASK,
    INSTITUTIONAL_TYPES,
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_PLACES_PER_SEARCH,
    MAX_SUGGESTIONS_PER_CLUSTER,
    MIN_REVIEW_COUNT,
    NEARBY_SEARCH_URL,
    SEARCH_RADII_METERS,
    SEARCHABLE_PLACE_TYPES,
    TYPE_TO_CATEGORY,
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
    ) -> list[dict[str, Any]]:
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
            List of cluster suggestions with places ranked by distance
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

        async def search_with_semaphore(
            cluster: dict[str, Any],
        ) -> dict[str, Any] | None:
            async with semaphore:
                places, radius_used = await self._search_nearby_tiered(
                    latitude=cluster["centroid"]["latitude"],
                    longitude=cluster["centroid"]["longitude"],
                )

                logger.info(
                    f"Cluster {cluster['id']}: found {len(places)} places "
                    f"at radius={radius_used}m"
                )

                # Filter out low-quality places before ranking
                quality_places = self._filter_low_quality_places(places)

                ranked_places = self._rank_by_distance(
                    places=quality_places,
                    cluster=cluster,
                )

                if ranked_places:
                    logger.info(
                        f"Cluster {cluster['id']}: returning {len(ranked_places[:MAX_SUGGESTIONS_PER_CLUSTER])} suggestions, "
                        f"top={ranked_places[0]['name'] if ranked_places else 'none'}"
                    )
                    return {
                        "cluster_id": cluster["id"],
                        "photo_ids": [p["asset_id"] for p in cluster.get("photos", [])],
                        "places": ranked_places[:MAX_SUGGESTIONS_PER_CLUSTER],
                    }
                logger.info(f"Cluster {cluster['id']}: no places found after ranking")
                return None

        async def search_with_timeout(cluster: dict[str, Any]) -> dict[str, Any] | None:
            """Wrap cluster search with per-cluster timeout."""
            try:
                return await asyncio.wait_for(
                    search_with_semaphore(cluster),
                    timeout=cluster_timeout,
                )
            except TimeoutError:
                logger.warning(
                    f"Cluster search timed out after {cluster_timeout}s",
                    extra={"cluster_id": cluster.get("id")},
                )
                return None

        # Execute all searches in parallel with bounded concurrency and per-cluster timeout
        results = await asyncio.gather(
            *[search_with_timeout(c) for c in clusters],
            return_exceptions=True,
        )

        # Filter out None results (no places found) and exceptions (partial failures)
        return [
            r for r in results if r is not None and not isinstance(r, BaseException)
        ]

    async def _search_nearby_tiered(
        self,
        latitude: float,
        longitude: float,
    ) -> tuple[list[dict], int]:
        """
        Tiered radius search: 30m → 75m → 150m

        Smaller radius = more precise match for restaurants/hotels.

        Returns:
            Tuple of (places, radius_used)
        """
        for radius in SEARCH_RADII_METERS:
            places = await self._execute_search(latitude, longitude, radius)
            if places:
                return places, radius

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
                # Don't log response body - may contain sensitive error details
                logger.error(f"Google Places API error: status={response.status_code}")
                return []

            response_json = response.json()
            places = response_json.get("places", [])
            logger.info(
                f"Places API at ({latitude:.4f}, {longitude:.4f}) radius={radius}m: "
                f"found {len(places)} places"
            )
            if places:
                logger.debug(
                    f"First place: {places[0].get('displayName', {}).get('text', 'N/A')}"
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
        Filter out low-quality places that would result in poor suggestions.

        Filtering criteria (place must pass ALL hard rules AND at least one soft rule):

        Hard rules (must pass all):
        - Not permanently closed
        - Has a non-empty display name

        Soft rules (must pass at least one):
        - Has at least MIN_REVIEW_COUNT reviews
        - Is an institutional type (museum, hotel, national_park, etc.)

        Args:
            places: Raw places from API response

        Returns:
            Filtered list of quality places
        """
        filtered = []

        for place in places:
            # Hard rule: Skip permanently closed
            if place.get("businessStatus") == "CLOSED_PERMANENTLY":
                continue

            # Hard rule: Must have a non-empty name
            display_name = place.get("displayName", {})
            name = display_name.get("text", "").strip()
            if not name:
                continue

            # Soft rule 1: Has enough reviews
            rating_count = place.get("userRatingCount", 0) or 0
            has_enough_reviews = rating_count >= MIN_REVIEW_COUNT

            # Soft rule 2: Is an institutional type
            primary_type = place.get("primaryType", "")
            is_institutional = primary_type in INSTITUTIONAL_TYPES

            # Must pass at least one soft rule
            if has_enough_reviews or is_institutional:
                filtered.append(place)

        logger.debug(
            f"Quality filter: {len(places)} -> {len(filtered)} places "
            f"(filtered {len(places) - len(filtered)})"
        )
        return filtered

    def _rank_by_distance(
        self,
        places: list[dict],
        cluster: dict,
    ) -> list[dict]:
        """
        Rank places by distance, with quality as tie-breaker.

        Users see "15m away" and decide Yes/No. Distance is primary.
        Quality (review count) breaks ties for places at similar distances.

        Args:
            places: Places from API response
            cluster: Cluster with centroid

        Returns:
            List of place suggestions sorted by distance (quality tie-break)
        """
        ranked = []
        cluster_lat = cluster["centroid"]["latitude"]
        cluster_lng = cluster["centroid"]["longitude"]

        for place in places:
            place_loc = place.get("location", {})
            place_lat = place_loc.get("latitude", 0)
            place_lng = place_loc.get("longitude", 0)

            distance_m = haversine(cluster_lat, cluster_lng, place_lat, place_lng)

            # Map type to category
            primary_type = place.get("primaryType", "point_of_interest")
            category = TYPE_TO_CATEGORY.get(primary_type, "place")

            # Quality signal for tie-breaking
            rating_count = place.get("userRatingCount", 0) or 0

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
                    "types": place.get("types", []),
                    "_rating_count": rating_count,  # Internal field for sorting
                }
            )

        # Sort by distance (5m buckets), then by rating count (higher = better)
        def sort_key(x: dict) -> tuple[int, int]:
            distance_bucket = int(x["distance_m"] / 5)  # 5m buckets for tie-breaking
            quality_score = -(x["_rating_count"])  # Negative for descending
            return (distance_bucket, quality_score)

        ranked.sort(key=sort_key)

        # Remove internal field before returning
        for r in ranked:
            del r["_rating_count"]

        return ranked

    # Keep static method for backward compatibility with tests
    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Backward-compatible wrapper for haversine function."""
        return haversine(lat1, lon1, lat2, lon2)
