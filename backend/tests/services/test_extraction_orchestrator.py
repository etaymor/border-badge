"""Tests for the extraction orchestrator."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.social_ingest import DetectedPlace
from app.services.extraction_orchestrator import ExtractionOrchestrator


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
