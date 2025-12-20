"""Tests for affiliate redirect URL generation in public pages."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.api.public import _generate_entry_redirect_url
from app.services.affiliate_links import verify_signature

# Test data
TEST_ENTRY_ID = str(uuid4())
TEST_TRIP_ID = str(uuid4())
TEST_LINK_ID = str(uuid4())
TEST_DESTINATION_URL = "https://www.booking.com/hotel/us/grand-hyatt.html"


class TestGenerateEntryRedirectUrl:
    """Tests for _generate_entry_redirect_url helper."""

    @pytest.mark.asyncio
    async def test_returns_none_for_empty_destination(self) -> None:
        """Test that None is returned when destination_url is empty."""
        result = await _generate_entry_redirect_url(
            entry_id=TEST_ENTRY_ID,
            destination_url=None,
            trip_id=TEST_TRIP_ID,
            source="list_share",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_for_blank_destination(self) -> None:
        """Test that None is returned when destination_url is blank."""
        result = await _generate_entry_redirect_url(
            entry_id=TEST_ENTRY_ID,
            destination_url="",
            trip_id=TEST_TRIP_ID,
            source="list_share",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_generates_redirect_url_with_signature(self) -> None:
        """Test that a signed redirect URL is generated correctly."""
        mock_link = AsyncMock()
        mock_link.id = TEST_LINK_ID

        with (
            patch(
                "app.api.public.get_or_create_link_for_entry",
                return_value=mock_link,
            ),
            patch(
                "app.api.public.get_settings",
            ) as mock_settings,
        ):
            mock_settings.return_value.base_url = "https://atlasi.app"

            result = await _generate_entry_redirect_url(
                entry_id=TEST_ENTRY_ID,
                destination_url=TEST_DESTINATION_URL,
                trip_id=TEST_TRIP_ID,
                source="list_share",
            )

            assert result is not None
            assert f"/o/{TEST_LINK_ID}" in result
            assert "src=list_share" in result
            assert f"trip_id={TEST_TRIP_ID}" in result
            assert f"entry_id={TEST_ENTRY_ID}" in result
            assert "sig=" in result

    @pytest.mark.asyncio
    async def test_signature_is_valid(self) -> None:
        """Test that the generated signature can be verified."""
        mock_link = AsyncMock()
        mock_link.id = TEST_LINK_ID

        with (
            patch(
                "app.api.public.get_or_create_link_for_entry",
                return_value=mock_link,
            ),
            patch(
                "app.api.public.get_settings",
            ) as mock_settings,
        ):
            mock_settings.return_value.base_url = "https://atlasi.app"

            result = await _generate_entry_redirect_url(
                entry_id=TEST_ENTRY_ID,
                destination_url=TEST_DESTINATION_URL,
                trip_id=TEST_TRIP_ID,
                source="list_share",
            )

            # Extract signature from URL
            import urllib.parse

            parsed = urllib.parse.urlparse(result)
            params = urllib.parse.parse_qs(parsed.query)
            sig = params.get("sig", [""])[0]

            # Verify signature
            is_valid = verify_signature(
                link_id=TEST_LINK_ID,
                trip_id=TEST_TRIP_ID,
                entry_id=TEST_ENTRY_ID,
                source="list_share",
                signature=sig,
            )
            assert is_valid

    @pytest.mark.asyncio
    async def test_works_without_trip_id(self) -> None:
        """Test redirect URL generation without trip_id."""
        mock_link = AsyncMock()
        mock_link.id = TEST_LINK_ID

        with (
            patch(
                "app.api.public.get_or_create_link_for_entry",
                return_value=mock_link,
            ),
            patch(
                "app.api.public.get_settings",
            ) as mock_settings,
        ):
            mock_settings.return_value.base_url = "https://atlasi.app"

            result = await _generate_entry_redirect_url(
                entry_id=TEST_ENTRY_ID,
                destination_url=TEST_DESTINATION_URL,
                trip_id=None,
                source="trip_share",
            )

            assert result is not None
            assert f"/o/{TEST_LINK_ID}" in result
            assert "src=trip_share" in result
            assert "trip_id=" not in result  # Should not include empty trip_id

    @pytest.mark.asyncio
    async def test_handles_link_creation_error_gracefully(self) -> None:
        """Test that errors during link creation return None."""
        with patch(
            "app.api.public.get_or_create_link_for_entry",
            side_effect=Exception("Database error"),
        ):
            result = await _generate_entry_redirect_url(
                entry_id=TEST_ENTRY_ID,
                destination_url=TEST_DESTINATION_URL,
                trip_id=TEST_TRIP_ID,
                source="list_share",
            )

            assert result is None

    @pytest.mark.asyncio
    async def test_uses_correct_source_for_list_share(self) -> None:
        """Test that list_share source is used correctly."""
        mock_link = AsyncMock()
        mock_link.id = TEST_LINK_ID

        with (
            patch(
                "app.api.public.get_or_create_link_for_entry",
                return_value=mock_link,
            ),
            patch(
                "app.api.public.get_settings",
            ) as mock_settings,
        ):
            mock_settings.return_value.base_url = "https://atlasi.app"

            result = await _generate_entry_redirect_url(
                entry_id=TEST_ENTRY_ID,
                destination_url=TEST_DESTINATION_URL,
                trip_id=TEST_TRIP_ID,
                source="list_share",
            )

            assert "src=list_share" in result

    @pytest.mark.asyncio
    async def test_uses_correct_source_for_trip_share(self) -> None:
        """Test that trip_share source is used correctly."""
        mock_link = AsyncMock()
        mock_link.id = TEST_LINK_ID

        with (
            patch(
                "app.api.public.get_or_create_link_for_entry",
                return_value=mock_link,
            ),
            patch(
                "app.api.public.get_settings",
            ) as mock_settings,
        ):
            mock_settings.return_value.base_url = "https://atlasi.app"

            result = await _generate_entry_redirect_url(
                entry_id=TEST_ENTRY_ID,
                destination_url=TEST_DESTINATION_URL,
                trip_id=TEST_TRIP_ID,
                source="trip_share",
            )

            assert "src=trip_share" in result


class TestDestinationUrlBuilding:
    """Tests for destination URL building logic in public views."""

    def test_entry_link_takes_priority(self) -> None:
        """Test that entry.link is preferred over place coordinates."""
        entry_link = "https://example.com/custom-link"
        lat = 40.7128
        lng = -74.0060
        google_place_id = "ChIJAbcd1234"

        # Simulating the template logic
        if entry_link:
            destination_url = entry_link
        elif lat and lng:
            destination_url = (
                f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            )
        elif google_place_id:
            destination_url = f"https://www.google.com/maps/search/?api=1&query_place_id={google_place_id}"
        else:
            destination_url = None

        assert destination_url == entry_link

    def test_coordinates_fallback_when_no_link(self) -> None:
        """Test that coordinates are used when no entry.link."""
        entry_link = None
        lat = 40.7128
        lng = -74.0060
        google_place_id = "ChIJAbcd1234"

        if entry_link:
            destination_url = entry_link
        elif lat and lng:
            destination_url = (
                f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            )
        elif google_place_id:
            destination_url = f"https://www.google.com/maps/search/?api=1&query_place_id={google_place_id}"
        else:
            destination_url = None

        assert "query=40.7128,-74.006" in destination_url

    def test_place_id_fallback_when_no_coordinates(self) -> None:
        """Test that google_place_id is used when no link or coordinates."""
        entry_link = None
        lat = None
        lng = None
        google_place_id = "ChIJAbcd1234"

        if entry_link:
            destination_url = entry_link
        elif lat and lng:
            destination_url = (
                f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            )
        elif google_place_id:
            destination_url = f"https://www.google.com/maps/search/?api=1&query_place_id={google_place_id}"
        else:
            destination_url = None

        assert (
            destination_url
            == f"https://www.google.com/maps/search/?api=1&query_place_id={google_place_id}"
        )

    def test_none_when_no_location_data(self) -> None:
        """Test that None is returned when no location data available."""
        entry_link = None
        lat = None
        lng = None
        google_place_id = None

        if entry_link:
            destination_url = entry_link
        elif lat and lng:
            destination_url = (
                f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            )
        elif google_place_id:
            destination_url = f"https://www.google.com/maps/search/?api=1&query_place_id={google_place_id}"
        else:
            destination_url = None

        assert destination_url is None
