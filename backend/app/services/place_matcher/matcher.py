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

    async def _search_nearby_tiered(
        self,
        latitude: float,
        longitude: float,
    ) -> tuple[list[dict], int]:
        """
        Tiered radius search: 15m → 30m → 75m

        Smaller radius = more precise match for restaurants/hotels.
        Expands radius until quality places are found (not just any places).

        Returns:
            Tuple of (quality_places, radius_used)
        """
        for radius in SEARCH_RADII_METERS:
            places = await self._execute_search(latitude, longitude, radius)
            if places:
                # Apply quality filter before deciding to stop
                # This ensures we expand radius if only low-quality places found
                quality_places = self._filter_low_quality_places(places)
                if quality_places:
                    return quality_places, radius
                # Found places but none passed quality - continue to wider radius
                logger.debug(
                    f"Radius {radius}m: {len(places)} places found but 0 passed quality filter, expanding"
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
        Filter out low-quality places that would result in poor suggestions.

        Filtering criteria (must pass ALL):
        - Not permanently closed
        - Has a non-empty display name
        - Has at least MIN_REVIEW_COUNT reviews (no exceptions)

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

        # Sort by combined score: distance penalty + review bonus
        # Photo GPS is typically 5-15m accuracy, so we use 20m buckets
        # Places with significantly more reviews can overcome small distance differences
        def sort_key(x: dict) -> float:
            distance_m = x["distance_m"]
            review_count = x["_rating_count"]

            # Distance penalty: 1 point per 20m bucket
            distance_penalty = distance_m / 20.0

            # Review bonus: log scale so 1000 reviews >> 10 reviews >> 1 review
            # log10(1) = 0, log10(10) = 1, log10(100) = 2, log10(1000) = 3
            review_bonus = math.log10(max(review_count, 1) + 1)  # +1 to avoid log(0)

            # Lower score = better rank
            # A place 20m away with 1000 reviews (bonus=3) beats
            # a place 0m away with 10 reviews (bonus=1)
            return distance_penalty - review_bonus

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
