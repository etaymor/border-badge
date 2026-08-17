"""Tests for SEO metadata helpers."""

from app.core.seo import (
    LANDING_FAQS,
    build_landing_seo,
    build_landing_structured_data,
    build_list_seo,
    build_trip_seo,
)


def test_build_landing_seo() -> None:
    """Test landing page SEO context generation."""
    seo = build_landing_seo("https://example.com")
    assert seo.title == "Atlasi - Track Countries, Import Travel Photos & Log Trips"
    assert seo.canonical_url == "https://example.com"
    assert seo.og_type == "website"
    assert "Atlasi" in seo.og_title


def test_build_landing_seo_has_og_image() -> None:
    """The landing page must ship an og:image for social cards."""
    seo = build_landing_seo("https://example.com")
    assert seo.og_image == "https://example.com/static/images/screens/og-image.png"


def test_landing_structured_data_covers_app_and_faqs() -> None:
    """The JSON-LD @graph carries the app entity and every FAQ."""
    data = build_landing_structured_data(
        "https://example.com", "https://apps.apple.com/app/id123"
    )
    assert data["@context"] == "https://schema.org"

    by_type = {node["@type"]: node for node in data["@graph"]}
    app = by_type["MobileApplication"]
    assert app["name"] == "Atlasi"
    assert app["operatingSystem"] == "iOS"
    assert app["offers"]["price"] == "0"
    assert app["installUrl"] == "https://apps.apple.com/app/id123"

    questions = by_type["FAQPage"]["mainEntity"]
    assert len(questions) == len(LANDING_FAQS)
    assert all(q["acceptedAnswer"]["text"] for q in questions)


def test_landing_structured_data_omits_install_url_when_unset() -> None:
    """No App Store URL configured means no empty installUrl in the schema."""
    data = build_landing_structured_data("https://example.com")
    app = next(n for n in data["@graph"] if n["@type"] == "MobileApplication")
    assert "installUrl" not in app


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


def test_build_trip_seo_empty_country() -> None:
    """Test trip SEO handles empty country_name gracefully."""
    seo = build_trip_seo(
        trip_name="My Trip",
        share_slug="my-trip-abc123",
        country_name="",
        base_url="https://example.com",
    )
    # Should not produce "My Trip in - Atlasi"
    assert seo.title == "My Trip - Atlasi"
    assert seo.og_title == "My Trip"
    assert " in " not in seo.title
    assert " in " not in seo.description
