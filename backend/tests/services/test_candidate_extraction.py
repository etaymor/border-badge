"""Tests for place candidate extraction module."""

from app.services.place_extractor.candidate_extraction import (
    extract_emoji_locations,
    extract_number_emoji_locations,
    extract_place_candidates,
)
from app.services.place_extractor.text_utils import clean_instagram_title


class TestExtractEmojiLocations:
    """Tests for emoji-based location extraction."""

    def test_extracts_pin_emoji_location(self):
        """Extracts location after 📍 pin emoji."""
        text = "📍 Cafe Central, Vienna"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Cafe Central, Vienna" in locations[0] or "Cafe Central" in locations[0]

    def test_extracts_pin_emoji_no_space(self):
        """Extracts location after 📍 without space."""
        text = "📍Bangkok, Thailand"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Bangkok" in locations[0]

    def test_extracts_multiple_pin_locations(self):
        """Extracts multiple locations from multiple pins."""
        text = "📍 Eiffel Tower\n📍 Louvre Museum"
        locations = extract_emoji_locations(text)
        assert len(locations) == 2
        assert any("Eiffel Tower" in loc for loc in locations)
        assert any("Louvre Museum" in loc for loc in locations)

    def test_extracts_pushpin_emoji_location(self):
        """Extracts location after 📌 pushpin emoji."""
        text = "📌 Grand Bazaar Istanbul"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Grand Bazaar Istanbul" in locations[0]

    def test_extracts_globe_emoji_location(self):
        """Extracts location after 🌍 globe emoji."""
        text = "🌍 Serengeti National Park"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Serengeti National Park" in locations[0]

    def test_stops_at_hashtag(self):
        """Stops extraction at hashtag."""
        text = "📍 Tokyo Tower #japan #travel"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "japan" not in locations[0].lower()
        assert "Tokyo Tower" in locations[0]

    def test_stops_at_emoji(self):
        """Stops extraction at next emoji."""
        text = "📍 Colosseum 🇮🇹 Best place ever"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Best place" not in locations[0]

    def test_skips_noise_words(self):
        """Skips common noise words after emoji."""
        text = "📍 here"
        locations = extract_emoji_locations(text)
        assert len(locations) == 0

    def test_skips_short_text(self):
        """Skips text shorter than 3 characters."""
        text = "📍 NY"
        locations = extract_emoji_locations(text)
        assert len(locations) == 0

    def test_removes_trailing_punctuation(self):
        """Removes trailing punctuation from location."""
        text = "📍 Central Park!!!"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert locations[0] == "Central Park"

    def test_preserves_apostrophes(self):
        """Preserves apostrophes in place names."""
        text = "📍 Tirana's Rock"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Tirana's Rock" in locations[0]

    def test_empty_input(self):
        """Handles empty input."""
        assert extract_emoji_locations("") == []
        assert extract_emoji_locations(None) == []

    def test_no_emoji(self):
        """Returns empty list when no location emojis present."""
        text = "Visit Central Park in New York"
        locations = extract_emoji_locations(text)
        assert len(locations) == 0

    def test_extracts_world_map_emoji_with_variation_selector(self):
        """Extracts location after 🗺️ world map emoji with variation selector FE0F."""
        # 🗺️ is U+1F5FA + U+FE0F (variation selector)
        text = "🗺️ Grand Canyon National Park"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Grand Canyon National Park" in locations[0]

    def test_extracts_emoji_without_variation_selector(self):
        """Extracts location after emoji without variation selector."""
        # Just U+1F5FA without FE0F
        text = "\U0001f5fa Yellowstone Park"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Yellowstone Park" in locations[0]

    def test_variation_selector_not_in_location_text(self):
        """Ensures variation selector FE0F doesn't leak into captured location."""
        # Multiple emojis with variation selectors
        text = "🗺️ Paris\n📍 London"
        locations = extract_emoji_locations(text)
        assert len(locations) == 2
        # Verify no FE0F in captured text
        for loc in locations:
            assert "\ufe0f" not in loc


class TestExtractNumberEmojiLocations:
    """Tests for number emoji-based location extraction."""

    def test_extracts_single_number_emoji_location(self):
        """Extracts location after 1️⃣ number emoji."""
        text = "1️⃣ Shibuya Sky"
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 1
        assert "Shibuya Sky" in locations[0]

    def test_extracts_multiple_number_emoji_locations(self):
        """Extracts multiple locations from numbered list."""
        text = "1️⃣ Shibuya Sky 2️⃣ Sensoji Temple 3️⃣ Tokyo Tower"
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 3
        assert any("Shibuya Sky" in loc for loc in locations)
        assert any("Sensoji Temple" in loc for loc in locations)
        assert any("Tokyo Tower" in loc for loc in locations)

    def test_extracts_locations_with_newlines(self):
        """Extracts locations when separated by newlines."""
        text = """1️⃣ Shibuya Sky
2️⃣ Sensoji Temple
3️⃣ Tokyo Tower"""
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 3

    def test_extracts_keycap_ten_emoji(self):
        """Extracts location after 🔟 keycap ten emoji."""
        text = "🔟 Fushimi Inari Shrine"
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 1
        assert "Fushimi Inari Shrine" in locations[0]

    def test_skips_short_text(self):
        """Skips text shorter than 3 characters."""
        text = "1️⃣ NY"
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 0

    def test_skips_noise_words(self):
        """Skips common noise words after emoji."""
        text = "1️⃣ here 2️⃣ place"
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 0

    def test_removes_trailing_punctuation(self):
        """Removes trailing punctuation from location."""
        text = "1️⃣ Shibuya Sky!!!"
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 1
        assert locations[0] == "Shibuya Sky"

    def test_empty_input(self):
        """Handles empty input."""
        assert extract_number_emoji_locations("") == []

    def test_no_number_emoji(self):
        """Returns empty list when no number emojis present."""
        text = "Visit Shibuya Sky in Tokyo"
        locations = extract_number_emoji_locations(text)
        assert len(locations) == 0

    def test_real_tiktok_caption_with_numbers(self):
        """Handles real-world TikTok caption with number emojis."""
        caption = """Tokyo travel guide 🇯🇵

1️⃣ Shibuya Sky - best views
2️⃣ Shibuya Crossing
3️⃣ Harry Potter Studio Tour
4️⃣ Nakamise Street
5️⃣ Sensoji Temple
6️⃣ Tokyo Disney"""
        locations = extract_number_emoji_locations(caption)
        assert len(locations) >= 5
        assert any("Shibuya Sky" in loc for loc in locations)
        assert any("Sensoji Temple" in loc for loc in locations)


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
        title = 'AlbView.al on Instagram: "Skanderbeg Building (Tirana\'s Rock) 🌆"'
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

    def test_emoji_location_prioritized_in_caption(self):
        """Emoji-marked locations from caption appear first."""
        caption = "📍 Cafe Central is amazing! #Vienna"
        title = "Best cafes in Vienna"
        candidates = extract_place_candidates(title, caption, None)
        # Emoji location should be first
        assert len(candidates) > 0
        assert "Cafe Central" in candidates[0]

    def test_emoji_location_prioritized_in_title(self):
        """Emoji-marked locations from title are extracted."""
        title = "📍 Tokyo Tower - must visit!"
        candidates = extract_place_candidates(title, None, None)
        assert len(candidates) > 0
        assert "Tokyo Tower" in candidates[0]

    def test_emoji_location_from_both_sources(self):
        """Extracts emoji locations from both caption and title."""
        caption = "📍 Eiffel Tower"
        title = "📍 Louvre Museum"
        candidates = extract_place_candidates(title, caption, None)
        # Caption emoji locations come first, then title
        assert any("Eiffel Tower" in c for c in candidates)
        assert any("Louvre Museum" in c for c in candidates)

    def test_real_instagram_caption_with_pin(self):
        """Handles real-world Instagram caption with pin emoji."""
        caption = """Finally made it! 📍 Santorini, Greece 🇬🇷

        Best sunset views ever! #travel #greece #santorini"""
        candidates = extract_place_candidates(None, caption, None)
        assert len(candidates) > 0
        # Pin emoji location should be prioritized
        assert any("Santorini" in c for c in candidates)
