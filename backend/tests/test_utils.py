"""Tests for backend utility helpers."""

from app.api.utils import get_flag_emoji
from app.core.urls import safe_external_url


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
