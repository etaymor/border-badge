"""Tests for place extraction scoring module."""

from app.schemas.social_ingest import DetectedPlace
from app.services.place_extractor.location_hints import LocationHint
from app.services.place_extractor.scoring import (
    _calculate_word_overlap,
    _words_similar,
    calculate_confidence,
    score_place_result,
)


class TestWordsSimilar:
    """Tests for the _words_similar helper function."""

    def test_exact_match(self):
        """Exact matches should always return True."""
        assert _words_similar("express", "express") is True
        assert _words_similar("tower", "tower") is True

    def test_transliteration_match(self):
        """Similar words with transliteration differences should match."""
        # Express vs Ekspres (common transliteration) - 71.4% similarity
        assert _words_similar("express", "ekspres") is True
        # Restaurant variations - 77.8% similarity
        assert _words_similar("restaurant", "restoran") is True
        # Cafe vs Kafe - 75% similarity
        assert _words_similar("cafe", "kafe") is True

    def test_low_similarity_no_match(self):
        """Words with lower similarity should not match at default threshold."""
        # Tower vs Tauer is only 60% similar - below threshold
        assert _words_similar("tower", "tauer") is False

    def test_different_words_no_match(self):
        """Clearly different words should not match."""
        assert _words_similar("tokyo", "kyoto") is False
        assert _words_similar("restaurant", "hotel") is False
        assert _words_similar("express", "station") is False

    def test_short_words_require_exact_match(self):
        """Words shorter than 4 chars should require exact match."""
        # Short words that are similar but not exact
        assert _words_similar("bar", "car") is False
        assert _words_similar("the", "tea") is False
        assert _words_similar("inn", "in") is False
        # Short exact matches should still work
        assert _words_similar("bar", "bar") is True
        assert _words_similar("the", "the") is True

    def test_case_sensitivity(self):
        """Words should be compared as provided (normalized upstream)."""
        # The scoring module normalizes before calling this
        assert _words_similar("express", "express") is True


class TestCalculateWordOverlap:
    """Tests for the _calculate_word_overlap function."""

    def test_exact_overlap(self):
        """All words match exactly."""
        query = {"tokyo", "tower"}
        name = {"tokyo", "tower"}
        assert _calculate_word_overlap(query, name) == 2

    def test_fuzzy_overlap(self):
        """Words match with fuzzy matching."""
        query = {"dajti", "express"}
        name = {"dajti", "ekspres"}
        assert _calculate_word_overlap(query, name) == 2

    def test_partial_overlap(self):
        """Some words match, some don't."""
        query = {"tokyo", "tower"}
        name = {"tokyo", "station"}
        assert _calculate_word_overlap(query, name) == 1

    def test_no_overlap(self):
        """No words match."""
        query = {"tokyo", "tower"}
        name = {"paris", "cafe"}
        assert _calculate_word_overlap(query, name) == 0

    def test_empty_sets(self):
        """Empty sets should return 0."""
        assert _calculate_word_overlap(set(), {"tokyo"}) == 0
        assert _calculate_word_overlap({"tokyo"}, set()) == 0
        assert _calculate_word_overlap(set(), set()) == 0


class TestCalculateConfidence:
    """Tests for the main calculate_confidence function."""

    def test_exact_match_high_confidence(self):
        """Exact name matches should have high confidence."""
        confidence = calculate_confidence(
            query="Tokyo Tower",
            place_name="Tokyo Tower",
            is_first_result=False,
        )
        assert confidence >= 0.9

    def test_substring_match_good_confidence(self):
        """Substring matches should have good confidence."""
        confidence = calculate_confidence(
            query="Tokyo Tower",
            place_name="Tokyo Tower Observation Deck",
            is_first_result=False,
        )
        assert confidence >= 0.7

    def test_transliteration_now_matches(self):
        """Transliterated names should now match with fuzzy matching."""
        confidence = calculate_confidence(
            query="Dajti Express",
            place_name="Dajti Ekspres",
            is_first_result=True,
        )
        # With fuzzy matching: "Dajti" exact match, "Express" fuzzy matches "Ekspres"
        # 2/2 words match -> confidence = 0.2 + 0.55 * 1.0 + 0.1 (first result) = 0.85
        assert confidence >= 0.8

    def test_first_result_boost(self):
        """First result should get a confidence boost."""
        confidence_first = calculate_confidence(
            query="Tokyo Tower",
            place_name="Tokyo Tower Cafe",
            is_first_result=True,
        )
        confidence_not_first = calculate_confidence(
            query="Tokyo Tower",
            place_name="Tokyo Tower Cafe",
            is_first_result=False,
        )
        assert confidence_first > confidence_not_first

    def test_no_match_low_confidence(self):
        """Completely different names should have low confidence."""
        confidence = calculate_confidence(
            query="Tokyo Tower",
            place_name="Paris Cafe",
            is_first_result=False,
        )
        assert confidence <= 0.2

    def test_diacritics_normalized(self):
        """Names with diacritics should match normalized versions."""
        confidence = calculate_confidence(
            query="Kol Suu",
            place_name="Köl-Suu",
            is_first_result=False,
        )
        # Diacritics are normalized: "Köl" -> "kol", "Suu" exact match
        # Both words match -> confidence = 0.2 + 0.55 * 1.0 = 0.75
        assert confidence >= 0.7

    def test_partial_word_overlap(self):
        """Partial word overlap should give medium confidence."""
        confidence = calculate_confidence(
            query="Tokyo Ramen Shop",
            place_name="Tokyo Station",
            is_first_result=False,
        )
        # Only "Tokyo" matches
        assert 0.2 < confidence < 0.7


class TestRealWorldCases:
    """Test cases based on real-world extraction scenarios."""

    def test_albanian_transliteration(self):
        """Albanian transliteration case from the spec."""
        confidence = calculate_confidence(
            query="Dajti Express",
            place_name="Dajti Ekspres Lower station)",
            is_first_result=True,
        )
        # "Dajti" exact match, "Express" fuzzy matches "Ekspres"
        # 2/2 query words match, but place has 4 words -> ratio = 2/4 = 0.5
        # confidence = 0.2 + 0.55 * 0.5 + 0.1 = 0.575
        assert confidence >= 0.5

    def test_cafe_variations(self):
        """Various cafe spelling variations."""
        confidence = calculate_confidence(
            query="Sunset Cafe",
            place_name="Sunset Kafe",
            is_first_result=True,
        )
        # "Sunset" exact, "Cafe" fuzzy matches "Kafe" (75%)
        # 2/2 match -> 0.2 + 0.55 + 0.1 = 0.85
        assert confidence >= 0.8

    def test_restaurant_transliteration(self):
        """Restaurant spelling variations."""
        confidence = calculate_confidence(
            query="Beach Restaurant",
            place_name="Beach Restoran",
            is_first_result=True,
        )
        # "Beach" is in STOPWORDS so filtered out
        # "Restaurant" fuzzy matches "Restoran" (77.8%)
        # 1/1 match -> 0.2 + 0.55 + 0.1 = 0.85
        assert confidence >= 0.8


def _make_place(**kwargs) -> DetectedPlace:
    """Helper to create a DetectedPlace with defaults."""
    defaults = {
        "google_place_id": "test_id",
        "name": "Test Place",
        "confidence": 0.8,
    }
    defaults.update(kwargs)
    return DetectedPlace(**defaults)


class TestScorePlaceResult:
    """Tests for score_place_result ranking function."""

    def test_base_confidence_used(self):
        """Score starts from the place's confidence value."""
        place = _make_place(confidence=0.75)
        score = score_place_result(place, location_bias=None, candidate_idx=0)
        assert score == 0.75

    def test_country_match_bonus(self):
        """Matching country adds +0.25 bonus."""
        place = _make_place(confidence=0.5, country_code="JP")
        bias = LocationHint(
            name="Tokyo", country_code="JP", latitude=35.6, longitude=139.7
        )
        score = score_place_result(place, location_bias=bias, candidate_idx=0)
        assert score == 0.5 + 0.25

    def test_country_mismatch_penalty(self):
        """Mismatching country applies -0.15 penalty (reduced from -0.5)."""
        place = _make_place(confidence=0.8, country_code="SD")
        bias = LocationHint(
            name="Oman", country_code="OM", latitude=23.6, longitude=58.5
        )
        score = score_place_result(place, location_bias=bias, candidate_idx=0)
        assert score == 0.8 - 0.15

    def test_country_mismatch_doesnt_kill_strong_match(self):
        """A high-confidence match should survive country mismatch."""
        place = _make_place(confidence=0.95, country_code="SD")
        bias = LocationHint(
            name="Oman", country_code="OM", latitude=23.6, longitude=58.5
        )
        score = score_place_result(place, location_bias=bias, candidate_idx=0)
        assert score > 0.5  # With old -0.5 penalty this would be 0.45

    def test_low_value_type_penalty(self):
        """Tour agencies and similar types get penalized."""
        place = _make_place(confidence=0.7, primary_type="travel_agency")
        score = score_place_result(place, location_bias=None, candidate_idx=0)
        assert score == 0.7 - 0.25

    def test_high_value_type_bonus(self):
        """Restaurants, landmarks etc. get a bonus."""
        place = _make_place(confidence=0.7, primary_type="restaurant")
        score = score_place_result(place, location_bias=None, candidate_idx=0)
        assert score == 0.7 + 0.1

    def test_candidate_position_penalty(self):
        """Later candidates get slightly penalized."""
        place = _make_place(confidence=0.7)
        score_0 = score_place_result(place, location_bias=None, candidate_idx=0)
        score_2 = score_place_result(place, location_bias=None, candidate_idx=2)
        assert score_0 > score_2
        assert abs((score_0 - score_2) - 2 * 0.02) < 1e-9

    def test_no_country_codes_no_bonus_or_penalty(self):
        """When country codes are missing, no country adjustment is applied."""
        place = _make_place(confidence=0.7, country_code=None)
        bias = LocationHint(
            name="Tokyo", country_code="JP", latitude=35.6, longitude=139.7
        )
        score = score_place_result(place, location_bias=bias, candidate_idx=0)
        assert score == 0.7
