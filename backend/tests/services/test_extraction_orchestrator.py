"""Tests for ExtractionOrchestrator behaviors."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.social_ingest import DetectedPlace
from app.services.extraction_cache import CachedExtractionResult
from app.services.extraction_orchestrator import ExtractionOrchestrator


@pytest.mark.asyncio
async def test_cached_empty_result_returns_none_method():
    orchestrator = ExtractionOrchestrator(enable_video_fallback=False)
    orchestrator._extract_from_caption = AsyncMock()

    cached = CachedExtractionResult(
        places=[],
        source="caption",
        extraction_at=datetime.now(UTC),
    )

    with patch(
        "app.services.extraction_orchestrator.get_cached_extraction",
        return_value=cached,
    ):
        result = await orchestrator.extract(
            "https://example.com/post",
            oembed=None,
            caption=None,
            use_cache=True,
            is_video_url=False,
        )

    assert result.from_cache is True
    assert result.places == []
    assert result.method == "none"
    orchestrator._extract_from_caption.assert_not_called()


@pytest.mark.asyncio
async def test_negative_cache_saved_when_no_places():
    orchestrator = ExtractionOrchestrator(enable_video_fallback=False)
    orchestrator._cache_result = AsyncMock()
    orchestrator._extract_from_caption = AsyncMock(
        return_value=orchestrator._CaptionResult(
            places=[],
            method="none",
            skip_to_video=False,
            context_location=None,
            location_hint_country_codes=[],
        )
    )

    with patch(
        "app.services.extraction_orchestrator.get_cached_extraction",
        return_value=None,
    ):
        result = await orchestrator.extract(
            "https://example.com/post",
            oembed=None,
            caption="",
            use_cache=True,
            is_video_url=False,
        )

    assert result.places == []
    assert result.method == "none"
    orchestrator._cache_result.assert_awaited_once_with(
        "https://example.com/post", [], "caption"
    )


def test_calculate_max_frames_duration_based():
    orchestrator = ExtractionOrchestrator(max_video_frames=30)

    assert orchestrator._calculate_max_frames(None) == 30
    assert orchestrator._calculate_max_frames(20.0) == 20
    assert orchestrator._calculate_max_frames(12.0) == 12
    assert orchestrator._calculate_max_frames(5.0) == 5


@pytest.fixture
def mock_detected_place():
    """Create a mock detected place."""
    return DetectedPlace(
        google_place_id="ChIJ123",
        name="Test Restaurant",
        address="123 Main St",
        country="United States",
        country_code="US",
        confidence=0.9,
    )


class TestExtractionMethodParameter:
    """Tests for extraction_method parameter behavior in ExtractionOrchestrator."""

    @pytest.mark.asyncio
    async def test_llm_only_does_not_fallback_to_regex(self, mock_detected_place):
        """When extraction_method=llm, regex should NOT be called even if LLM fails."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=False)

        # Mock LLM extraction to return no places
        mock_llm_result = MagicMock()
        mock_llm_result.places = []
        mock_llm_result.skip_to_video = False
        mock_llm_result.context_location = None

        with patch(
            "app.services.extraction_orchestrator.try_llm_multi_place_extraction",
            new_callable=AsyncMock,
            return_value=mock_llm_result,
        ) as mock_llm:
            with patch(
                "app.services.extraction_orchestrator.extract_place_with_method",
                new_callable=AsyncMock,
            ) as mock_regex:
                with patch(
                    "app.services.extraction_orchestrator.get_cached_extraction",
                    new_callable=AsyncMock,
                    return_value=None,
                ):
                    result = await orchestrator.extract(
                        "https://example.com/video/123",
                        None,
                        "Test caption",
                        use_cache=False,
                        is_video_url=False,
                        extraction_method="llm",
                    )

                    # LLM should have been called
                    mock_llm.assert_called_once()
                    # Regex should NOT have been called
                    mock_regex.assert_not_called()
                    # Result should indicate no places found
                    assert result.places == []
                    assert result.method == "none"

    @pytest.mark.asyncio
    async def test_regex_only_does_not_call_llm(self, mock_detected_place):
        """When extraction_method=regex, LLM should NOT be called."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=False)

        # Mock regex extraction to return a place
        mock_regex_result = MagicMock()
        mock_regex_result.place = mock_detected_place
        mock_regex_result.method = "regex"

        with patch(
            "app.services.extraction_orchestrator.try_llm_multi_place_extraction",
            new_callable=AsyncMock,
        ) as mock_llm:
            with patch(
                "app.services.extraction_orchestrator.extract_place_with_method",
                new_callable=AsyncMock,
                return_value=mock_regex_result,
            ) as mock_regex:
                with patch(
                    "app.services.extraction_orchestrator.get_cached_extraction",
                    new_callable=AsyncMock,
                    return_value=None,
                ):
                    result = await orchestrator.extract(
                        "https://example.com/video/123",
                        None,
                        "Test caption",
                        use_cache=False,
                        is_video_url=False,
                        extraction_method="regex",
                    )

                    # LLM should NOT have been called
                    mock_llm.assert_not_called()
                    # Regex should have been called
                    mock_regex.assert_called_once()
                    # Result should contain the regex-extracted place
                    assert len(result.places) == 1
                    assert result.places[0].name == "Test Restaurant"
                    assert result.method == "regex"

    @pytest.mark.asyncio
    async def test_auto_tries_llm_then_regex_on_failure(self, mock_detected_place):
        """When extraction_method=auto, should try LLM first, then regex fallback."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=False)

        # Mock LLM extraction to return no places
        mock_llm_result = MagicMock()
        mock_llm_result.places = []
        mock_llm_result.skip_to_video = False
        mock_llm_result.context_location = None

        # Mock regex extraction to return a place
        mock_regex_result = MagicMock()
        mock_regex_result.place = mock_detected_place
        mock_regex_result.method = "regex"

        with patch(
            "app.services.extraction_orchestrator.try_llm_multi_place_extraction",
            new_callable=AsyncMock,
            return_value=mock_llm_result,
        ) as mock_llm:
            with patch(
                "app.services.extraction_orchestrator.extract_place_with_method",
                new_callable=AsyncMock,
                return_value=mock_regex_result,
            ) as mock_regex:
                with patch(
                    "app.services.extraction_orchestrator.get_cached_extraction",
                    new_callable=AsyncMock,
                    return_value=None,
                ):
                    result = await orchestrator.extract(
                        "https://example.com/video/123",
                        None,
                        "Test caption",
                        use_cache=False,
                        is_video_url=False,
                        extraction_method="auto",
                    )

                    # Both should have been called (LLM failed, regex succeeded)
                    mock_llm.assert_called_once()
                    mock_regex.assert_called_once()
                    # Result should contain the regex-extracted place
                    assert len(result.places) == 1
                    assert result.method == "regex"

    @pytest.mark.asyncio
    async def test_auto_uses_llm_result_when_successful(self, mock_detected_place):
        """When extraction_method=auto and LLM succeeds, should NOT call regex."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=False)

        # Mock LLM extraction to return a place
        mock_llm_result = MagicMock()
        mock_llm_result.places = [mock_detected_place]
        mock_llm_result.skip_to_video = False
        mock_llm_result.context_location = "United States"

        with patch(
            "app.services.extraction_orchestrator.try_llm_multi_place_extraction",
            new_callable=AsyncMock,
            return_value=mock_llm_result,
        ) as mock_llm:
            with patch(
                "app.services.extraction_orchestrator.extract_place_with_method",
                new_callable=AsyncMock,
            ) as mock_regex:
                with patch(
                    "app.services.extraction_orchestrator.get_cached_extraction",
                    new_callable=AsyncMock,
                    return_value=None,
                ):
                    with patch(
                        "app.services.extraction_orchestrator.cache_extraction",
                        new_callable=AsyncMock,
                    ):
                        result = await orchestrator.extract(
                            "https://example.com/video/123",
                            None,
                            "Test caption",
                            use_cache=False,
                            is_video_url=False,
                            extraction_method="auto",
                        )

                        # LLM should have been called
                        mock_llm.assert_called_once()
                        # Regex should NOT have been called (LLM succeeded)
                        mock_regex.assert_not_called()
                        # Result should contain the LLM-extracted place
                        assert len(result.places) == 1
                        assert result.method == "llm"
                        assert result.context_location == "United States"

    @pytest.mark.asyncio
    async def test_regex_only_returns_empty_when_no_match(self):
        """When extraction_method=regex and no match, should return empty result."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=False)

        # Mock regex extraction to return no place
        mock_regex_result = MagicMock()
        mock_regex_result.place = None
        mock_regex_result.method = "none"

        with patch(
            "app.services.extraction_orchestrator.try_llm_multi_place_extraction",
            new_callable=AsyncMock,
        ) as mock_llm:
            with patch(
                "app.services.extraction_orchestrator.extract_place_with_method",
                new_callable=AsyncMock,
                return_value=mock_regex_result,
            ):
                with patch(
                    "app.services.extraction_orchestrator.get_cached_extraction",
                    new_callable=AsyncMock,
                    return_value=None,
                ):
                    result = await orchestrator.extract(
                        "https://example.com/video/123",
                        None,
                        "Test caption",
                        use_cache=False,
                        is_video_url=False,
                        extraction_method="regex",
                    )

                    # LLM should NOT have been called
                    mock_llm.assert_not_called()
                    # Result should be empty
                    assert result.places == []
                    assert result.method == "none"


class TestMultiPlaceResolutionTimeout:
    """Tests for timeout handling in _resolve_multimodal_places.

    These tests verify that _resolve_multimodal_places respects the total timeout
    budget and applies per-call timeouts to prevent hangs when Google Places API
    is slow.
    """

    @pytest.mark.asyncio
    async def test_multi_place_resolution_respects_timeout(self):
        """Verify that _resolve_multimodal_places enforces time budget.

        With 10 places, semaphore=5, and slow API calls, the resolution should:
        1. Time out individual calls that exceed the per-call limit
        2. Return partial results when budget is exhausted
        3. Not block indefinitely
        """
        import asyncio
        import time

        from app.services.multimodal_extractor import ExtractedPlace

        orchestrator = ExtractionOrchestrator(
            total_timeout=2.0,  # Short timeout
            enable_video_fallback=False,
        )

        # Create 10 extracted places that need resolution
        extracted_places = [
            ExtractedPlace(
                name=f"Place {i}",
                city="New York",
                country="USA",
                entry_type="place",
            )
            for i in range(10)
        ]

        # Mock try_candidate to be slow (simulating slow Google Places API)
        slow_call_count = 0

        async def slow_try_candidate(query, location_bias=None):
            nonlocal slow_call_count
            slow_call_count += 1
            await asyncio.sleep(0.5)  # Each call takes 500ms
            return DetectedPlace(
                google_place_id=f"ChIJ{slow_call_count}",
                name=f"Resolved {query}",
                address="123 Test St",
                country="USA",
                country_code="US",
                confidence=0.9,
            )

        start_time = time.monotonic()

        with patch(
            "app.services.extraction_orchestrator.try_candidate",
            new_callable=AsyncMock,
            side_effect=slow_try_candidate,
        ):
            with patch(
                "app.services.extraction_orchestrator.extract_location_hints",
                return_value=[],
            ):
                # Call with start_time to enable timeout enforcement
                result = await orchestrator._resolve_multimodal_places(
                    extracted_places, start_time
                )

        elapsed = time.monotonic() - start_time

        # With proper timeout enforcement:
        # - Resolution completes within the time budget
        # - Some places may be resolved (depending on timing)
        assert elapsed < 2.5, f"Should complete within budget, took {elapsed:.2f}s"
        assert isinstance(result, list), "Should return a list of places"

    @pytest.mark.asyncio
    async def test_resolve_multimodal_places_returns_empty_when_no_time(self):
        """Verify that _resolve_multimodal_places returns empty when no time left."""
        import time

        from app.services.multimodal_extractor import ExtractedPlace

        orchestrator = ExtractionOrchestrator(
            total_timeout=1.0,
            enable_video_fallback=False,
        )

        extracted_places = [
            ExtractedPlace(
                name="Test Place",
                city="New York",
                country="USA",
                entry_type="place",
            )
        ]

        # Simulate start_time that's already past the timeout
        past_start = time.monotonic() - 10.0  # 10 seconds ago

        result = await orchestrator._resolve_multimodal_places(
            extracted_places, past_start
        )

        assert result == [], "Should return empty list when no time remaining"

    @pytest.mark.asyncio
    async def test_extract_from_frames_passes_start_time_to_resolution(self):
        """Verify extract_from_frames passes start_time to resolution."""
        from app.schemas.social_ingest import OEmbedResponse
        from app.services.multimodal_extractor import (
            ExtractedPlace,
            MultimodalExtractionResult,
        )

        orchestrator = ExtractionOrchestrator(
            total_timeout=15.0,
            enable_video_fallback=False,
        )

        # Track if _resolve_multimodal_places receives start_time
        resolve_called_with_start_time = False
        original_resolve = orchestrator._resolve_multimodal_places

        async def tracking_resolve(extracted, start_time):
            nonlocal resolve_called_with_start_time
            # Verify start_time is passed and is a valid monotonic time
            if isinstance(start_time, float) and start_time > 0:
                resolve_called_with_start_time = True
            return await original_resolve(extracted, start_time)

        orchestrator._resolve_multimodal_places = tracking_resolve

        # Mock the multimodal extractor
        mock_result = MultimodalExtractionResult(
            places=[
                ExtractedPlace(
                    name="Test Place",
                    city="New York",
                    country="USA",
                    entry_type="place",
                )
            ],
            frames_processed=1,
            source="video_frames",
        )

        with patch(
            "app.services.extraction_orchestrator.get_cached_extraction",
            return_value=None,
        ):
            with patch.object(
                orchestrator.multimodal_extractor,
                "extract_places",
                return_value=mock_result,
            ):
                with patch(
                    "app.services.extraction_orchestrator.try_candidate",
                    return_value=DetectedPlace(
                        google_place_id="ChIJ123",
                        name="Resolved Place",
                        country="USA",
                        country_code="US",
                        confidence=0.9,
                    ),
                ):
                    with patch(
                        "app.services.extraction_orchestrator.extract_location_hints",
                        return_value=[],
                    ):
                        await orchestrator.extract_from_frames(
                            "https://example.com/video",
                            OEmbedResponse(title="Test"),
                            "Test caption",
                            [b"frame1"],
                            use_cache=False,
                        )

        assert (
            resolve_called_with_start_time
        ), "extract_from_frames should pass start_time to _resolve_multimodal_places"


class TestCountryMismatchFallback:
    """Tests for country mismatch detection triggering video fallback."""

    def test_has_country_mismatch_no_places(self):
        """No mismatch when there are no places."""
        orchestrator = ExtractionOrchestrator()
        assert orchestrator._has_country_mismatch([], ["GE"]) is False

    def test_has_country_mismatch_no_hints(self):
        """No mismatch when there are no hints to compare."""
        orchestrator = ExtractionOrchestrator()
        place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Test Place",
            country_code="US",
            confidence=0.9,
        )
        assert orchestrator._has_country_mismatch([place], []) is False

    def test_has_country_mismatch_country_matches(self):
        """No mismatch when place country matches a hint."""
        orchestrator = ExtractionOrchestrator()
        place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Tbilisi Restaurant",
            country_code="GE",
            confidence=0.9,
        )
        assert orchestrator._has_country_mismatch([place], ["GE"]) is False

    def test_has_country_mismatch_country_does_not_match(self):
        """Mismatch when place country doesn't match any hint."""
        orchestrator = ExtractionOrchestrator()
        # Place in Italy but hints mention Georgia
        place = DetectedPlace(
            google_place_id="ChIJ123",
            name="ROMA IS ALWAYS a GOOD IDEA",
            country_code="IT",
            confidence=0.74,
        )
        assert orchestrator._has_country_mismatch([place], ["GE"]) is True

    def test_has_country_mismatch_multiple_hints_one_matches(self):
        """No mismatch when place matches at least one hint country."""
        orchestrator = ExtractionOrchestrator()
        place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Test Place",
            country_code="GE",
            confidence=0.9,
        )
        # Hints mention both Georgia and Turkey
        assert orchestrator._has_country_mismatch([place], ["GE", "TR"]) is False

    def test_has_country_mismatch_multiple_places_one_matches(self):
        """No mismatch when at least one place matches a hint."""
        orchestrator = ExtractionOrchestrator()
        places = [
            DetectedPlace(
                google_place_id="ChIJ1",
                name="Place in Italy",
                country_code="IT",
                confidence=0.8,
            ),
            DetectedPlace(
                google_place_id="ChIJ2",
                name="Place in Georgia",
                country_code="GE",
                confidence=0.9,
            ),
        ]
        assert orchestrator._has_country_mismatch(places, ["GE"]) is False

    @pytest.mark.asyncio
    async def test_country_mismatch_triggers_video_fallback(self):
        """When regex finds a place in wrong country, should try video extraction."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=True)

        # Mock caption extraction returning a place in Italy when hints say Georgia
        italy_place = DetectedPlace(
            google_place_id="ChIJ123",
            name="ROMA IS ALWAYS a GOOD IDEA",
            country_code="IT",
            confidence=0.74,
        )

        # Mock the caption extraction to return Italy place with Georgia hints
        orchestrator._extract_from_caption = AsyncMock(
            return_value=orchestrator._CaptionResult(
                places=[italy_place],
                method="regex",
                skip_to_video=False,
                context_location="Tbilisi",
                location_hint_country_codes=["GE"],  # Georgia
            )
        )

        # Mock video extraction to return correct Georgian place
        georgia_place = DetectedPlace(
            google_place_id="ChIJ456",
            name="Tbilisi Restaurant",
            country_code="GE",
            confidence=0.95,
        )
        orchestrator._extract_from_video = AsyncMock(
            return_value=orchestrator._VideoResult(places=[georgia_place])
        )
        orchestrator._cache_result = AsyncMock()

        with patch(
            "app.services.extraction_orchestrator.get_cached_extraction",
            return_value=None,
        ):
            with patch(
                "app.services.extraction_orchestrator.download_video",
                new_callable=AsyncMock,
                return_value="/tmp/video.mp4",
            ):
                result = await orchestrator.extract(
                    "https://www.instagram.com/reel/ABC123",
                    oembed=None,
                    caption="Tbilisi is always a good idea",
                    use_cache=True,
                    is_video_url=True,
                )

        # Should have tried video extraction due to country mismatch
        orchestrator._extract_from_video.assert_awaited_once()
        # Should return the video result (Georgian place)
        assert len(result.places) == 1
        assert result.places[0].country_code == "GE"
        assert result.method == "video"

    @pytest.mark.asyncio
    async def test_country_match_does_not_trigger_video_fallback(self):
        """When regex finds a place in correct country, should NOT try video."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=True)

        # Mock caption extraction returning a place in Georgia matching hints
        georgia_place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Tbilisi Restaurant",
            country_code="GE",
            confidence=0.85,
        )

        orchestrator._extract_from_caption = AsyncMock(
            return_value=orchestrator._CaptionResult(
                places=[georgia_place],
                method="regex",
                skip_to_video=False,
                context_location="Tbilisi",
                location_hint_country_codes=["GE"],  # Georgia matches
            )
        )
        orchestrator._extract_from_video = AsyncMock()
        orchestrator._cache_result = AsyncMock()

        with patch(
            "app.services.extraction_orchestrator.get_cached_extraction",
            return_value=None,
        ):
            result = await orchestrator.extract(
                "https://www.instagram.com/reel/ABC123",
                oembed=None,
                caption="Tbilisi Restaurant review",
                use_cache=True,
                is_video_url=True,
            )

        # Should NOT have tried video extraction
        orchestrator._extract_from_video.assert_not_awaited()
        # Should return the caption result
        assert len(result.places) == 1
        assert result.places[0].country_code == "GE"
        assert result.method == "regex"

    def test_has_country_mismatch_multi_country_minority_not_flagged(self):
        """A place from a minority country should NOT mismatch when that country
        is included in the raw (unfiltered) hint country codes."""
        orchestrator = ExtractionOrchestrator()
        # Place in Slovenia (minority country in multi-country caption)
        place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Ljubljana Castle",
            country_code="SI",
            confidence=0.85,
        )
        # Raw hint country codes include both Italy (majority) and Slovenia (minority)
        assert orchestrator._has_country_mismatch([place], ["IT", "SI"]) is False

    @pytest.mark.asyncio
    async def test_multi_country_caption_minority_no_video_fallback(self):
        """When caption mentions cities from multiple countries, a place in the
        minority country should NOT trigger video fallback."""
        orchestrator = ExtractionOrchestrator(enable_video_fallback=True)

        # Place found in Slovenia (the minority country)
        si_place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Ljubljana Castle",
            country_code="SI",
            confidence=0.85,
        )

        # Caption result includes SI in hint_country_codes (from raw hints)
        orchestrator._extract_from_caption = AsyncMock(
            return_value=orchestrator._CaptionResult(
                places=[si_place],
                method="llm",
                skip_to_video=False,
                context_location="Ljubljana",
                location_hint_country_codes=["IT", "SI"],
            )
        )
        orchestrator._extract_from_video = AsyncMock()
        orchestrator._cache_result = AsyncMock()

        with patch(
            "app.services.extraction_orchestrator.get_cached_extraction",
            return_value=None,
        ):
            result = await orchestrator.extract(
                "https://www.instagram.com/reel/ABC123",
                oembed=None,
                caption="Trip to Rome, Milan, Florence, and Ljubljana",
                use_cache=True,
                is_video_url=True,
            )

        # Should NOT trigger video fallback
        orchestrator._extract_from_video.assert_not_awaited()
        assert result.places[0].country_code == "SI"
        assert result.method == "llm"
