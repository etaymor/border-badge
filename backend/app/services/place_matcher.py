"""Place matcher service for photo-to-place suggestions.

Matches photo GPS clusters to nearby places using Google Places Nearby Search API.
Uses tiered radius search (30m → 75m → 150m) for optimal precision.
"""

import asyncio
import hashlib
import html
import logging
import math
import re
import time
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Concurrency limit for parallel Places API calls
MAX_CONCURRENT_PLACES_REQUESTS = 5

# Maximum length for place names/addresses (defense against absurdly long strings)
MAX_PLACE_NAME_LENGTH = 200
MAX_ADDRESS_LENGTH = 500


def sanitize_place_text(text: str, max_length: int) -> str:
    """
    Sanitize text from external API for safe display.

    Defense-in-depth measure: while Google's API is trusted and React Native
    doesn't render HTML in text components (no XSS vector), this provides
    protection against:
    1. Future web clients that might render this data
    2. Compromised upstream data
    3. Unexpectedly long strings that could cause UI issues

    Args:
        text: Raw text from external API
        max_length: Maximum allowed length

    Returns:
        Sanitized text safe for display
    """
    if not text:
        return ""

    # HTML-escape to prevent XSS if ever rendered in HTML context
    sanitized = html.escape(text, quote=True)

    # Remove control characters (except common whitespace)
    sanitized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", sanitized)

    # Truncate to max length
    if len(sanitized) > max_length:
        sanitized = sanitized[: max_length - 3] + "..."

    return sanitized.strip()


class PlacesCache:
    """
    In-memory LRU cache for Google Places API responses.

    Uses truncated coordinates (3 decimal places, ~111m precision) as cache keys
    to group nearby queries and reduce redundant API calls.

    Includes max_size limit with LRU eviction to prevent unbounded memory growth.

    Thread-safe via asyncio.Lock to prevent TOCTOU race conditions when
    multiple coroutines access the cache concurrently.

    Implements single-flight pattern via _in_flight tracking to prevent cache
    stampedes when concurrent requests arrive for the same location.
    """

    def __init__(self, ttl_hours: int = 24, max_size: int = 1000) -> None:
        """
        Initialize the cache.

        Args:
            ttl_hours: Time-to-live for cached entries in hours (default 24)
            max_size: Maximum number of entries before LRU eviction (default 1000)
        """
        self._cache: dict[str, tuple[list[dict], float]] = {}
        self._ttl = ttl_hours * 3600  # Convert to seconds
        self._max_size = max_size
        self._lock = asyncio.Lock()
        # Single-flight pattern: track in-flight requests to prevent stampedes
        self._in_flight: dict[str, asyncio.Future[list[dict]]] = {}

    def get_cache_key(self, lat: float, lng: float, radius: int) -> str:
        """
        Generate a cache key from coordinates and radius.

        Truncates to 3 decimal places (~111m precision) to group nearby queries.

        Args:
            lat: Latitude
            lng: Longitude
            radius: Search radius in meters

        Returns:
            Cache key string
        """
        return f"{round(lat, 3)}_{round(lng, 3)}_{radius}"

    async def get(self, key: str) -> list[dict] | None:
        """
        Retrieve cached data if it exists and hasn't expired.

        Moves the entry to end (most recently used) on access.

        Args:
            key: Cache key

        Returns:
            Cached places list or None if not found/expired
        """
        async with self._lock:
            if key in self._cache:
                data, timestamp = self._cache[key]
                if time.time() - timestamp < self._ttl:
                    # Move to end (most recently used)
                    self._cache[key] = self._cache.pop(key)
                    return data
                # Expired - remove from cache
                del self._cache[key]
            return None

    async def set(self, key: str, data: list[dict]) -> None:
        """
        Store data in the cache with LRU eviction.

        Args:
            key: Cache key
            data: Places list to cache
        """
        async with self._lock:
            # If key exists, remove it first to update position
            if key in self._cache:
                del self._cache[key]

            # Evict oldest entries if at capacity (guard against max_size=0)
            if self._max_size > 0:
                while len(self._cache) >= self._max_size:
                    oldest_key = next(iter(self._cache))
                    del self._cache[oldest_key]
                self._cache[key] = (data, time.time())

    def clear(self) -> None:
        """Clear all cached entries and in-flight requests."""
        self._cache.clear()
        self._in_flight.clear()

    @property
    def size(self) -> int:
        """Return the number of cached entries."""
        return len(self._cache)

    async def get_or_fetch(self, key: str, fetch_fn: Any) -> list[dict]:
        """
        Get cached result or fetch using provided function (single-flight pattern).

        Prevents cache stampedes by ensuring only one concurrent request per key.
        If a request is already in-flight for the same key, subsequent callers
        wait for that result instead of making duplicate API calls.

        Args:
            key: Cache key
            fetch_fn: Async callable that fetches data if not cached

        Returns:
            Cached or freshly fetched places list
        """
        # Determine what to do under lock, then act outside lock
        existing_future: asyncio.Future[list[dict]] | None = None
        our_future: asyncio.Future[list[dict]] | None = None

        async with self._lock:
            # Check cache first
            if key in self._cache:
                data, timestamp = self._cache[key]
                if time.time() - timestamp < self._ttl:
                    # Move to end (most recently used)
                    self._cache[key] = self._cache.pop(key)
                    return data
                # Expired - remove from cache
                del self._cache[key]

            # Check if request already in-flight
            if key in self._in_flight:
                existing_future = self._in_flight[key]
            else:
                # We're the first - create future and claim ownership
                loop = asyncio.get_event_loop()
                our_future = loop.create_future()
                self._in_flight[key] = our_future

        # If another request is in-flight, wait for it (outside lock)
        if existing_future is not None:
            return await existing_future

        # We own this request - fetch the data
        assert our_future is not None  # Type narrowing for mypy/pyright
        try:
            result = await fetch_fn()
            # Cache and resolve future
            async with self._lock:
                # Store in cache with LRU eviction (guard against max_size=0)
                if self._max_size > 0:
                    if key in self._cache:
                        del self._cache[key]
                    while len(self._cache) >= self._max_size:
                        oldest_key = next(iter(self._cache))
                        del self._cache[oldest_key]
                    self._cache[key] = (result, time.time())

                # Resolve future for waiting callers
                if not our_future.done():
                    our_future.set_result(result)
                # Clean up in-flight tracking
                self._in_flight.pop(key, None)

            return result
        except Exception as error:
            # On error, clean up and propagate exception to waiters
            async with self._lock:
                self._in_flight.pop(key, None)
                if not our_future.done():
                    # Propagate the exception to waiting callers so they receive
                    # the actual error instead of CancelledError
                    our_future.set_exception(error)
            raise


# Module-level cache instance (shared across requests)
#
# Memory impact: With max_size=1000 and typical responses of ~2KB per entry,
# worst-case memory usage is ~2MB. The 24h TTL prevents stale data while the
# LRU eviction ensures bounded growth. For high-traffic production deployments,
# consider reducing TTL or max_size, or moving to Redis for shared caching.
places_cache = PlacesCache()

# Google Places API endpoint (New API v1)
NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby"

# Configuration
SEARCH_RADII_METERS = [30, 75, 150]  # Tiered: 30m for restaurants/hotels, then widen
MAX_PLACES_PER_SEARCH = 10
MAX_SUGGESTIONS_PER_CLUSTER = 3  # Top 3 by distance
# Note: Timeout is configurable via PLACES_API_TIMEOUT_SECONDS env var (see config.py)

# Place type to entry category mapping
TYPE_TO_CATEGORY: dict[str, str] = {
    # Food
    "restaurant": "food",
    "cafe": "food",
    "coffee_shop": "food",
    "bar": "food",
    "bakery": "food",
    "fast_food_restaurant": "food",
    "fine_dining_restaurant": "food",
    "breakfast_restaurant": "food",
    "brunch_restaurant": "food",
    "ice_cream_shop": "food",
    "pizza_restaurant": "food",
    "seafood_restaurant": "food",
    "steak_house": "food",
    "sushi_restaurant": "food",
    # Stay
    "hotel": "stay",
    "lodging": "stay",
    "motel": "stay",
    "hostel": "stay",
    "resort_hotel": "stay",
    "bed_and_breakfast": "stay",
    "guest_house": "stay",
    "extended_stay_hotel": "stay",
    "camping_cabin": "stay",
    "campground": "stay",
    # Experience
    "museum": "experience",
    "tourist_attraction": "experience",
    "amusement_park": "experience",
    "zoo": "experience",
    "aquarium": "experience",
    "park": "experience",
    "art_gallery": "experience",
    "historical_landmark": "experience",
    "national_park": "experience",
    "performing_arts_theater": "experience",
    "stadium": "experience",
    "hiking_area": "experience",
    "ski_resort": "experience",
    "beach": "experience",
    "spa": "experience",
    "casino": "experience",
    "night_club": "experience",
    # Place (fallback)
    "point_of_interest": "place",
    "landmark": "place",
    "natural_feature": "place",
    "establishment": "place",
}

# Minimal field mask to reduce API costs (Essentials tier)
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.types",
        "places.primaryType",
    ]
)


class PlaceMatcherError(Exception):
    """Base exception for place matching failures."""

    pass


class RateLimitError(PlaceMatcherError):
    """Google Places API rate limit exceeded (temporary, can retry)."""

    pass


class QuotaExhaustedError(PlaceMatcherError):
    """Google Places API quota exhausted (daily limit reached)."""

    pass


class ConfigurationError(PlaceMatcherError):
    """Service not properly configured (e.g., missing API key)."""

    pass


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
        # Bounded concurrency to respect Google Places API rate limits
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_PLACES_REQUESTS)
        cluster_timeout = self._settings.places_cluster_timeout_seconds

        async def search_with_semaphore(
            cluster: dict[str, Any],
        ) -> dict[str, Any] | None:
            async with semaphore:
                places, _ = await self._search_nearby_tiered(
                    latitude=cluster["centroid"]["latitude"],
                    longitude=cluster["centroid"]["longitude"],
                )

                ranked_places = self._rank_by_distance(
                    places=places,
                    cluster=cluster,
                )

                if ranked_places:
                    return {
                        "cluster_id": cluster["id"],
                        "photo_ids": [p["asset_id"] for p in cluster.get("photos", [])],
                        "places": ranked_places[:MAX_SUGGESTIONS_PER_CLUSTER],
                    }
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
                    "includedTypes": list(TYPE_TO_CATEGORY.keys()),
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
                logger.error(
                    f"Google Places API error: {response.status_code}",
                    extra={"response_text": response.text[:500]},
                )
                return []

            places = response.json().get("places", [])
            logger.debug(
                f"Places API returned {len(places)} places for radius={radius}m"
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

    def _rank_by_distance(
        self,
        places: list[dict],
        cluster: dict,
    ) -> list[dict]:
        """
        Rank places by distance only - simpler is better.

        Users see "15m away" and decide Yes/No, not confidence percentages.

        Args:
            places: Places from API response
            cluster: Cluster with centroid

        Returns:
            List of place suggestions sorted by distance
        """
        ranked = []
        cluster_lat = cluster["centroid"]["latitude"]
        cluster_lng = cluster["centroid"]["longitude"]

        for place in places:
            place_loc = place.get("location", {})
            place_lat = place_loc.get("latitude", 0)
            place_lng = place_loc.get("longitude", 0)

            distance_m = self._haversine(cluster_lat, cluster_lng, place_lat, place_lng)

            # Map type to category
            primary_type = place.get("primaryType", "point_of_interest")
            category = TYPE_TO_CATEGORY.get(primary_type, "place")

            # Defensive access for displayName with sanitization
            display_name = place.get("displayName", {})
            raw_name = display_name.get("text", "") or "Unknown Place"
            raw_address = place.get("formattedAddress", "")

            ranked.append(
                {
                    "place_id": place["id"],
                    "name": sanitize_place_text(raw_name, MAX_PLACE_NAME_LENGTH),
                    "address": sanitize_place_text(raw_address, MAX_ADDRESS_LENGTH),
                    "location": {
                        "latitude": place_lat,
                        "longitude": place_lng,
                    },
                    "category": category,
                    "distance_m": round(distance_m, 1),
                    "types": place.get("types", []),
                }
            )

        return sorted(ranked, key=lambda x: x["distance_m"])

    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """
        Calculate distance in meters between two coordinates using Haversine formula.

        Args:
            lat1, lon1: First coordinate
            lat2, lon2: Second coordinate

        Returns:
            Distance in meters, or infinity if coordinates are invalid
        """
        # Validate coordinate bounds (defense in depth - Pydantic validates inputs
        # but this prevents nonsense results from edge cases or data corruption)
        if not (-90 <= lat1 <= 90 and -90 <= lat2 <= 90):
            return float("inf")
        if not (-180 <= lon1 <= 180 and -180 <= lon2 <= 180):
            return float("inf")

        R = 6371000  # Earth radius in meters
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = (
            math.sin(delta_phi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return R * c
