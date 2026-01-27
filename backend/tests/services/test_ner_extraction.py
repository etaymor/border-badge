"""Tests for NER-based place entity extraction."""

from app.services.place_extractor.ner_extraction import (
    _TYPE_PATTERNS,
    NEREntity,
    _infer_place_type,
)


class TestInferPlaceType:
    """Tests for place type inference from entity text and NER label."""

    def test_restaurant_keywords(self) -> None:
        assert _infer_place_type("Sunset Restaurant", "FAC") == "restaurant"
        assert _infer_place_type("La Trattoria", "ORG") == "restaurant"
        assert _infer_place_type("Joe's Bistro", "ORG") == "restaurant"

    def test_cafe_keywords(self) -> None:
        assert _infer_place_type("Central Café", "ORG") == "cafe"
        assert _infer_place_type("Blue Bottle Coffee", "ORG") == "cafe"

    def test_bar_keywords(self) -> None:
        assert _infer_place_type("The Cocktail Lounge", "FAC") == "bar"
        assert _infer_place_type("Irish Pub", "ORG") == "bar"

    def test_lodging_keywords(self) -> None:
        assert _infer_place_type("Grand Hotel", "ORG") == "lodging"
        assert _infer_place_type("Beach Resort", "FAC") == "lodging"

    def test_museum_keywords(self) -> None:
        assert _infer_place_type("Modern Art Museum", "FAC") == "museum"
        assert _infer_place_type("National Gallery", "ORG") == "museum"

    def test_tourist_attraction_keywords(self) -> None:
        assert _infer_place_type("Angkor Temple", "FAC") == "tourist_attraction"
        assert _infer_place_type("Edinburgh Castle", "FAC") == "tourist_attraction"

    def test_park_keywords(self) -> None:
        assert _infer_place_type("Central Park", "FAC") == "park"
        assert _infer_place_type("Botanical Garden", "FAC") == "park"

    def test_fac_label_defaults_to_tourist_attraction(self) -> None:
        """FAC entities without keyword match get tourist_attraction from FAC fallback."""
        assert _infer_place_type("Golden Gate Bridge", "FAC") == "tourist_attraction"

    def test_fac_fallback(self) -> None:
        """FAC entities without keyword match default to tourist_attraction."""
        assert _infer_place_type("The Colosseum", "FAC") == "tourist_attraction"

    def test_no_type_for_generic_loc(self) -> None:
        """LOC/GPE without keywords returns None."""
        assert _infer_place_type("Tokyo", "GPE") is None
        assert _infer_place_type("Mount Everest", "LOC") is None

    def test_bar_harbor_not_bar(self) -> None:
        """'Bar Harbor' should NOT match 'bar' — proper noun detection."""
        result = _infer_place_type("Bar Harbor", "GPE")
        assert result is None

    def test_bar_standalone_still_matches(self) -> None:
        """A standalone 'bar' at position 0 without a following proper noun matches."""
        assert _infer_place_type("bar on main street", "ORG") == "bar"

    def test_barista_not_bar(self) -> None:
        """'Barista' should NOT match 'bar' — no word boundary."""
        # "barista" does not contain "bar" at a word boundary
        # Actually it does: \bbar\b won't match "barista" since "barista" != "bar"
        # \b matches between "r" and "i" but the pattern is \bbar\b which requires
        # word boundary after "r" too — "barista" has "i" after "r", not boundary.
        assert (
            _infer_place_type("Barista Cafe", "ORG") == "cafe"
        )  # matches cafe, not bar

    def test_long_text_truncated(self) -> None:
        """Text longer than 100 chars is truncated."""
        long_text = "A" * 200
        assert _infer_place_type(long_text, "LOC") is None


class TestTypePatterns:
    """Tests for pre-compiled type patterns."""

    def test_all_types_have_patterns(self) -> None:
        """All type keywords should have compiled patterns."""
        expected_types = {
            "restaurant",
            "cafe",
            "bar",
            "lodging",
            "museum",
            "tourist_attraction",
            "park",
        }
        assert set(_TYPE_PATTERNS.keys()) == expected_types

    def test_word_boundary_matching(self) -> None:
        """Patterns use word boundaries to prevent false positives."""
        bar_pattern = _TYPE_PATTERNS["bar"]
        assert bar_pattern.search("Irish Bar")
        assert bar_pattern.search("a bar in town")
        assert not bar_pattern.search("Barista")
        assert not bar_pattern.search("embargo")


class TestNEREntity:
    """Tests for the NEREntity dataclass."""

    def test_creation(self) -> None:
        entity = NEREntity(
            text="Tokyo Tower", label="FAC", place_type="tourist_attraction"
        )
        assert entity.text == "Tokyo Tower"
        assert entity.label == "FAC"
        assert entity.place_type == "tourist_attraction"

    def test_frozen(self) -> None:
        entity = NEREntity(text="Test", label="LOC", place_type=None)
        try:
            entity.text = "Changed"  # type: ignore[misc]
            raise AssertionError("Should have raised AttributeError")
        except AttributeError:
            pass
