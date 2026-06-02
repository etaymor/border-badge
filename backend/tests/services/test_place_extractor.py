"""Tests for place extractor service."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.social_ingest import OEmbedResponse
from app.services.place_extractor import (
    clean_instagram_profile_name,
    extract_place_from_profile,
)
from app.services.place_extractor.extractor import _extract_place_impl
from app.services.place_extractor.google_places_client import get_place_details

CLIENT = "app.services.place_extractor.google_places_client"


class TestGetPlaceDetailsByIdCache:
    """The persistent by-ID cache must short-circuit the Place Details call."""

    @pytest.mark.asyncio
    async def test_cache_hit_skips_http_call(self) -> None:
        cached = {"place_id": "abc", "name": "Cached Cafe"}
        with (
            patch(f"{CLIENT}.is_configured", return_value=True),
            patch(
                f"{CLIENT}.get_place_details_cache",
                new=AsyncMock(return_value=cached),
            ),
            patch(f"{CLIENT}.get_http_client") as mock_http,
        ):
            result = await get_place_details("abc")

        assert result == cached
        mock_http.assert_not_called()  # cache hit must not touch the network

    @pytest.mark.asyncio
    async def test_partial_rating_only_entry_does_not_short_circuit(self) -> None:
        """A rating-only enrichment entry (no name/address) must not be returned.

        The photo-import finalist enrichment writes rating-only entries into the
        same by-ID cache table; social ingest needs the full detail shape, so a
        partial entry must fall through to a real fetch instead of returning a
        place with no name/address.
        """
        partial = {"rating": 4.5, "userRatingCount": 120}  # no place_id/name
        api_payload = {
            "id": "abc",
            "displayName": {"text": "Full Cafe"},
            "formattedAddress": "1 Main St",
            "location": {"latitude": 1.0, "longitude": 2.0},
            "addressComponents": [],
            "primaryType": "cafe",
            "types": ["cafe"],
        }
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = api_payload
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        with (
            patch(f"{CLIENT}.is_configured", return_value=True),
            patch(
                f"{CLIENT}.get_place_details_cache",
                new=AsyncMock(return_value=partial),
            ),
            patch(f"{CLIENT}.set_place_details_cache", new=AsyncMock()),
            patch(f"{CLIENT}.get_http_client", return_value=mock_client),
        ):
            result = await get_place_details("abc")

        mock_client.get.assert_awaited_once()  # partial entry → real fetch
        assert result is not None
        assert result["name"] == "Full Cafe"

    @pytest.mark.asyncio
    async def test_cache_miss_calls_api_and_writes_through(self) -> None:
        api_payload = {
            "id": "abc",
            "displayName": {"text": "Fresh Cafe"},
            "formattedAddress": "1 Main St",
            "location": {"latitude": 1.0, "longitude": 2.0},
            "addressComponents": [],
            "primaryType": "cafe",
            "types": ["cafe"],
        }
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = api_payload
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        set_cache = AsyncMock()
        with (
            patch(f"{CLIENT}.is_configured", return_value=True),
            patch(
                f"{CLIENT}.get_place_details_cache",
                new=AsyncMock(return_value=None),
            ),
            patch(f"{CLIENT}.set_place_details_cache", new=set_cache),
            patch(f"{CLIENT}.get_http_client", return_value=mock_client),
        ):
            result = await get_place_details("abc")

        assert result is not None
        assert result["name"] == "Fresh Cafe"
        mock_client.get.assert_awaited_once()  # cache miss hits the API
        set_cache.assert_awaited_once()  # and writes the result through to L2
        assert set_cache.call_args[0][0] == "abc"

    @pytest.mark.asyncio
    async def test_details_field_mask_omits_website(self) -> None:
        """websiteUri is never surfaced/saved, so it must not be requested.

        Dropping it keeps the Place Details call on a cheaper SKU. The result
        dict no longer carries a ``website`` key either.
        """
        api_payload = {
            "id": "abc",
            "displayName": {"text": "Fresh Cafe"},
            "formattedAddress": "1 Main St",
            "location": {"latitude": 1.0, "longitude": 2.0},
            "addressComponents": [],
            "primaryType": "cafe",
            "types": ["cafe"],
        }
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = api_payload
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        with (
            patch(f"{CLIENT}.is_configured", return_value=True),
            patch(
                f"{CLIENT}.get_place_details_cache",
                new=AsyncMock(return_value=None),
            ),
            patch(f"{CLIENT}.set_place_details_cache", new=AsyncMock()),
            patch(f"{CLIENT}.get_http_client", return_value=mock_client),
        ):
            result = await get_place_details("abc")

        mask = mock_client.get.call_args.kwargs["headers"]["X-Goog-FieldMask"]
        assert "websiteUri" not in mask
        assert "displayName" in mask  # other fields still requested
        assert result is not None
        assert "website" not in result


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


class TestLLMTaskCancellation:
    """Tests for LLM task cancellation on timeout."""

    @pytest.mark.asyncio
    async def test_llm_task_cancelled_on_timeout(self):
        """Verify LLM task is cancelled when it times out."""
        # Track if the task was cancelled
        task_cancelled = False

        async def slow_llm_extraction(*args, **kwargs):
            """Simulate slow LLM extraction that exceeds timeout."""
            nonlocal task_cancelled
            try:
                await asyncio.sleep(10)  # Much longer than LLM_EXTRACTION_TIMEOUT
                return None
            except asyncio.CancelledError:
                task_cancelled = True
                raise

        # Mock dependencies
        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.get_settings"
            ) as mock_settings:
                settings = MagicMock()
                settings.llm_place_extraction_enabled = True
                settings.place_extraction_min_confidence = 0.5
                mock_settings.return_value = settings

                with patch(
                    "app.services.place_extractor.extractor.try_llm_extraction",
                    side_effect=slow_llm_extraction,
                ):
                    with patch(
                        "app.services.place_extractor.extractor.extract_place_candidates",
                        return_value=[],
                    ):
                        oembed = OEmbedResponse(
                            title="Test Post",
                            author_name="testuser",
                            provider_name="TikTok",
                        )

                        result = await _extract_place_impl(oembed)

                        # Task should have been cancelled
                        assert task_cancelled is True
                        # Should return no result since LLM timed out and no regex candidates
                        assert result.place is None

    @pytest.mark.asyncio
    async def test_no_background_tasks_accumulate_on_timeout(self):
        """Verify no background tasks accumulate after LLM timeout."""
        call_count = 0

        async def slow_llm_extraction(*args, **kwargs):
            """Simulate slow LLM extraction that exceeds timeout."""
            nonlocal call_count
            call_count += 1
            try:
                await asyncio.sleep(10)
                return None
            except asyncio.CancelledError:
                raise

        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.get_settings"
            ) as mock_settings:
                settings = MagicMock()
                settings.llm_place_extraction_enabled = True
                settings.place_extraction_min_confidence = 0.5
                mock_settings.return_value = settings

                with patch(
                    "app.services.place_extractor.extractor.try_llm_extraction",
                    side_effect=slow_llm_extraction,
                ):
                    with patch(
                        "app.services.place_extractor.extractor.extract_place_candidates",
                        return_value=[],
                    ):
                        # Run multiple extractions
                        for _ in range(3):
                            oembed = OEmbedResponse(
                                title="Test Post",
                                author_name="testuser",
                                provider_name="TikTok",
                            )
                            await _extract_place_impl(oembed)

                        # Allow any pending tasks to complete
                        await asyncio.sleep(0.1)

                        # Get all running tasks
                        current_task = asyncio.current_task()
                        all_tasks = [
                            t
                            for t in asyncio.all_tasks()
                            if t is not current_task and not t.done()
                        ]

                        # No background LLM tasks should be running
                        assert (
                            len(all_tasks) == 0
                        ), f"Found {len(all_tasks)} background tasks still running"

    @pytest.mark.asyncio
    async def test_cancelled_error_properly_handled(self):
        """Verify CancelledError from LLM task doesn't crash extraction."""

        async def immediate_cancel(*args, **kwargs):
            """Simulate immediate cancellation."""
            raise asyncio.CancelledError()

        with patch(
            "app.services.place_extractor.extractor.is_configured",
            return_value=True,
        ):
            with patch(
                "app.services.place_extractor.extractor.get_settings"
            ) as mock_settings:
                settings = MagicMock()
                settings.llm_place_extraction_enabled = True
                settings.place_extraction_min_confidence = 0.5
                mock_settings.return_value = settings

                with patch(
                    "app.services.place_extractor.extractor.try_llm_extraction",
                    side_effect=immediate_cancel,
                ):
                    with patch(
                        "app.services.place_extractor.extractor.extract_place_candidates",
                        return_value=[],
                    ):
                        oembed = OEmbedResponse(
                            title="Test Post",
                            author_name="testuser",
                            provider_name="TikTok",
                        )

                        # CancelledError from outer context should propagate
                        # but CancelledError from task cancellation should be handled
                        # This test verifies the extraction doesn't hang or crash
                        with pytest.raises(asyncio.CancelledError):
                            await _extract_place_impl(oembed)
