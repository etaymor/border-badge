"""Tests for SEO metadata helpers."""

from app.core.seo import build_landing_seo, build_list_seo, build_trip_seo


def test_build_landing_seo() -> None:
    """Test landing page SEO context generation."""
    seo = build_landing_seo("https://example.com")
    assert seo.title == "Border Badge - Track Your Travels"
    assert seo.canonical_url == "https://example.com"
    assert seo.og_type == "website"
    assert "Border Badge" in seo.og_title


def test_build_list_seo() -> None:
    """Test list page SEO context generation."""
    seo = build_list_seo(
        list_name="Best Tacos",
        list_slug="best-tacos-abc123",
        description="My favorite spots",
        country_name="Mexico",
        base_url="https://example.com",
    )
    assert "Best Tacos" in seo.title
    assert seo.canonical_url == "https://example.com/l/best-tacos-abc123"
    assert seo.og_type == "article"
    assert seo.og_title == "Best Tacos"


def test_build_trip_seo() -> None:
    """Test trip page SEO context generation."""
    seo = build_trip_seo(
        trip_name="Summer Vacation",
        share_slug="summer-abc123",
        country_name="Italy",
        base_url="https://example.com",
        cover_image_url="https://storage.example.com/cover.jpg",
    )
    assert "Summer Vacation" in seo.title
    assert "Italy" in seo.title
    assert seo.canonical_url == "https://example.com/t/summer-abc123"
    assert seo.og_image == "https://storage.example.com/cover.jpg"
