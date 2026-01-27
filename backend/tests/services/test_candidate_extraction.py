"""Tests for place candidate extraction module."""

from app.services.place_extractor.candidate_extraction import (
    PlaceCandidate,
    extract_emoji_locations,
    extract_place_candidates,
)
from app.services.place_extractor.text_utils import clean_instagram_title


def _texts(candidates: list[PlaceCandidate]) -> list[str]:
    """Extract text strings from PlaceCandidate list for easy assertion."""
    return [c.text for c in candidates]


class TestExtractEmojiLocations:
    """Tests for emoji-based location extraction."""

    def test_extracts_pin_emoji_location(self):
        """Extracts location after \U0001f4cd pin emoji."""
        text = "\U0001f4cd Cafe Central, Vienna"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Cafe Central, Vienna" in locations[0] or "Cafe Central" in locations[0]

    def test_extracts_pin_emoji_no_space(self):
        """Extracts location after \U0001f4cd without space."""
        text = "\U0001f4cdBangkok, Thailand"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Bangkok" in locations[0]

    def test_extracts_multiple_pin_locations(self):
        """Extracts multiple locations from multiple pins."""
        text = "\U0001f4cd Eiffel Tower\n\U0001f4cd Louvre Museum"
        locations = extract_emoji_locations(text)
        assert len(locations) == 2
        assert any("Eiffel Tower" in loc for loc in locations)
        assert any("Louvre Museum" in loc for loc in locations)

    def test_extracts_pushpin_emoji_location(self):
        """Extracts location after \U0001f4cc pushpin emoji."""
        text = "\U0001f4cc Grand Bazaar Istanbul"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Grand Bazaar Istanbul" in locations[0]

    def test_extracts_globe_emoji_location(self):
        """Extracts location after \U0001f30d globe emoji."""
        text = "\U0001f30d Serengeti National Park"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Serengeti National Park" in locations[0]

    def test_stops_at_hashtag(self):
        """Stops extraction at hashtag."""
        text = "\U0001f4cd Tokyo Tower #japan #travel"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "japan" not in locations[0].lower()
        assert "Tokyo Tower" in locations[0]

    def test_stops_at_emoji(self):
        """Stops extraction at next emoji."""
        text = "\U0001f4cd Colosseum \U0001f1ee\U0001f1f9 Best place ever"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Best place" not in locations[0]

    def test_skips_noise_words(self):
        """Skips common noise words after emoji."""
        text = "\U0001f4cd here"
        locations = extract_emoji_locations(text)
        assert len(locations) == 0

    def test_skips_short_text(self):
        """Skips text shorter than 3 characters."""
        text = "\U0001f4cd NY"
        locations = extract_emoji_locations(text)
        assert len(locations) == 0

    def test_removes_trailing_punctuation(self):
        """Removes trailing punctuation from location."""
        text = "\U0001f4cd Central Park!!!"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert locations[0] == "Central Park"

    def test_preserves_apostrophes(self):
        """Preserves apostrophes in place names."""
        text = "\U0001f4cd Tirana\u2019s Rock"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Tirana" in locations[0] and "Rock" in locations[0]

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
        """Extracts location after world map emoji with variation selector FE0F."""
        text = "\U0001f5fa\ufe0f Grand Canyon National Park"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Grand Canyon National Park" in locations[0]

    def test_extracts_emoji_without_variation_selector(self):
        """Extracts location after emoji without variation selector."""
        text = "\U0001f5fa Yellowstone Park"
        locations = extract_emoji_locations(text)
        assert len(locations) == 1
        assert "Yellowstone Park" in locations[0]

    def test_variation_selector_not_in_location_text(self):
        """Ensures variation selector FE0F doesn't leak into captured location."""
        text = "\U0001f5fa\ufe0f Paris\n\U0001f4cd London"
        locations = extract_emoji_locations(text)
        assert len(locations) == 2
        for loc in locations:
            assert "\ufe0f" not in loc


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

    async def test_extracts_parenthetical_place_name(self):
        """Extracts place name from parentheses."""
        title = "Skanderbeg Building (Tirana\u2019s Rock)"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert any("Tirana" in c and "Rock" in c for c in candidates)

    async def test_extracts_quoted_place_name(self):
        """Extracts place name from straight quotes."""
        title = 'Visit "Tokyo Tower" today'
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert "Tokyo Tower" in candidates

    async def test_extracts_smart_double_quoted_place_name(self):
        """Extracts place name from smart double quotes."""
        title = "Visit \u201cLake Como\u201d today"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert "Lake Como" in candidates

    async def test_extracts_smart_single_quoted_place_name(self):
        """Extracts place name from smart single quotes."""
        title = "Check out \u2018Mount Fuji\u2019 soon"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert "Mount Fuji" in candidates

    async def test_extracts_proper_nouns(self):
        """Extracts capitalized multi-word phrases."""
        title = "We visited Skanderbeg Building yesterday"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert "Skanderbeg Building" in candidates

    async def test_extracts_with_apostrophe(self):
        """Extracts place names containing apostrophes."""
        title = "Tirana\u2019s Rock is amazing"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert any("Tirana" in c and "Rock" in c for c in candidates)

    async def test_instagram_title_with_parenthetical(self):
        """Full integration test: Instagram title with parenthetical place name."""
        title = (
            'AlbView.al on Instagram: "Skanderbeg Building (Tirana\'s Rock) \U0001f306"'
        )
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert any("Tirana" in c and "Rock" in c for c in candidates)
        assert any("Skanderbeg Building" in c for c in candidates)

    async def test_location_pattern_at(self):
        """Extracts place after 'at' keyword."""
        title = "Dinner at Tokyo Tower"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert "Tokyo Tower" in candidates

    async def test_location_pattern_in(self):
        """Extracts place after 'in' keyword."""
        title = "Staying in Grand Hotel"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert "Grand Hotel" in candidates

    async def test_deduplicates_exact_candidates(self):
        """Removes duplicate candidates with same normalized form."""
        title = "Tokyo Tower is great. Visit Tokyo Tower!"
        candidates = _texts(await extract_place_candidates(title, None, None))
        exact_matches = [c for c in candidates if c == "Tokyo Tower"]
        assert len(exact_matches) == 1

    async def test_limits_candidates(self):
        """Limits candidates to top 10."""
        title = " ".join([f"Place{i} Name{i}" for i in range(20)])
        candidates = await extract_place_candidates(title, None, None)
        assert len(candidates) <= 10

    async def test_hashtag_extraction_from_caption(self):
        """Extracts hashtag locations from caption."""
        candidates = _texts(
            await extract_place_candidates(None, "#TokyoTower is amazing", None)
        )
        assert "TokyoTower" in candidates

    async def test_empty_inputs(self):
        """Handles empty/None inputs gracefully."""
        candidates = await extract_place_candidates(None, None, None)
        assert candidates == []

        candidates = await extract_place_candidates("", "", "")
        assert candidates == []

    async def test_emoji_location_prioritized_in_caption(self):
        """Emoji-marked locations from caption appear first."""
        caption = "\U0001f4cd Cafe Central is amazing! #Vienna"
        title = "Best cafes in Vienna"
        candidates = _texts(await extract_place_candidates(title, caption, None))
        assert len(candidates) > 0
        assert "Cafe Central" in candidates[0]

    async def test_emoji_location_prioritized_in_title(self):
        """Emoji-marked locations from title are extracted."""
        title = "\U0001f4cd Tokyo Tower - must visit!"
        candidates = _texts(await extract_place_candidates(title, None, None))
        assert len(candidates) > 0
        assert "Tokyo Tower" in candidates[0]

    async def test_emoji_location_from_both_sources(self):
        """Extracts emoji locations from both caption and title."""
        caption = "\U0001f4cd Eiffel Tower"
        title = "\U0001f4cd Louvre Museum"
        candidates = _texts(await extract_place_candidates(title, caption, None))
        assert any("Eiffel Tower" in c for c in candidates)
        assert any("Louvre Museum" in c for c in candidates)

    async def test_real_instagram_caption_with_pin(self):
        """Handles real-world Instagram caption with pin emoji."""
        caption = (
            "Finally made it! \U0001f4cd Santorini, Greece "
            "\U0001f1ec\U0001f1f7\n\n"
            "Best sunset views ever! #travel #greece #santorini"
        )
        candidates = _texts(await extract_place_candidates(None, caption, None))
        assert len(candidates) > 0
        assert any("Santorini" in c for c in candidates)
