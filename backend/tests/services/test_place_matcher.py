"""Tests for the place_matcher service."""

import math

from app.services.place_matcher import TYPE_TO_CATEGORY


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Helper function to calculate haversine distance for tests."""
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


class TestHaversineDistance:
    """Tests for haversine distance calculation."""

    def test_same_location_returns_zero(self) -> None:
        """Test that same coordinates return 0 distance."""
        distance = haversine_distance(35.6762, 139.6503, 35.6762, 139.6503)
        assert distance == 0

    def test_known_distance_tokyo_to_kyoto(self) -> None:
        """Test distance between Tokyo and Kyoto (~370km)."""
        lat1, lon1 = 35.6812, 139.7671
        lat2, lon2 = 34.9855, 135.7589

        distance = haversine_distance(lat1, lon1, lat2, lon2)

        # Should be approximately 370km (within 10% margin)
        assert 330000 < distance < 410000

    def test_short_distance(self) -> None:
        """Test short distance between nearby points."""
        lat1, lon1 = 35.6762, 139.6503
        lat2, lon2 = 35.6772, 139.6503

        distance = haversine_distance(lat1, lon1, lat2, lon2)

        assert 100 < distance < 130

    def test_handles_negative_coordinates(self) -> None:
        """Test with negative longitude."""
        lat1, lon1 = 40.7128, -74.0060
        lat2, lon2 = 40.7128, -74.0050

        distance = haversine_distance(lat1, lon1, lat2, lon2)

        assert 0 < distance < 100


class TestTypeToCategoryMapping:
    """Tests for Google Places type to category mapping."""

    def test_restaurant_maps_to_food(self) -> None:
        """Test that restaurant types map to food category."""
        assert TYPE_TO_CATEGORY.get("restaurant") == "food"
        assert TYPE_TO_CATEGORY.get("cafe") == "food"
        assert TYPE_TO_CATEGORY.get("bakery") == "food"

    def test_lodging_maps_to_stay(self) -> None:
        """Test that lodging types map to stay category."""
        assert TYPE_TO_CATEGORY.get("lodging") == "stay"
        assert TYPE_TO_CATEGORY.get("hotel") == "stay"

    def test_attraction_maps_to_experience(self) -> None:
        """Test that attraction types map to experience category."""
        assert TYPE_TO_CATEGORY.get("tourist_attraction") == "experience"
        assert TYPE_TO_CATEGORY.get("museum") == "experience"
        assert TYPE_TO_CATEGORY.get("amusement_park") == "experience"

    def test_default_is_none_for_unknown(self) -> None:
        """Test that unknown types return None."""
        assert TYPE_TO_CATEGORY.get("unknown_type") is None
