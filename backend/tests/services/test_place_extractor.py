"""Tests for place extractor service."""

from unittest.mock import patch

import pytest

from app.services.place_extractor import (
    clean_instagram_profile_name,
    extract_place_from_profile,
)


class TestCleanInstagramProfileName:
    """Tests for clean_instagram_profile_name function."""

    def test_removes_username_suffix(self):
        result = clean_instagram_profile_name("Commander's Palace (@commanderspalace)")
        assert result == "Commander's Palace"

    def test_removes_username_suffix_with_trailing_space(self):
        result = clean_instagram_profile_name("Joe's Cafe (@joescafe) ")
        assert result == "Joe's Cafe"

    def test_removes_on_instagram_suffix(self):
        result = clean_instagram_profile_name("Joe's Cafe on Instagram")
        assert result == "Joe's Cafe"

    def test_removes_photos_and_videos_suffix_bullet(self):
        result = clean_instagram_profile_name(
            "Cafe Central • Instagram photos and videos"
        )
        assert result == "Cafe Central"

    def test_removes_photos_and_videos_suffix_asterisk(self):
        result = clean_instagram_profile_name(
            "Cafe Central * Instagram photos and videos"
        )
        assert result == "Cafe Central"

    def test_removes_pipe_instagram_suffix(self):
        result = clean_instagram_profile_name("Trattoria Roma | Instagram")
        assert result == "Trattoria Roma"

    def test_removes_instagram_prefix(self):
        result = clean_instagram_profile_name("Instagram - Business Name")
        assert result == "Business Name"

    def test_preserves_simple_name(self):
        result = clean_instagram_profile_name("Trattoria Roma")
        assert result == "Trattoria Roma"

    def test_handles_empty_string(self):
        result = clean_instagram_profile_name("")
        assert result == ""

    def test_handles_only_whitespace(self):
        result = clean_instagram_profile_name("   ")
        assert result == ""

    def test_handles_multiple_patterns(self):
        # This tests that patterns are applied correctly even if multiple could match
        result = clean_instagram_profile_name("My Restaurant (@myrest)")
        assert result == "My Restaurant"


class TestExtractPlaceFromProfile:
    """Tests for extract_place_from_profile function."""

    @pytest.mark.asyncio
    async def test_returns_none_for_empty_profile_name(self):
        result = await extract_place_from_profile("", None)
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_google_places_not_configured(self):
        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=False,
        ):
            result = await extract_place_from_profile("Commander's Palace", None)
            assert result is None

    @pytest.mark.asyncio
    async def test_extracts_place_from_profile_name(self):
        mock_place = {
            "place_id": "ChIJ123",
            "name": "Commander's Palace",
            "address": "1403 Washington Ave, New Orleans, LA",
            "latitude": 29.9289,
            "longitude": -90.0891,
            "city": "New Orleans",
            "country": "United States",
            "country_code": "US",
            "primary_type": "restaurant",
            "types": ["restaurant", "food"],
        }

        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.search_places",
                return_value=[{"place_id": "ChIJ123"}],
            ):
                with patch(
                    "app.services.place_extractor.extractor.get_place_details",
                    return_value=mock_place,
                ):
                    result = await extract_place_from_profile(
                        "Commander's Palace", None
                    )

                    assert result is not None
                    assert result.name == "Commander's Palace"
                    assert result.country_code == "US"
                    # Confidence should be boosted for profile-based extraction
                    assert result.confidence > 0

    @pytest.mark.asyncio
    async def test_uses_bio_for_location_hints(self):
        mock_place = {
            "place_id": "ChIJ456",
            "name": "Cafe Central",
            "address": "Herrengasse 14, Vienna, Austria",
            "latitude": 48.2083,
            "longitude": 16.3731,
            "city": "Vienna",
            "country": "Austria",
            "country_code": "AT",
            "primary_type": "cafe",
            "types": ["cafe", "food"],
        }

        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.search_places",
                return_value=[{"place_id": "ChIJ456"}],
            ) as mock_search:
                with patch(
                    "app.services.place_extractor.extractor.get_place_details",
                    return_value=mock_place,
                ):
                    result = await extract_place_from_profile(
                        "Cafe Central",
                        bio="Historic coffeehouse in Vienna, Austria since 1876",
                    )

                    assert result is not None
                    assert result.name == "Cafe Central"
                    # Verify search was called (location hints would bias the search)
                    assert mock_search.called

    @pytest.mark.asyncio
    async def test_returns_none_when_no_place_found(self):
        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.search_places",
                return_value=[],  # No results
            ):
                result = await extract_place_from_profile(
                    "Some Random Nonexistent Place", None
                )
                assert result is None

    @pytest.mark.asyncio
    async def test_boosts_confidence_for_profile_extraction(self):
        mock_place = {
            "place_id": "ChIJ789",
            "name": "Test Restaurant",
            "address": "123 Test St",
            "latitude": 40.7128,
            "longitude": -74.0060,
            "city": "New York",
            "country": "United States",
            "country_code": "US",
            "primary_type": "restaurant",
            "types": ["restaurant"],
        }

        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.search_places",
                return_value=[{"place_id": "ChIJ789"}],
            ):
                with patch(
                    "app.services.place_extractor.extractor.get_place_details",
                    return_value=mock_place,
                ):
                    with patch(
                        "app.services.place_extractor.extractor.calculate_confidence",
                        return_value=0.7,  # Base confidence
                    ):
                        result = await extract_place_from_profile(
                            "Test Restaurant", None
                        )

                        assert result is not None
                        # Should be boosted by 0.1 (to ~0.8)
                        assert abs(result.confidence - 0.8) < 0.001

    @pytest.mark.asyncio
    async def test_confidence_caps_at_1_0(self):
        mock_place = {
            "place_id": "ChIJabc",
            "name": "Perfect Match Restaurant",
            "address": "123 Perfect St",
            "latitude": 40.7128,
            "longitude": -74.0060,
            "city": "New York",
            "country": "United States",
            "country_code": "US",
            "primary_type": "restaurant",
            "types": ["restaurant"],
        }

        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.search_places",
                return_value=[{"place_id": "ChIJabc"}],
            ):
                with patch(
                    "app.services.place_extractor.extractor.get_place_details",
                    return_value=mock_place,
                ):
                    with patch(
                        "app.services.place_extractor.extractor.calculate_confidence",
                        return_value=0.95,  # High base confidence
                    ):
                        result = await extract_place_from_profile(
                            "Perfect Match Restaurant", None
                        )

                        assert result is not None
                        # Should be capped at 1.0 (not 1.05)
                        assert result.confidence == 1.0
