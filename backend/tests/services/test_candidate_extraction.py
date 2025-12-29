"""Tests for place candidate extraction module."""

from app.services.place_extractor.candidate_extraction import extract_place_candidates
from app.services.place_extractor.text_utils import clean_instagram_title


class TestCleanInstagramTitle:
    """Tests for Instagram title cleaning."""

    def test_removes_at_username_prefix(self):
        """Removes @username on Instagram: prefix."""
        title = '@username on Instagram: "Check out this place"'
        cleaned = clean_instagram_title(title)
        assert "@username" not in cleaned
        assert "Instagram" not in cleaned

    def test_removes_username_dot_prefix(self):
        """Removes username.al on Instagram: prefix (no @)."""
        title = 'AlbView.al on Instagram: "Skanderbeg Building"'
        cleaned = clean_instagram_title(title)
        assert "AlbView.al" not in cleaned
        assert "on Instagram" not in cleaned.lower()
        assert "Skanderbeg Building" in cleaned

    def test_removes_on_instagram_suffix(self):
        """Removes trailing ' on Instagram'."""
        title = "Beautiful sunset on Instagram"
        cleaned = clean_instagram_title(title)
        assert "on instagram" not in cleaned.lower()


class TestExtractPlaceCandidates:
    """Tests for candidate extraction from titles and captions."""

    def test_extracts_parenthetical_place_name(self):
        """Extracts place name from parentheses."""
        title = "Skanderbeg Building (Tirana's Rock)"
        candidates = extract_place_candidates(title, None, None)
        assert "Tirana's Rock" in candidates

    def test_extracts_quoted_place_name(self):
        """Extracts place name from straight quotes."""
        title = 'Visit "Tokyo Tower" today'
        candidates = extract_place_candidates(title, None, None)
        assert "Tokyo Tower" in candidates

    def test_extracts_smart_double_quoted_place_name(self):
        """Extracts place name from smart double quotes (" ")."""
        title = 'Visit "Lake Como" today'
        candidates = extract_place_candidates(title, None, None)
        assert "Lake Como" in candidates

    def test_extracts_smart_single_quoted_place_name(self):
        """Extracts place name from smart single quotes (' ')."""
        title = "Check out 'Mount Fuji' soon"
        candidates = extract_place_candidates(title, None, None)
        assert "Mount Fuji" in candidates

    def test_extracts_proper_nouns(self):
        """Extracts capitalized multi-word phrases."""
        title = "We visited Skanderbeg Building yesterday"
        candidates = extract_place_candidates(title, None, None)
        assert "Skanderbeg Building" in candidates

    def test_extracts_with_apostrophe(self):
        """Extracts place names containing apostrophes."""
        title = "Tirana's Rock is amazing"
        candidates = extract_place_candidates(title, None, None)
        # Should match with proper noun regex or be in fallback
        assert any("Tirana" in c and "Rock" in c for c in candidates)

    def test_instagram_title_with_parenthetical(self):
        """Full integration test: Instagram title with parenthetical place name."""
        title = "AlbView.al on Instagram: \"Skanderbeg Building (Tirana's Rock) 🌆"
        candidates = extract_place_candidates(title, None, None)
        # Should extract both the main name and the parenthetical alias
        assert "Tirana's Rock" in candidates
        assert "Skanderbeg Building" in candidates

    def test_location_pattern_at(self):
        """Extracts place after 'at' keyword."""
        title = "Dinner at Tokyo Tower"
        candidates = extract_place_candidates(title, None, None)
        assert "Tokyo Tower" in candidates

    def test_location_pattern_in(self):
        """Extracts place after 'in' keyword."""
        title = "Staying in Grand Hotel"
        candidates = extract_place_candidates(title, None, None)
        assert "Grand Hotel" in candidates

    def test_deduplicates_exact_candidates(self):
        """Removes duplicate candidates with same normalized form."""
        title = "Tokyo Tower is great. Visit Tokyo Tower!"
        candidates = extract_place_candidates(title, None, None)
        # The proper noun "Tokyo Tower" should only appear once
        exact_matches = [c for c in candidates if c == "Tokyo Tower"]
        assert len(exact_matches) == 1

    def test_limits_candidates(self):
        """Limits candidates to top 10."""
        # Create a title with many potential candidates
        title = " ".join([f"Place{i} Name{i}" for i in range(20)])
        candidates = extract_place_candidates(title, None, None)
        assert len(candidates) <= 10

    def test_hashtag_extraction_from_caption(self):
        """Extracts hashtag locations from caption."""
        candidates = extract_place_candidates(None, "#TokyoTower is amazing", None)
        assert "TokyoTower" in candidates

    def test_empty_inputs(self):
        """Handles empty/None inputs gracefully."""
        candidates = extract_place_candidates(None, None, None)
        assert candidates == []

        candidates = extract_place_candidates("", "", "")
        assert candidates == []
