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
    orchestrator = ExtractionOrchestrator(max_video_frames=15)

    assert orchestrator._calculate_max_frames(None) == 15
    assert orchestrator._calculate_max_frames(20.0) == 10
    assert orchestrator._calculate_max_frames(12.0) == 6
    assert orchestrator._calculate_max_frames(5.0) == 2


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

    The current implementation calls try_candidate (Google Places API) for up to
    10 places with a semaphore, but has no timeout. If the Google Places API is
    slow, this could exceed the 15s total budget and cause the request to hang.

    These tests demonstrate the bug and expected fix behavior.
    """

    @pytest.mark.asyncio
    async def test_multi_place_resolution_can_exceed_total_timeout(self):
        """Demonstrates that _resolve_multimodal_places has no timeout protection.

        The bug: Each try_candidate call can take up to ~3s (network timeout),
        and with 10 places resolved in parallel (semaphore=5), worst case is
        2 batches * 3s = 6s just for resolution, which could push total time
        well over the 15s budget if video download and frame extraction took time.

        Expected fix: Each try_candidate call should have a timeout based on
        remaining time budget, and the entire resolution should respect the
        overall extraction timeout.
        """
        import asyncio
        import time

        from app.services.multimodal_extractor import ExtractedPlace

        orchestrator = ExtractionOrchestrator(
            total_timeout=2.0,  # Very short timeout to demonstrate issue
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
                # This should respect timeout but currently doesn't
                await orchestrator._resolve_multimodal_places(extracted_places)

        elapsed = time.monotonic() - start_time

        # The bug: With 10 places, semaphore=5, and 500ms per call:
        # - First batch of 5 takes 500ms
        # - Second batch of 5 takes 500ms
        # - Total ~1s minimum, but no timeout applied
        #
        # Expected behavior (after fix):
        # - Resolution should timeout after remaining budget is exhausted
        # - Or each call should have individual timeout
        #
        # This assertion documents the bug - the call completes in ~1s
        # even though we set total_timeout=2s, the _resolve_multimodal_places
        # method doesn't check or enforce any timeout
        assert elapsed >= 1.0, f"Expected at least 1s, got {elapsed:.2f}s"
        assert slow_call_count == 10, f"Expected 10 calls, got {slow_call_count}"

        # After the fix, this test should show that:
        # 1. Resolution respects a timeout parameter
        # 2. Places that couldn't be resolved in time are skipped
        # 3. The method returns partial results rather than blocking forever

    @pytest.mark.asyncio
    async def test_resolve_multimodal_places_should_accept_start_time(self):
        """Documents expected fix: _resolve_multimodal_places needs timeout awareness.

        The fix should:
        1. Accept start_time parameter to calculate remaining budget
        2. Apply per-call timeout based on remaining time
        3. Skip remaining places if budget exhausted

        Example fixed signature:
            async def _resolve_multimodal_places(
                self,
                extracted: list[ExtractedPlace],
                start_time: float,  # <-- New parameter
            ) -> list[DetectedPlace]:
                ...
                remaining = self._get_remaining_time(start_time)
                if remaining <= 0:
                    return []

                async def resolve_one(place: ExtractedPlace) -> DetectedPlace | None:
                    async with semaphore:
                        # Calculate remaining time for this call
                        remaining = self._get_remaining_time(start_time)
                        if remaining <= 0:
                            return None

                        try:
                            return await asyncio.wait_for(
                                try_candidate(search_query, location_bias),
                                timeout=min(remaining, 3.0),  # Max 3s per call
                            )
                        except asyncio.TimeoutError:
                            return None
        """
        # This is a documentation test showing the expected fix
        pass

    @pytest.mark.asyncio
    async def test_extract_from_frames_does_not_pass_start_time(self):
        """Documents bug: extract_from_frames doesn't pass timing info to resolution.

        In extract_from_frames (line 291), we call:
            places = await self._resolve_multimodal_places(multimodal_result.places)

        But we don't pass start_time, so the resolution has no way to know
        how much time budget remains. This could cause the entire extraction
        to exceed the expected timeout.
        """
        # The fix should update extract_from_frames to pass start_time:
        #     places = await self._resolve_multimodal_places(
        #         multimodal_result.places,
        #         start_time,  # <-- Pass timing info
        #     )
        pass


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
