"""Place matcher service for photo-to-place suggestions.

Matches photo GPS clusters to nearby places using Google Places Nearby Search API.
Uses tiered radius search (30m → 75m → 150m) for optimal precision.
"""

import asyncio
import hashlib
import logging
import math
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


class PlacesCache:
    """
    In-memory cache for Google Places API responses.

    Uses truncated coordinates (3 decimal places, ~111m precision) as cache keys
    to group nearby queries and reduce redundant API calls.
    """

    def __init__(self, ttl_hours: int = 24) -> None:
        """
        Initialize the cache.

        Args:
            ttl_hours: Time-to-live for cached entries in hours (default 24)
        """
        self._cache: dict[str, tuple[list[dict], float]] = {}
        self._ttl = ttl_hours * 3600  # Convert to seconds

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

    def get(self, key: str) -> list[dict] | None:
        """
        Retrieve cached data if it exists and hasn't expired.

        Args:
            key: Cache key

        Returns:
            Cached places list or None if not found/expired
        """
        if key in self._cache:
            data, timestamp = self._cache[key]
            if time.time() - timestamp < self._ttl:
                return data
            # Expired - remove from cache
            del self._cache[key]
        return None

    def set(self, key: str, data: list[dict]) -> None:
        """
        Store data in the cache.

        Args:
            key: Cache key
            data: Places list to cache
        """
        self._cache[key] = (data, time.time())

    def clear(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()

    @property
    def size(self) -> int:
        """Return the number of cached entries."""
        return len(self._cache)


# Module-level cache instance (shared across requests)
places_cache = PlacesCache()

# Google Places API endpoint (New API v1)
NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby"

# Configuration
SEARCH_RADII_METERS = [30, 75, 150]  # Tiered: 30m for restaurants/hotels, then widen
MAX_PLACES_PER_SEARCH = 10
MAX_SUGGESTIONS_PER_CLUSTER = 3  # Top 3 by distance
PLACES_API_TIMEOUT_SECONDS = 5.0

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
    """Google Places API rate limit exceeded."""

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

        Args:
            clusters: List of cluster dicts with centroid and photos

        Returns:
            List of cluster suggestions with places ranked by distance
        """
        # Bounded concurrency to respect Google Places API rate limits
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_PLACES_REQUESTS)

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

        # Execute all searches in parallel with bounded concurrency
        results = await asyncio.gather(
            *[search_with_semaphore(c) for c in clusters],
            return_exceptions=True,
        )

        # Filter out None results (no places found) and exceptions (partial failures)
        return [
            r
            for r in results
            if r is not None and not isinstance(r, BaseException)
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
            logger.warning("Google Places API key not configured")
            return []

        # Check cache first
        cache_key = places_cache.get_cache_key(latitude, longitude, int(radius))
        cached_result = places_cache.get(cache_key)
        if cached_result is not None:
            logger.debug(f"Places cache hit for radius={radius}m")
            return cached_result

        try:
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
                logger.warning("Google Places API rate limited")
                raise RateLimitError("Rate limit exceeded")

            if response.status_code != 200:
                logger.error(
                    f"Google Places API error: {response.status_code}",
                    extra={"response_text": response.text[:500]},
                )
                return []

            places = response.json().get("places", [])

            # Cache the result (including empty results to avoid repeated lookups)
            places_cache.set(cache_key, places)
            logger.debug(
                f"Places cache miss for radius={radius}m, cached {len(places)} places"
            )

            return places

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

            # Defensive access for displayName
            display_name = place.get("displayName", {})
            name = display_name.get("text", "") or "Unknown Place"

            ranked.append(
                {
                    "place_id": place["id"],
                    "name": name,
                    "address": place.get("formattedAddress", ""),
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
            Distance in meters
        """
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
