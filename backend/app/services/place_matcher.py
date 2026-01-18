"""Place matcher service for photo-to-place suggestions.

Matches photo GPS clusters to nearby places using Google Places Nearby Search API.
Uses tiered radius search (30m → 75m → 150m) for optimal precision.
"""

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

logger = logging.getLogger(__name__)

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

        Args:
            clusters: List of cluster dicts with centroid and photos

        Returns:
            List of cluster suggestions with places ranked by distance
        """
        suggestions = []

        for cluster in clusters:
            places, _ = await self._search_nearby_tiered(
                latitude=cluster["centroid"]["latitude"],
                longitude=cluster["centroid"]["longitude"],
            )

            ranked_places = self._rank_by_distance(
                places=places,
                cluster=cluster,
            )

            if ranked_places:
                suggestions.append(
                    {
                        "cluster_id": cluster["id"],
                        "photo_ids": [p["asset_id"] for p in cluster.get("photos", [])],
                        "places": ranked_places[:MAX_SUGGESTIONS_PER_CLUSTER],
                    }
                )

        return suggestions

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
        Execute a single Places API search with retry logic.

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

            return response.json().get("places", [])

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
