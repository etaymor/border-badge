"""Tests for extraction cache service."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.social_ingest import DetectedPlace
from app.services.extraction_cache import cache_extraction


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


class TestCacheExtractionRaceCondition:
    """Tests for race condition handling in cache_extraction."""

    @pytest.mark.asyncio
    async def test_video_frames_not_overwritten_by_caption(self):
        """Video frame extraction should not be overwritten by caption extraction.

        This tests the race condition where two concurrent requests both miss the cache.
        If video_frames extraction completes first, a slower caption extraction should
        not overwrite it since video_frames is higher quality.
        """
        canonical_url = "https://www.tiktok.com/@user/video/123"
        video_place = make_detected_place("Video Extracted Place")
        caption_place = make_detected_place("Caption Extracted Place")

        # Track patch calls to verify conditional update logic
        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append(
                {"table": table, "data": data.copy(), "params": params.copy()}
            )
            # Return updated rows to indicate success
            return [data]

        async def mock_get(table, params):
            # For the first call (video_frames), no existing extraction
            # For the second call (caption), video_frames already exists
            if len(patch_calls) == 0:
                # First check - no existing extraction
                return [
                    {
                        "extraction_result": None,
                        "extraction_source": None,
                        "extraction_at": None,
                    }
                ]
            else:
                # Second check - video_frames already cached
                return [
                    {
                        "extraction_result": [
                            {
                                "google_place_id": "ChIJ123",
                                "name": "Video Extracted Place",
                                "address": "123 Test St",
                                "latitude": 40.7128,
                                "longitude": -74.0060,
                                "city": "New York",
                                "country": "United States",
                                "country_code": "US",
                                "confidence": 0.9,
                                "primary_type": "restaurant",
                                "types": ["restaurant"],
                                "llm_entry_type": "Food",
                            }
                        ],
                        "extraction_source": "video_frames",
                        "extraction_at": datetime.now(UTC).isoformat(),
                    }
                ]

        with patch("app.services.extraction_cache.get_supabase_client") as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            client.get = AsyncMock(side_effect=mock_get)
            mock_client.return_value = client

            # First: Cache video_frames extraction (should succeed)
            await cache_extraction(canonical_url, [video_place], source="video_frames")

            # Second: Try to cache caption extraction (should be skipped)
            await cache_extraction(canonical_url, [caption_place], source="caption")

            # Verify video_frames was cached
            assert len(patch_calls) == 1
            assert patch_calls[0]["data"]["extraction_source"] == "video_frames"
            assert patch_calls[0]["data"]["extraction_result"][0]["name"] == (
                "Video Extracted Place"
            )

    @pytest.mark.asyncio
    async def test_caption_can_overwrite_empty_cache(self):
        """Caption extraction should be cached when no existing result."""
        canonical_url = "https://www.tiktok.com/@user/video/456"
        caption_place = make_detected_place("Caption Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append(
                {"table": table, "data": data.copy(), "params": params.copy()}
            )
            return [data]

        async def mock_get(table, params):
            # No existing extraction
            return [
                {
                    "extraction_result": None,
                    "extraction_source": None,
                    "extraction_at": None,
                }
            ]

        with patch("app.services.extraction_cache.get_supabase_client") as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            client.get = AsyncMock(side_effect=mock_get)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [caption_place], source="caption")

            assert len(patch_calls) == 1
            assert patch_calls[0]["data"]["extraction_source"] == "caption"

    @pytest.mark.asyncio
    async def test_video_frames_can_overwrite_caption(self):
        """Video frames should overwrite caption extraction (higher quality)."""
        canonical_url = "https://www.tiktok.com/@user/video/789"
        video_place = make_detected_place("Video Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append(
                {"table": table, "data": data.copy(), "params": params.copy()}
            )
            return [data]

        async def mock_get(table, params):
            # Caption already cached
            return [
                {
                    "extraction_result": [
                        {
                            "google_place_id": "ChIJ456",
                            "name": "Old Caption Place",
                            "address": "456 Old St",
                            "latitude": 40.0,
                            "longitude": -74.0,
                            "city": "NYC",
                            "country": "USA",
                            "country_code": "US",
                            "confidence": 0.7,
                            "primary_type": "cafe",
                            "types": ["cafe"],
                            "llm_entry_type": "Food",
                        }
                    ],
                    "extraction_source": "caption",
                    "extraction_at": datetime.now(UTC).isoformat(),
                }
            ]

        with patch("app.services.extraction_cache.get_supabase_client") as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            client.get = AsyncMock(side_effect=mock_get)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [video_place], source="video_frames")

            assert len(patch_calls) == 1
            assert patch_calls[0]["data"]["extraction_source"] == "video_frames"
            assert patch_calls[0]["data"]["extraction_result"][0]["name"] == (
                "Video Place"
            )

    @pytest.mark.asyncio
    async def test_same_source_can_overwrite(self):
        """Same source type can overwrite existing cache (re-extraction)."""
        canonical_url = "https://www.tiktok.com/@user/video/999"
        new_caption_place = make_detected_place("New Caption Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append(
                {"table": table, "data": data.copy(), "params": params.copy()}
            )
            return [data]

        async def mock_get(table, params):
            # Old caption already cached
            return [
                {
                    "extraction_result": [
                        {
                            "google_place_id": "ChIJ111",
                            "name": "Old Caption Place",
                            "address": "111 Old St",
                            "latitude": 40.0,
                            "longitude": -74.0,
                            "city": "NYC",
                            "country": "USA",
                            "country_code": "US",
                            "confidence": 0.5,
                            "primary_type": "shop",
                            "types": ["shop"],
                            "llm_entry_type": "Place",
                        }
                    ],
                    "extraction_source": "caption",
                    "extraction_at": datetime.now(UTC).isoformat(),
                }
            ]

        with patch("app.services.extraction_cache.get_supabase_client") as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            client.get = AsyncMock(side_effect=mock_get)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [new_caption_place], source="caption")

            # Same source should allow overwrite
            assert len(patch_calls) == 1
            assert patch_calls[0]["data"]["extraction_source"] == "caption"
            assert patch_calls[0]["data"]["extraction_result"][0]["name"] == (
                "New Caption Place"
            )

    @pytest.mark.asyncio
    async def test_carousel_not_overwritten_by_caption(self):
        """Carousel extraction (higher quality) should not be overwritten by caption."""
        canonical_url = "https://www.instagram.com/p/abc123"
        caption_place = make_detected_place("Caption Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append(
                {"table": table, "data": data.copy(), "params": params.copy()}
            )
            return [data]

        async def mock_get(table, params):
            # Carousel already cached
            return [
                {
                    "extraction_result": [
                        {
                            "google_place_id": "ChIJ222",
                            "name": "Carousel Place",
                            "address": "222 Carousel St",
                            "latitude": 40.0,
                            "longitude": -74.0,
                            "city": "NYC",
                            "country": "USA",
                            "country_code": "US",
                            "confidence": 0.95,
                            "primary_type": "restaurant",
                            "types": ["restaurant"],
                            "llm_entry_type": "Food",
                        }
                    ],
                    "extraction_source": "carousel",
                    "extraction_at": datetime.now(UTC).isoformat(),
                }
            ]

        with patch("app.services.extraction_cache.get_supabase_client") as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            client.get = AsyncMock(side_effect=mock_get)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [caption_place], source="caption")

            # Caption should not overwrite carousel
            assert len(patch_calls) == 0

    @pytest.mark.asyncio
    async def test_screenshot_not_overwritten_by_caption(self):
        """Screenshot extraction should not be overwritten by caption."""
        canonical_url = "https://www.tiktok.com/@user/video/111"
        caption_place = make_detected_place("Caption Place")

        patch_calls = []

        async def mock_patch(table, data, params):
            patch_calls.append(
                {"table": table, "data": data.copy(), "params": params.copy()}
            )
            return [data]

        async def mock_get(table, params):
            # Screenshot already cached
            return [
                {
                    "extraction_result": [
                        {
                            "google_place_id": "ChIJ333",
                            "name": "Screenshot Place",
                            "address": "333 Screenshot St",
                            "latitude": 40.0,
                            "longitude": -74.0,
                            "city": "NYC",
                            "country": "USA",
                            "country_code": "US",
                            "confidence": 0.85,
                            "primary_type": "hotel",
                            "types": ["hotel"],
                            "llm_entry_type": "Stay",
                        }
                    ],
                    "extraction_source": "screenshot",
                    "extraction_at": datetime.now(UTC).isoformat(),
                }
            ]

        with patch("app.services.extraction_cache.get_supabase_client") as mock_client:
            client = MagicMock()
            client.patch = AsyncMock(side_effect=mock_patch)
            client.get = AsyncMock(side_effect=mock_get)
            mock_client.return_value = client

            await cache_extraction(canonical_url, [caption_place], source="caption")

            # Caption should not overwrite screenshot
            assert len(patch_calls) == 0


class TestSourceQualityHierarchy:
    """Tests for source quality hierarchy."""

    @pytest.mark.asyncio
    async def test_quality_hierarchy_order(self):
        """Verify the quality hierarchy is: video_frames > carousel > screenshot > caption."""
        from app.services.extraction_cache import get_source_priority

        assert get_source_priority("video_frames") > get_source_priority("carousel")
        assert get_source_priority("carousel") > get_source_priority("screenshot")
        assert get_source_priority("screenshot") > get_source_priority("caption")

    @pytest.mark.asyncio
    async def test_unknown_source_has_lowest_priority(self):
        """Unknown sources should have lowest priority."""
        from app.services.extraction_cache import get_source_priority

        assert get_source_priority("caption") > get_source_priority("unknown")
        assert get_source_priority("caption") > get_source_priority(None)


class TestShouldUpdateCache:
    """Tests for should_update_cache helper function."""

    @pytest.mark.asyncio
    async def test_should_update_when_no_existing(self):
        """Should update when no existing extraction."""
        from app.services.extraction_cache import should_update_cache

        assert should_update_cache(None, "caption") is True
        assert should_update_cache(None, "video_frames") is True

    @pytest.mark.asyncio
    async def test_should_update_when_higher_quality(self):
        """Should update when new source is higher quality."""
        from app.services.extraction_cache import should_update_cache

        assert should_update_cache("caption", "video_frames") is True
        assert should_update_cache("caption", "carousel") is True
        assert should_update_cache("caption", "screenshot") is True
        assert should_update_cache("screenshot", "video_frames") is True

    @pytest.mark.asyncio
    async def test_should_not_update_when_lower_quality(self):
        """Should not update when new source is lower quality."""
        from app.services.extraction_cache import should_update_cache

        assert should_update_cache("video_frames", "caption") is False
        assert should_update_cache("carousel", "caption") is False
        assert should_update_cache("screenshot", "caption") is False
        assert should_update_cache("video_frames", "screenshot") is False

    @pytest.mark.asyncio
    async def test_should_update_when_same_source(self):
        """Should update when same source (allow re-extraction)."""
        from app.services.extraction_cache import should_update_cache

        assert should_update_cache("caption", "caption") is True
        assert should_update_cache("video_frames", "video_frames") is True
