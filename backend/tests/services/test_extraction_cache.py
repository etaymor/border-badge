"""Tests for extraction cache service."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.social_ingest import DetectedPlace
from app.services.extraction_cache import (
    _get_lower_priority_sources,
    cache_extraction,
    get_source_priority,
    should_update_cache,
)


def make_detected_place(name: str = "Test Place") -> DetectedPlace:
    """Create a test DetectedPlace."""
    return DetectedPlace(
        google_place_id="ChIJ123",
        name=name,
        address="123 Test St",
        latitude=40.7128,
        longitude=-74.0060,
        city="New York",
        country="United States",
        country_code="US",
        confidence=0.9,
        primary_type="restaurant",
        types=["restaurant"],
        llm_entry_type="food",
    )


class TestGetLowerPrioritySources:
    """Tests for _get_lower_priority_sources helper."""

    def test_video_frames_lower_sources(self):
        """video_frames should list all other sources as lower priority."""
        lower = _get_lower_priority_sources("video_frames")
        assert set(lower) == {"carousel", "screenshot", "caption"}

    def test_carousel_lower_sources(self):
        lower = _get_lower_priority_sources("carousel")
        assert set(lower) == {"screenshot", "caption"}

    def test_screenshot_lower_sources(self):
        lower = _get_lower_priority_sources("screenshot")
        assert set(lower) == {"caption"}

    def test_caption_lower_sources(self):
        lower = _get_lower_priority_sources("caption")
        assert lower == []


class TestCacheExtractionConditionalUpdate:
    """Tests for the atomic conditional UPDATE in cache_extraction.

    The implementation uses a single PATCH with WHERE filters to prevent
    TOCTOU race conditions. These tests verify the correct filter params
    are sent to PostgREST.
    """

    @pytest.mark.asyncio
    async def test_video_frames_includes_all_lower_sources_in_filter(self):
        """video_frames PATCH should allow overwrite of NULL, caption, screenshot, carousel."""
        canonical_url = "https://www.tiktok.com/@user/video/123"
        place = make_detected_place("Video Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append({"table": table, "data": data, "params": params})
            return [data]

        with patch(
            "app.services.extraction_cache.get_service_supabase_client"
        ) as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [place], source="video_frames")

            assert len(patch_calls) == 1
            params = patch_calls[0]["params"]
            or_filter = params["or"]
            assert "extraction_source.is.null" in or_filter
            assert "extraction_source.eq.video_frames" in or_filter
            assert "extraction_source.eq.carousel" in or_filter
            assert "extraction_source.eq.screenshot" in or_filter
            assert "extraction_source.eq.caption" in or_filter

    @pytest.mark.asyncio
    async def test_caption_filter_only_allows_null_and_self(self):
        """caption PATCH should only allow overwrite of NULL or existing caption."""
        canonical_url = "https://www.tiktok.com/@user/video/456"
        place = make_detected_place("Caption Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append({"table": table, "data": data, "params": params})
            return [data]

        with patch(
            "app.services.extraction_cache.get_service_supabase_client"
        ) as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [place], source="caption")

            assert len(patch_calls) == 1
            or_filter = patch_calls[0]["params"]["or"]
            assert "extraction_source.is.null" in or_filter
            assert "extraction_source.eq.caption" in or_filter
            # Should NOT include higher-priority sources
            assert "extraction_source.eq.video_frames" not in or_filter
            assert "extraction_source.eq.carousel" not in or_filter
            assert "extraction_source.eq.screenshot" not in or_filter

    @pytest.mark.asyncio
    async def test_carousel_filter_includes_lower_sources(self):
        """carousel PATCH should allow overwrite of NULL, self, screenshot, caption."""
        canonical_url = "https://www.instagram.com/p/abc123"
        place = make_detected_place("Carousel Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append({"table": table, "data": data, "params": params})
            return [data]

        with patch(
            "app.services.extraction_cache.get_service_supabase_client"
        ) as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [place], source="carousel")

            assert len(patch_calls) == 1
            or_filter = patch_calls[0]["params"]["or"]
            assert "extraction_source.is.null" in or_filter
            assert "extraction_source.eq.carousel" in or_filter
            assert "extraction_source.eq.screenshot" in or_filter
            assert "extraction_source.eq.caption" in or_filter
            # Should NOT include video_frames (higher priority)
            assert "extraction_source.eq.video_frames" not in or_filter

    @pytest.mark.asyncio
    async def test_patch_called_with_correct_data(self):
        """Verify the PATCH sends correct extraction data."""
        canonical_url = "https://www.tiktok.com/@user/video/789"
        place = make_detected_place("My Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append({"table": table, "data": data, "params": params})
            return [data]

        with patch(
            "app.services.extraction_cache.get_service_supabase_client"
        ) as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [place], source="video_frames")

            data = patch_calls[0]["data"]
            assert data["extraction_source"] == "video_frames"
            assert data["extraction_result"][0]["name"] == "My Place"
            assert "extraction_at" in data

    @pytest.mark.asyncio
    async def test_empty_patch_result_logs_skip(self):
        """When PATCH returns empty (no rows matched), it should log skip."""
        canonical_url = "https://www.tiktok.com/@user/video/no-match"
        place = make_detected_place("Place")

        with patch(
            "app.services.extraction_cache.get_service_supabase_client"
        ) as mock_client:
            client = MagicMock()
            # Empty result = no rows matched the WHERE filter
            client.patch = AsyncMock(return_value=[])
            mock_client.return_value = client

            # Should not raise
            await cache_extraction(canonical_url, [place], source="caption")

    @pytest.mark.asyncio
    async def test_no_get_call_made(self):
        """Verify cache_extraction does NOT make a GET call (atomic update)."""
        canonical_url = "https://www.tiktok.com/@user/video/no-get"
        place = make_detected_place("Place")

        with patch(
            "app.services.extraction_cache.get_service_supabase_client"
        ) as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(return_value=[{"ok": True}])
            client.get = AsyncMock()
            mock_client.return_value = client

            await cache_extraction(canonical_url, [place], source="caption")

            # No GET should be called — the update is atomic
            client.get.assert_not_called()


class TestCacheExtractionConcurrency:
    """Tests verifying the atomic approach prevents TOCTOU race conditions."""

    @pytest.mark.asyncio
    async def test_concurrent_extractions_both_send_conditional_patch(self):
        """Concurrent caption and video_frames both send atomic conditional PATCHes.

        With PostgREST, the database handles the conflict atomically.
        Both calls should send a PATCH — the DB WHERE clause determines the winner.
        """
        canonical_url = "https://www.tiktok.com/@user/video/race123"
        video_place = make_detected_place("Video Place")
        caption_place = make_detected_place("Caption Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            await asyncio.sleep(0.01)  # Simulate network latency
            patch_calls.append(
                {"table": table, "data": data.copy(), "params": params.copy()}
            )
            return [data]

        with patch(
            "app.services.extraction_cache.get_service_supabase_client"
        ) as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            mock_client.return_value = client

            await asyncio.gather(
                cache_extraction(canonical_url, [caption_place], source="caption"),
                cache_extraction(canonical_url, [video_place], source="video_frames"),
            )

            # Both should issue a PATCH — the DB handles atomicity
            assert len(patch_calls) == 2
            sources = {call["data"]["extraction_source"] for call in patch_calls}
            assert sources == {"caption", "video_frames"}

            # caption filter should NOT include video_frames
            caption_call = next(
                c for c in patch_calls if c["data"]["extraction_source"] == "caption"
            )
            assert (
                "extraction_source.eq.video_frames" not in caption_call["params"]["or"]
            )

            # video_frames filter SHOULD include caption
            video_call = next(
                c
                for c in patch_calls
                if c["data"]["extraction_source"] == "video_frames"
            )
            assert "extraction_source.eq.caption" in video_call["params"]["or"]


class TestSourceQualityHierarchy:
    """Tests for source quality hierarchy."""

    def test_quality_hierarchy_order(self):
        """Verify the quality hierarchy is: video_frames > carousel > screenshot > caption."""
        assert get_source_priority("video_frames") > get_source_priority("carousel")
        assert get_source_priority("carousel") > get_source_priority("screenshot")
        assert get_source_priority("screenshot") > get_source_priority("caption")

    def test_unknown_source_has_lowest_priority(self):
        """Unknown sources should have lowest priority."""
        assert get_source_priority("caption") > get_source_priority("unknown")
        assert get_source_priority("caption") > get_source_priority(None)


class TestShouldUpdateCache:
    """Tests for should_update_cache helper function."""

    def test_should_update_when_no_existing(self):
        """Should update when no existing extraction."""
        assert should_update_cache(None, "caption") is True
        assert should_update_cache(None, "video_frames") is True

    def test_should_update_when_higher_quality(self):
        """Should update when new source is higher quality."""
        assert should_update_cache("caption", "video_frames") is True
        assert should_update_cache("caption", "carousel") is True
        assert should_update_cache("caption", "screenshot") is True
        assert should_update_cache("screenshot", "video_frames") is True

    def test_should_not_update_when_lower_quality(self):
        """Should not update when new source is lower quality."""
        assert should_update_cache("video_frames", "caption") is False
        assert should_update_cache("carousel", "caption") is False
        assert should_update_cache("screenshot", "caption") is False
        assert should_update_cache("video_frames", "screenshot") is False

    def test_should_update_when_same_source(self):
        """Should update when same source (allow re-extraction)."""
        assert should_update_cache("caption", "caption") is True
        assert should_update_cache("video_frames", "video_frames") is True
