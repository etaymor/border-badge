"""Tests for backend utility helpers."""

from app.api.utils import get_flag_emoji
from app.core.urls import GOOGLE_PHOTO_DOMAINS, safe_external_url, safe_google_photo_url


def test_safe_external_url_allows_http() -> None:
    assert (
        safe_external_url("http://example.com/path?q=1")
        == "http://example.com/path?q=1"
    )


def test_safe_external_url_normalizes_scheme_case() -> None:
    assert (
        safe_external_url("HTTPS://Example.com/Section")
        == "https://Example.com/Section"
    )


def test_safe_external_url_rejects_invalid_scheme() -> None:
    assert safe_external_url("javascript:alert(1)") is None
    assert safe_external_url("ftp://example.com") is None


def test_safe_external_url_requires_scheme_and_host() -> None:
    assert safe_external_url("example.com/path") is None
    assert safe_external_url("https:///missing-host") is None


def test_safe_external_url_handles_blank_values() -> None:
    assert safe_external_url("") is None
    assert safe_external_url("   ") is None
    assert safe_external_url(None) is None


def test_get_flag_emoji_returns_standard_flag_for_nc() -> None:
    assert get_flag_emoji("NC") == "\U0001f1f3\U0001f1e8"


def test_get_flag_emoji_uses_custom_mapping_for_xn() -> None:
    assert get_flag_emoji("XN") == "\U0001f1e8\U0001f1fe"


# ============================================================================
# Tests for safe_google_photo_url
# ============================================================================


def test_safe_google_photo_url_valid_maps_domain() -> None:
    """Test valid Google Maps domain is accepted."""
    url = "https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=abc"
    result = safe_google_photo_url(url)
    assert result == url


def test_safe_google_photo_url_valid_googleusercontent() -> None:
    """Test valid Google User Content domain is accepted."""
    url = "https://lh3.googleusercontent.com/photo123"
    result = safe_google_photo_url(url)
    assert result == url


def test_safe_google_photo_url_valid_ggpht_domains() -> None:
    """Test all ggpht domains are accepted."""
    for domain in [
        "geo0.ggpht.com",
        "geo1.ggpht.com",
        "geo2.ggpht.com",
        "geo3.ggpht.com",
    ]:
        url = f"https://{domain}/photo123"
        result = safe_google_photo_url(url)
        assert result == url, f"Expected {domain} to be accepted"


def test_safe_google_photo_url_rejects_non_google_domain() -> None:
    """Test non-Google domains are rejected."""
    url = "https://evil.com/fake-google-photo"
    result = safe_google_photo_url(url)
    assert result is None


def test_safe_google_photo_url_rejects_similar_domain() -> None:
    """Test similar-looking non-Google domains are rejected."""
    fake_domains = [
        "https://maps.googleapis.com.evil.com/photo",  # Subdomain attack
        "https://fakemaps.googleapis.com/photo",  # Prefix attack
        "https://maps-googleapis.com/photo",  # Similar name
        "https://googleapis.com/photo",  # Parent domain
    ]
    for url in fake_domains:
        result = safe_google_photo_url(url)
        assert result is None, f"Expected {url} to be rejected"


def test_safe_google_photo_url_rejects_empty() -> None:
    """Test empty/None URLs are rejected."""
    assert safe_google_photo_url(None) is None
    assert safe_google_photo_url("") is None
    assert safe_google_photo_url("   ") is None


def test_safe_google_photo_url_rejects_javascript() -> None:
    """Test javascript: scheme is rejected."""
    url = "javascript:alert('xss')"
    result = safe_google_photo_url(url)
    assert result is None


def test_safe_google_photo_url_rejects_too_long() -> None:
    """Test URLs exceeding max length are rejected."""
    long_path = "x" * 2100
    url = f"https://maps.googleapis.com/{long_path}"
    result = safe_google_photo_url(url)
    assert result is None


def test_safe_google_photo_url_allows_http() -> None:
    """Test that HTTP is allowed (base validation allows it)."""
    url = "http://maps.googleapis.com/maps/api/place/photo"
    result = safe_google_photo_url(url)
    # HTTP is allowed by safe_external_url
    assert result == url


def test_google_photo_domains_constant_complete() -> None:
    """Test that expected domains are in the whitelist."""
    expected_domains = {
        "places.googleapis.com",  # New Places API (v1)
        "maps.googleapis.com",  # Legacy Places API
        "lh3.googleusercontent.com",
        "geo0.ggpht.com",
        "geo1.ggpht.com",
        "geo2.ggpht.com",
        "geo3.ggpht.com",
    }
    assert GOOGLE_PHOTO_DOMAINS == expected_domains
