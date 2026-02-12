"""Tests for the photo_vision classifier service."""

import json
import logging

from app.services.photo_vision import PhotoClassifier, VisionResult

# ============================================================================
# VisionResult.has_business_name Tests
# ============================================================================


class TestVisionResultHasBusinessName:
    """Tests for VisionResult.has_business_name property."""

    def test_returns_true_for_multi_word_non_generic_text(self) -> None:
        """Multi-word text that isn't generic should indicate a business name."""
        result = VisionResult(
            category="food",
            detected_text=["Sushi Dai"],
            confidence="high",
        )
        assert result.has_business_name is True

    def test_returns_false_for_single_words(self) -> None:
        """Single words are not considered business names."""
        result = VisionResult(
            category="food",
            detected_text=["Restaurant"],
            confidence="high",
        )
        assert result.has_business_name is False

    def test_returns_false_for_generic_words(self) -> None:
        """Generic words like EXIT, OPEN should not count as business names."""
        for word in ["EXIT", "OPEN", "Welcome", "menu", "CLOSED"]:
            result = VisionResult(
                category="unknown",
                detected_text=[word],
                confidence="low",
            )
            assert (
                result.has_business_name is False
            ), f"'{word}' should not be a business name"

    def test_returns_false_for_empty_detected_text(self) -> None:
        """Empty detected text should return False."""
        result = VisionResult(category="food", detected_text=[], confidence="high")
        assert result.has_business_name is False

    def test_returns_false_when_all_words_are_generic(self) -> None:
        """Multi-word text where every word is generic should return False."""
        result = VisionResult(
            category="food",
            detected_text=["open menu"],
            confidence="high",
        )
        assert result.has_business_name is False

    def test_returns_true_with_mixed_detected_text(self) -> None:
        """If any detected_text entry is a valid business name, return True."""
        result = VisionResult(
            category="food",
            detected_text=["EXIT", "Tonkatsu Maisen", "OPEN"],
            confidence="high",
        )
        assert result.has_business_name is True


# ============================================================================
# VisionResult.business_name_candidates Tests
# ============================================================================


class TestVisionResultBusinessNameCandidates:
    """Tests for VisionResult.business_name_candidates property."""

    def test_filters_single_words(self) -> None:
        """Single words should be excluded from candidates."""
        result = VisionResult(
            category="food",
            detected_text=["Starbucks", "Tsukiji Fish Market"],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert candidates == ["Tsukiji Fish Market"]

    def test_filters_generic_words(self) -> None:
        """Generic text should be excluded from candidates."""
        result = VisionResult(
            category="food",
            detected_text=["no smoking", "Ichiran Ramen", "OPEN"],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert candidates == ["Ichiran Ramen"]

    def test_returns_empty_list_for_no_candidates(self) -> None:
        """When no text qualifies, return empty list."""
        result = VisionResult(
            category="unknown",
            detected_text=["EXIT", "PUSH", "OPEN"],
            confidence="low",
        )
        assert result.business_name_candidates == []

    def test_returns_multiple_candidates(self) -> None:
        """Multiple valid business names should all be returned."""
        result = VisionResult(
            category="food",
            detected_text=["Sushi Dai", "Tsukiji Fish Market"],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert len(candidates) == 2
        assert "Sushi Dai" in candidates
        assert "Tsukiji Fish Market" in candidates

    def test_strips_whitespace_from_candidates(self) -> None:
        """Candidates should have leading/trailing whitespace stripped."""
        result = VisionResult(
            category="food",
            detected_text=["  Sushi Dai  "],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert candidates == ["Sushi Dai"]


# ============================================================================
# PhotoClassifier._parse_response Tests
# ============================================================================


class TestParseResponse:
    """Tests for PhotoClassifier._parse_response static method."""

    def test_valid_json_returns_vision_result(self) -> None:
        """Valid JSON with all fields should return a VisionResult."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": ["Sushi Dai", "Tsukiji"],
                "confidence": "high",
                "reasoning": "Restaurant interior with sushi counter visible",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.category == "food"
        assert result.detected_text == ["Sushi Dai", "Tsukiji"]
        assert result.confidence == "high"

    def test_invalid_json_returns_none(self) -> None:
        """Non-JSON content should return None."""
        result = PhotoClassifier._parse_response("not json at all")
        assert result is None

    def test_non_dict_json_returns_none(self) -> None:
        """JSON that parses to non-dict (e.g. list) should return None."""
        result = PhotoClassifier._parse_response("[1, 2, 3]")
        assert result is None

    def test_unknown_category_defaults_to_unknown(self) -> None:
        """Unrecognized category should default to 'unknown'."""
        content = json.dumps(
            {
                "category": "weather",
                "detected_text": [],
                "confidence": "high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.category == "unknown"

    def test_unknown_confidence_defaults_to_low(self) -> None:
        """Unrecognized confidence should default to 'low'."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": [],
                "confidence": "very_high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.confidence == "low"

    def test_missing_fields_use_defaults(self) -> None:
        """Missing fields should use sensible defaults."""
        content = json.dumps({})

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.category == "unknown"
        assert result.detected_text == []
        assert result.confidence == "low"

    def test_detected_text_non_list_defaults_to_empty(self) -> None:
        """If detected_text is not a list, default to empty list."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": "just a string",
                "confidence": "high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.detected_text == []

    def test_detected_text_filters_falsy_items(self) -> None:
        """Empty strings and None values in detected_text should be filtered."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": ["Sushi Dai", "", None, "Menu"],
                "confidence": "high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.detected_text == ["Sushi Dai", "Menu"]

    def test_all_valid_categories_accepted(self) -> None:
        """Every valid category should be accepted without defaulting."""
        valid_categories = [
            "food",
            "landmark",
            "stay",
            "shopping",
            "nature",
            "nightlife",
            "transport",
            "unknown",
        ]
        for cat in valid_categories:
            content = json.dumps(
                {
                    "category": cat,
                    "detected_text": [],
                    "confidence": "high",
                    "reasoning": "test",
                }
            )
            result = PhotoClassifier._parse_response(content)
            assert result is not None
            assert result.category == cat, f"Category '{cat}' should be accepted"

    def test_all_valid_confidence_levels_accepted(self) -> None:
        """Every valid confidence level should be accepted without defaulting."""
        for level in ["high", "medium", "low"]:
            content = json.dumps(
                {
                    "category": "food",
                    "detected_text": [],
                    "confidence": level,
                    "reasoning": "test",
                }
            )
            result = PhotoClassifier._parse_response(content)
            assert result is not None
            assert (
                result.confidence == level
            ), f"Confidence '{level}' should be accepted"

    def test_invalid_json_logs_warning(self, caplog) -> None:
        """Invalid JSON should log a warning."""
        with caplog.at_level(logging.WARNING):
            PhotoClassifier._parse_response("not json at all")
        assert "not valid JSON" in caplog.text

    def test_valid_json_does_not_log_warning(self, caplog) -> None:
        """Valid JSON should not produce any warnings."""
        with caplog.at_level(logging.WARNING):
            PhotoClassifier._parse_response('{"category": "food"}')
        assert caplog.text == ""


# ============================================================================
# PhotoClassifier.aggregate_results Tests
# ============================================================================


class TestAggregateResults:
    """Tests for PhotoClassifier.aggregate_results static method."""

    def test_returns_none_for_empty_or_none_results(self) -> None:
        assert PhotoClassifier.aggregate_results([]) is None
        assert PhotoClassifier.aggregate_results([None, None]) is None

    def test_picks_weighted_majority_category(self) -> None:
        results = [
            VisionResult(category="food", detected_text=["A"], confidence="high"),
            VisionResult(category="food", detected_text=["B"], confidence="medium"),
            VisionResult(category="landmark", detected_text=["C"], confidence="high"),
        ]

        merged = PhotoClassifier.aggregate_results(results)

        assert merged is not None
        assert merged.category == "food"
        assert merged.confidence in {"high", "medium"}

    def test_deduplicates_detected_text_case_insensitively(self) -> None:
        results = [
            VisionResult(
                category="food",
                detected_text=["Sushi Dai", "Menu"],
                confidence="high",
            ),
            VisionResult(
                category="food",
                detected_text=["sushi dai", "Open"],
                confidence="medium",
            ),
        ]

        merged = PhotoClassifier.aggregate_results(results)

        assert merged is not None
        assert merged.detected_text == ["Sushi Dai", "Menu", "Open"]
