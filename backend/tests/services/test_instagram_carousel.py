"""Tests for Instagram carousel extraction."""

from app.services.extraction_orchestrator import _is_specific_place_name
from app.services.instagram_carousel import (
    InstagramCarouselData,
    InstagramPostLocation,
)
from app.services.url_resolver import extract_instagram_shortcode, is_instagram_carousel


class TestIsInstagramCarousel:
    """Tests for is_instagram_carousel function."""

    def test_detects_post_url(self):
        url = "https://www.instagram.com/p/DREYUPDCBhP"
        assert is_instagram_carousel(url) is True

    def test_detects_post_url_with_trailing_slash(self):
        url = "https://www.instagram.com/p/ABC123xyz/"
        assert is_instagram_carousel(url) is True

    def test_detects_reel_url(self):
        url = "https://www.instagram.com/reel/DEF456abc/"
        assert is_instagram_carousel(url) is True

    def test_detects_reels_url(self):
        url = "https://www.instagram.com/reels/GHI789xyz/"
        assert is_instagram_carousel(url) is True

    def test_detects_tv_url(self):
        url = "https://www.instagram.com/tv/JKL012mno/"
        assert is_instagram_carousel(url) is True

    def test_returns_false_for_profile_url(self):
        url = "https://www.instagram.com/username/"
        assert is_instagram_carousel(url) is False

    def test_returns_false_for_non_instagram_url(self):
        url = "https://www.tiktok.com/@user/video/123"
        assert is_instagram_carousel(url) is False

    def test_returns_false_for_explore_url(self):
        url = "https://www.instagram.com/explore/"
        assert is_instagram_carousel(url) is False

    def test_handles_url_without_www(self):
        url = "https://instagram.com/p/ABC123/"
        assert is_instagram_carousel(url) is True


class TestExtractInstagramShortcode:
    """Tests for extract_instagram_shortcode function."""

    def test_extracts_from_post_url(self):
        url = "https://www.instagram.com/p/DREYUPDCBhP/"
        assert extract_instagram_shortcode(url) == "DREYUPDCBhP"

    def test_extracts_from_reel_url(self):
        url = "https://www.instagram.com/reel/ABC123xyz/"
        assert extract_instagram_shortcode(url) == "ABC123xyz"

    def test_extracts_from_reels_url(self):
        url = "https://www.instagram.com/reels/DEF456/"
        assert extract_instagram_shortcode(url) == "DEF456"

    def test_extracts_from_tv_url(self):
        url = "https://www.instagram.com/tv/GHI789/"
        assert extract_instagram_shortcode(url) == "GHI789"

    def test_returns_none_for_profile_url(self):
        url = "https://www.instagram.com/username/"
        assert extract_instagram_shortcode(url) is None


class TestIsSpecificPlaceName:
    """Tests for _is_specific_place_name helper function."""

    def test_single_word_city_is_not_specific(self):
        # Single capitalized word likely a city
        assert _is_specific_place_name("Paris") is False
        assert _is_specific_place_name("Tokyo") is False
        assert _is_specific_place_name("London") is False

    def test_city_state_is_not_specific(self):
        assert _is_specific_place_name("Austin, TX") is False
        assert _is_specific_place_name("Denver, CO") is False

    def test_city_country_is_not_specific(self):
        assert _is_specific_place_name("Paris, France") is False
        assert _is_specific_place_name("Tokyo, Japan") is False

    def test_restaurant_keyword_is_specific(self):
        assert _is_specific_place_name("The French Restaurant") is True
        assert _is_specific_place_name("Cafe Central") is True
        assert _is_specific_place_name("Hotel Ritz") is True

    def test_landmark_keyword_is_specific(self):
        assert _is_specific_place_name("Eiffel Tower") is True
        assert _is_specific_place_name("Tower Bridge") is True
        assert _is_specific_place_name("Golden Gate Bridge") is True

    def test_museum_keyword_is_specific(self):
        assert _is_specific_place_name("Louvre Museum") is True
        assert _is_specific_place_name("British Museum") is True

    def test_multiple_words_is_specific(self):
        # 3+ words usually indicate a specific place
        assert _is_specific_place_name("The Ritz Paris") is True
        assert _is_specific_place_name("Central Park Zoo") is True
        assert _is_specific_place_name("La Sagrada Familia") is True

    def test_two_words_without_keyword_not_specific(self):
        # Two words without POI keyword could still be generic
        assert _is_specific_place_name("New York") is False


class TestInstagramPostLocation:
    """Tests for InstagramPostLocation dataclass."""

    def test_location_with_coordinates(self):
        location = InstagramPostLocation(
            id=12345,
            name="Eiffel Tower",
            slug="eiffel-tower",
            lat=48.8584,
            lng=2.2945,
        )
        assert location.name == "Eiffel Tower"
        assert location.lat == 48.8584
        assert location.lng == 2.2945

    def test_location_without_coordinates(self):
        location = InstagramPostLocation(
            id=12345,
            name="Paris",
            slug="paris",
            lat=None,
            lng=None,
        )
        assert location.name == "Paris"
        assert location.lat is None
        assert location.lng is None


class TestInstagramCarouselData:
    """Tests for InstagramCarouselData dataclass."""

    def test_carousel_with_images_and_location(self):
        location = InstagramPostLocation(
            id=12345,
            name="The Ritz Paris",
            slug="the-ritz-paris",
            lat=48.8684,
            lng=2.3263,
        )
        carousel = InstagramCarouselData(
            caption="Amazing stay at The Ritz!",
            images=[b"image1", b"image2"],
            image_urls=["https://example.com/1.jpg", "https://example.com/2.jpg"],
            post_type="GraphSidecar",
            location=location,
        )
        assert carousel.caption == "Amazing stay at The Ritz!"
        assert len(carousel.images) == 2
        assert carousel.post_type == "GraphSidecar"
        assert carousel.location is not None
        assert carousel.location.name == "The Ritz Paris"

    def test_carousel_without_location(self):
        carousel = InstagramCarouselData(
            caption="No geotag here",
            images=[b"image1"],
            image_urls=["https://example.com/1.jpg"],
            post_type="GraphImage",
            location=None,
        )
        assert carousel.location is None
        assert carousel.post_type == "GraphImage"
