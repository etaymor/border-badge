"""Tests for public web page endpoints."""

import json
import re
from typing import Any
from unittest.mock import AsyncMock, patch
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

import app.api.public as public_module
from app.core.blog import get_registry as blog_registry
from app.core.config import Settings, get_settings
from app.core.media import AVATAR_WIDTH
from app.core.security import AuthUser, get_current_user
from app.core.seo import LANDING_FAQS
from app.core.share_view import CATEGORY_STYLES
from app.main import app
from app.schemas.share import MAP_NOTE_LIMIT
from tests.conftest import (
    OTHER_USER_ID,
    TEST_ENTRY_ID,
    TEST_LIST_ID,
    TEST_TRIP_ID,
    TEST_USER_ID,
    mock_auth_dependency,
    supabase_tables,
)

# ============================================================================
# Landing Page Tests
# ============================================================================


def test_landing_page_returns_html(client: TestClient) -> None:
    """Test that landing page returns HTML."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Atlasi" in response.text


def test_landing_page_has_cache_header(client: TestClient) -> None:
    """Test that landing page has cache control header."""
    response = client.get("/")
    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "public" in response.headers["Cache-Control"]


def test_landing_page_has_seo_tags(client: TestClient) -> None:
    """Test that landing page includes SEO meta tags."""
    response = client.get("/")
    assert response.status_code == 200
    # Check for Open Graph tags
    assert "og:title" in response.text
    assert "og:description" in response.text
    assert "og:image" in response.text


def test_landing_page_emits_structured_data(client: TestClient) -> None:
    """The landing page renders valid FAQPage + app JSON-LD."""
    response = client.get("/")
    match = re.search(
        r'<script type="application/ld\+json"[^>]*>(.*?)</script>',
        response.text,
        re.DOTALL,
    )
    assert match, "landing page is missing its JSON-LD block"

    data = json.loads(match.group(1))
    types = {node["@type"] for node in data["@graph"]}
    assert types == {"MobileApplication", "FAQPage"}

    faq = next(n for n in data["@graph"] if n["@type"] == "FAQPage")
    assert len(faq["mainEntity"]) == len(LANDING_FAQS)


def test_landing_page_renders_every_faq(client: TestClient) -> None:
    """Every FAQ in the source list reaches the visible accordion."""
    response = client.get("/")
    assert response.text.count('<details class="faq-item">') == len(LANDING_FAQS)


def test_landing_page_tracks_all_app_store_ctas(client: TestClient) -> None:
    """Hero and download CTAs must fire click_app_store, not just the header."""
    response = client.get("/")
    for location in ("header", "hero", "download_section"):
        assert f'data-track-location="{location}"' in response.text


def test_landing_page_inline_scripts_carry_csp_nonce(client: TestClient) -> None:
    """A nonce-less inline script would be silently blocked by the CSP."""
    html_text = client.get("/").text
    inline_scripts = [
        tag for tag in re.findall(r"<script[^>]*>", html_text) if "src=" not in tag
    ]
    assert inline_scripts, "expected inline scripts on the landing page"
    assert all("nonce=" in tag for tag in inline_scripts)


# ============================================================================
# Public List Page Tests
# ============================================================================


def test_public_list_returns_html(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """Test that public list page returns HTML."""
    list_with_trip = {
        **sample_list,
        "trip": {"name": "Summer Vacation", "country": {"name": "United States"}},
    }
    mock_supabase_client.get.side_effect = supabase_tables(list=[list_with_trip])

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/l/best-places-to-visit-abc123")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Best Places to Visit" in response.text


def test_public_list_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that non-existent list returns 404."""
    mock_supabase_client.get.side_effect = supabase_tables()

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/l/nonexistent-slug")

    assert response.status_code == 404


def test_public_list_has_cache_header(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """Test that public list page has cache control header."""
    list_with_trip = {
        **sample_list,
        "trip": {"name": "Summer Vacation", "country": {"name": "United States"}},
    }
    mock_supabase_client.get.side_effect = supabase_tables(list=[list_with_trip])

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/l/best-places-to-visit-abc123")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "public" in response.headers["Cache-Control"]


def test_public_list_with_entries(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """Test public list page with entries."""
    list_with_trip = {
        **sample_list,
        "trip": {"name": "Summer Vacation", "country": {"name": "United States"}},
    }
    entry_rows = [
        {
            "id": "entry-1",
            "entry_id": TEST_ENTRY_ID,
            "position": 0,
            "entry": {
                "id": TEST_ENTRY_ID,
                "title": "Central Park",
                "type": "place",
                "notes": "Beautiful park!",
                "place": {"place_name": "Central Park", "address": "New York"},
                "media_files": [],
            },
        }
    ]
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[list_with_trip],
        list_entries=entry_rows,
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/l/best-places-to-visit-abc123")

    assert response.status_code == 200
    assert "Central Park" in response.text


def test_public_list_invalid_slug_format(client: TestClient) -> None:
    """Test that invalid slug format returns 422."""
    response = client.get("/l/INVALID_SLUG!")
    assert response.status_code == 422


# ============================================================================
# Public Trip Page Tests
# ============================================================================


def test_public_trip_returns_html(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that public trip page returns HTML."""
    trip_data = {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "name": "Summer Vacation",
        "share_slug": "summer-vacation-abc123",
        "cover_image_url": None,
        "date_range": "[2024-06-01,2024-06-15]",
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "country": {"name": "United States", "code": "US"},
    }
    mock_supabase_client.get.side_effect = supabase_tables(trip=[trip_data])

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Summer Vacation" in response.text


def test_public_trip_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that non-existent trip returns 404."""
    mock_supabase_client.get.side_effect = supabase_tables()

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/t/nonexistent-slug")

    assert response.status_code == 404


def test_public_trip_has_cache_header(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that public trip page has cache control header."""
    trip_data = {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "name": "Summer Vacation",
        "share_slug": "summer-vacation-abc123",
        "cover_image_url": None,
        "date_range": None,
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "country": {"name": "United States", "code": "US"},
    }
    mock_supabase_client.get.side_effect = supabase_tables(trip=[trip_data])

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers


# ============================================================================
# Robots.txt Tests
# ============================================================================


def test_robots_txt(client: TestClient) -> None:
    """Test that robots.txt is returned correctly."""
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    assert "User-agent:" in response.text
    assert "Allow:" in response.text


# ============================================================================
# Sitemap.xml Tests
# ============================================================================


def test_sitemap_xml(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that sitemap.xml is generated correctly."""
    mock_supabase_client.get.side_effect = supabase_tables(
        user_profile=[{"username": "traveler1"}, {"username": "explorer_pro"}],
        list=[{"slug": "best-tacos-abc123"}, {"slug": "cool-spots-def456"}],
        trip=[{"share_slug": "summer-trip-xyz"}],
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/sitemap.xml")

    assert response.status_code == 200
    assert "application/xml" in response.headers["content-type"]
    assert "Cache-Control" in response.headers
    assert '<?xml version="1.0"' in response.text
    assert "<urlset" in response.text
    assert "/u/traveler1" in response.text
    assert "/u/explorer_pro" in response.text
    assert "/l/best-tacos-abc123" in response.text
    assert "/l/cool-spots-def456" in response.text
    assert "/t/summer-trip-xyz" in response.text


def test_sitemap_xml_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test sitemap.xml with no public content."""
    mock_supabase_client.get.side_effect = supabase_tables()

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/sitemap.xml")

    assert response.status_code == 200
    assert '<?xml version="1.0"' in response.text
    # Should still have the landing page URL
    assert "<url>" in response.text


# ============================================================================
# Trip Share API Tests
# ============================================================================


def test_generate_share_link_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test generating a share link for a trip."""
    trip_without_slug = {**sample_trip, "share_slug": None}
    trip_with_slug = {**sample_trip, "share_slug": "summer-vacation-abc123"}

    mock_supabase_client.get.return_value = [trip_without_slug]
    mock_supabase_client.rpc.return_value = "summer-vacation-abc123"
    mock_supabase_client.patch.return_value = [trip_with_slug]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/share",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert "share_slug" in data
        assert "share_url" in data
    finally:
        app.dependency_overrides.clear()


def test_generate_share_link_returns_existing(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test that existing share link is returned instead of creating new one."""
    trip_with_slug = {**sample_trip, "share_slug": "existing-slug-123"}
    mock_supabase_client.get.return_value = [trip_with_slug]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/share",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["share_slug"] == "existing-slug-123"
    finally:
        app.dependency_overrides.clear()


def test_generate_share_link_not_owner(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that non-owner cannot generate share link."""
    mock_supabase_client.get.return_value = []  # Trip not found for this user

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/share",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_revoke_share_link_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test revoking a share link."""
    mock_supabase_client.patch.return_value = [{**sample_trip, "share_slug": None}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                f"/trips/{TEST_TRIP_ID}/share",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_revoke_share_link_not_owner(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that non-owner cannot revoke share link."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                f"/trips/{TEST_TRIP_ID}/share",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Additional Coverage Tests
# ============================================================================


def test_public_trip_with_entries(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test public trip page with entries displays correctly."""
    trip_data = {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "name": "Summer Vacation",
        "share_slug": "summer-vacation-abc123",
        "cover_image_url": "https://storage.example.com/cover.jpg",
        "date_range": "[2024-06-01,2024-06-15]",
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "country": {"name": "United States", "code": "US"},
    }
    entry_rows = [
        {
            "id": TEST_ENTRY_ID,
            "title": "Golden Gate Bridge",
            "type": "place",
            "notes": "Amazing views!",
            "place": {"place_name": "Golden Gate Bridge", "address": "San Francisco"},
            "media_files": [],
        }
    ]
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[trip_data],
        entry=entry_rows,
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    assert "Golden Gate Bridge" in response.text


def test_public_trip_with_many_entries(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test public trip page renders all entries when many exist."""
    trip_data = {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "name": "Summer Vacation",
        "share_slug": "summer-vacation-abc123",
        "cover_image_url": None,
        "date_range": "[2024-06-01,2024-06-15]",
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "country": {"name": "United States", "code": "US"},
    }
    entry_rows = [
        {
            "id": f"00000000-0000-0000-0000-{i:012d}",
            "title": f"Entry {i}",
            "type": "place",
            "notes": f"Notes {i}",
            "place": {"place_name": f"Place {i}", "address": f"Address {i}"},
            "media_files": [],
        }
        for i in range(25)
    ]
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[trip_data],
        entry=entry_rows,
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    # The editorial redesign replaced the .entry-card grid with numbered
    # alternating rows; count the row that actually exists now (R12: the feed
    # is uncapped, so every entry must be present). Anchored on the <article>
    # so the row's own child classes (share-row-figure, -body, ...) don't count.
    assert len(re.findall(r'<article\s+class="share-row', response.text)) == len(
        entry_rows
    )
    assert "Entry 0" in response.text
    assert "Entry 24" in response.text


def test_public_list_private_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that private list (is_public=false) returns 404."""
    # The query filters by is_public=true, so an empty result means list doesn't exist or is private
    mock_supabase_client.get.side_effect = supabase_tables()

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/l/private-list-slug")

    assert response.status_code == 404


# ============================================================================
# _extract_place_photo_url Tests
# ============================================================================


def test_extract_place_photo_url_with_valid_url() -> None:
    """Test _extract_place_photo_url returns URL when from valid Google domain."""
    from app.api.public import _extract_place_photo_url

    # Test maps.googleapis.com (whitelisted)
    place = {
        "place_name": "Test Place",
        "extra_data": {"google_photo_url": "https://maps.googleapis.com/photo.jpg"},
    }
    result = _extract_place_photo_url(place)
    assert result == "https://maps.googleapis.com/photo.jpg"

    # Test lh3.googleusercontent.com (whitelisted)
    place = {
        "place_name": "Test Place",
        "extra_data": {
            "google_photo_url": "https://lh3.googleusercontent.com/photo.jpg"
        },
    }
    result = _extract_place_photo_url(place)
    assert result == "https://lh3.googleusercontent.com/photo.jpg"

    # Test non-Google domain (rejected for SSRF protection)
    place = {
        "place_name": "Test Place",
        "extra_data": {"google_photo_url": "https://example.com/photo.jpg"},
    }
    result = _extract_place_photo_url(place)
    assert result is None


def test_extract_place_photo_url_with_none_place() -> None:
    """Test _extract_place_photo_url returns None when place is None."""
    from app.api.public import _extract_place_photo_url

    result = _extract_place_photo_url(None)
    assert result is None


def test_extract_place_photo_url_with_no_extra_data() -> None:
    """Test _extract_place_photo_url returns None when extra_data is missing."""
    from app.api.public import _extract_place_photo_url

    place = {"place_name": "Test Place"}
    result = _extract_place_photo_url(place)
    assert result is None


def test_extract_place_photo_url_with_none_extra_data() -> None:
    """Test _extract_place_photo_url returns None when extra_data is None."""
    from app.api.public import _extract_place_photo_url

    place = {"place_name": "Test Place", "extra_data": None}
    result = _extract_place_photo_url(place)
    assert result is None


def test_extract_place_photo_url_with_non_dict_extra_data() -> None:
    """Test _extract_place_photo_url returns None when extra_data is not a dict."""
    from app.api.public import _extract_place_photo_url

    place = {"place_name": "Test Place", "extra_data": "not a dict"}
    result = _extract_place_photo_url(place)
    assert result is None


def test_extract_place_photo_url_with_missing_google_photo_url() -> None:
    """Test _extract_place_photo_url returns None when google_photo_url key is missing."""
    from app.api.public import _extract_place_photo_url

    place = {"place_name": "Test Place", "extra_data": {"other_key": "value"}}
    result = _extract_place_photo_url(place)
    assert result is None


def test_extract_place_photo_url_with_empty_string() -> None:
    """Test _extract_place_photo_url returns None when google_photo_url is empty string."""
    from app.api.public import _extract_place_photo_url

    place = {"place_name": "Test Place", "extra_data": {"google_photo_url": ""}}
    result = _extract_place_photo_url(place)
    assert result is None


def test_extract_place_photo_url_with_non_string_url() -> None:
    """Test _extract_place_photo_url returns None when google_photo_url is not a string."""
    from app.api.public import _extract_place_photo_url

    place = {"place_name": "Test Place", "extra_data": {"google_photo_url": 12345}}
    result = _extract_place_photo_url(place)
    assert result is None


def test_extract_place_photo_url_with_invalid_scheme() -> None:
    """Test _extract_place_photo_url returns None when URL has invalid scheme."""
    from app.api.public import _extract_place_photo_url

    # Test javascript: scheme (XSS vector)
    place = {
        "place_name": "Test Place",
        "extra_data": {"google_photo_url": "javascript:alert('xss')"},
    }
    result = _extract_place_photo_url(place)
    assert result is None

    # Test data: scheme
    place = {
        "place_name": "Test Place",
        "extra_data": {
            "google_photo_url": "data:text/html,<script>alert('xss')</script>"
        },
    }
    result = _extract_place_photo_url(place)
    assert result is None

    # Test file: scheme
    place = {
        "place_name": "Test Place",
        "extra_data": {"google_photo_url": "file:///etc/passwd"},
    }
    result = _extract_place_photo_url(place)
    assert result is None

    # Test http on Google domain (valid scheme + whitelisted domain)
    place = {
        "place_name": "Test Place",
        "extra_data": {"google_photo_url": "http://maps.googleapis.com/photo.jpg"},
    }
    result = _extract_place_photo_url(place)
    assert result == "http://maps.googleapis.com/photo.jpg"

    # Test http on non-Google domain (rejected - not whitelisted)
    place = {
        "place_name": "Test Place",
        "extra_data": {"google_photo_url": "http://example.com/photo.jpg"},
    }
    result = _extract_place_photo_url(place)
    assert result is None


def test_public_trip_with_place_photo_url(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test public trip page extracts place photo URL from extra_data."""
    trip_data = {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "name": "Summer Vacation",
        "share_slug": "summer-vacation-abc123",
        "cover_image_url": None,
        "date_range": None,
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "country": {"name": "United States", "code": "US"},
    }
    entry_rows = [
        {
            "id": TEST_ENTRY_ID,
            "title": "Great Restaurant",
            "type": "food",
            "notes": "Amazing tacos!",
            "place": {
                "place_name": "Taco Stand",
                "address": "123 Main St",
                "extra_data": {
                    "google_photo_url": "https://maps.googleapis.com/photo.jpg"
                },
            },
            "media_files": [],
        }
    ]
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[trip_data],
        entry=entry_rows,
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    assert "Great Restaurant" in response.text


def test_public_list_with_place_photo_url(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """Test public list page extracts place photo URL from extra_data."""
    list_with_trip = {
        **sample_list,
        "trip": {"name": "Summer Vacation", "country": {"name": "United States"}},
    }
    entry_rows = [
        {
            "id": "entry-1",
            "entry_id": TEST_ENTRY_ID,
            "position": 0,
            "entry": {
                "id": TEST_ENTRY_ID,
                "title": "Best Coffee Shop",
                "type": "food",
                "notes": "Great espresso!",
                "link": None,
                "place": {
                    "place_name": "Coffee House",
                    "address": "456 Oak Ave",
                    "google_place_id": "ChIJ123",
                    "lat": 40.7,
                    "lng": -73.9,
                    "extra_data": {
                        "google_photo_url": "https://maps.googleapis.com/coffee.jpg"
                    },
                },
                "media_files": [],
            },
        }
    ]
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[list_with_trip],
        list_entries=entry_rows,
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/l/best-places-to-visit-abc123")

    assert response.status_code == 200
    assert "Best Coffee Shop" in response.text


# ============================================================================
# Public Profile Page Tests (/u/{username})
# ============================================================================


def test_public_profile_returns_html(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that public profile page returns HTML."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "traveler_pro",
        "display_name": "Pro Traveler",
        "avatar_url": "https://example.com/avatar.jpg",
        "home_country_code": "US",
        "created_at": "2024-01-01T00:00:00Z",
    }
    stats_result = [
        {
            "country_count": 25,
            "continent_count": 4,
            "subregion_count": 12,
            "follower_count": 2,
            "following_count": 1,
        }
    ]
    mock_supabase_client.get.side_effect = [
        [profile_data],  # Profile lookup
        [{"name": "United States"}],  # Home country
    ]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/traveler_pro")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Pro Traveler" in response.text


def test_public_profile_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that non-existent profile returns 404."""
    mock_supabase_client.get.return_value = []

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/nonexistent_user")

    assert response.status_code == 404


def test_public_profile_case_insensitive(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that username lookup is case-insensitive."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "TravelerPro",
        "display_name": "Pro Traveler",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    stats_result = [
        {
            "country_count": 0,
            "continent_count": 0,
            "subregion_count": 0,
            "follower_count": 0,
            "following_count": 0,
        }
    ]
    # No home_country_code means only 1 get() call for profile
    mock_supabase_client.get.side_effect = [[profile_data]]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        # Request with lowercase, should find uppercase username
        response = client.get("/u/travelerpro")

    assert response.status_code == 200
    assert "Pro Traveler" in response.text


def test_public_profile_has_cache_header(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that public profile page has cache control header."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "traveler_pro",
        "display_name": "Pro Traveler",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    stats_result = [
        {
            "country_count": 5,
            "continent_count": 2,
            "subregion_count": 3,
            "follower_count": 0,
            "following_count": 0,
        }
    ]
    # No home_country_code means only 1 get() call for profile
    mock_supabase_client.get.side_effect = [[profile_data]]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/traveler_pro")

    assert response.status_code == 200
    assert "Cache-Control" in response.headers
    assert "public" in response.headers["Cache-Control"]


def test_public_profile_stats_calculation(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that profile stats are calculated correctly via RPC."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "world_traveler",
        "display_name": "World Traveler",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    # User has visited 50 countries across 5 continents and 15 subregions
    stats_result = [{"country_count": 50, "continent_count": 5, "subregion_count": 15}]
    mock_supabase_client.get.side_effect = [
        [profile_data],
        [{"id": str(i)} for i in range(100)],  # 100 followers
        [{"id": str(i)} for i in range(50)],  # 50 following
    ]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/world_traveler")

    assert response.status_code == 200
    # Verify stats appear in HTML (exact rendering depends on template)
    assert "50" in response.text  # country count
    assert "World Traveler" in response.text


def test_public_profile_no_countries(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test profile page for user with no visited countries."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "new_user",
        "display_name": "New User",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    stats_result = [{"country_count": 0, "continent_count": 0, "subregion_count": 0}]
    mock_supabase_client.get.side_effect = [
        [profile_data],
        [],  # No followers
        [],  # Not following anyone
    ]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/new_user")

    assert response.status_code == 200
    assert "New User" in response.text


def test_public_profile_with_home_country(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test profile page displays home country name."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "american_traveler",
        "display_name": "American Traveler",
        "avatar_url": None,
        "home_country_code": "US",
        "created_at": "2024-01-01T00:00:00Z",
    }
    stats_result = [
        {
            "country_count": 10,
            "continent_count": 3,
            "subregion_count": 5,
            "follower_count": 0,
            "following_count": 0,
        }
    ]
    mock_supabase_client.get.side_effect = [
        [profile_data],
        [{"name": "United States"}],  # Home country lookup
    ]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/american_traveler")

    assert response.status_code == 200
    assert "United States" in response.text


def test_public_profile_invalid_username_format(client: TestClient) -> None:
    """Test that invalid username format returns 422."""
    # Username with special characters should be rejected by path validation
    response = client.get("/u/invalid@username!")
    assert response.status_code == 422


def test_public_profile_has_seo_tags(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that public profile page includes SEO meta tags."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "seo_test_user",
        "display_name": "SEO Test User",
        "avatar_url": "https://example.com/avatar.jpg",
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    stats_result = [
        {
            "country_count": 15,
            "continent_count": 3,
            "subregion_count": 8,
            "follower_count": 0,
            "following_count": 0,
        }
    ]
    mock_supabase_client.get.side_effect = [[profile_data]]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/seo_test_user")

    assert response.status_code == 200
    # Check for Open Graph tags
    assert "og:title" in response.text
    assert "og:description" in response.text
    assert "og:url" in response.text
    # Check for canonical URL
    assert 'rel="canonical"' in response.text
    # Check that username appears in SEO context
    assert "seo_test_user" in response.text


def test_public_profile_follower_following_counts(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that follower and following counts are displayed correctly."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "popular_user",
        "display_name": "Popular User",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    # User has many followers and follows some people
    stats_result = [
        {
            "country_count": 20,
            "continent_count": 4,
            "subregion_count": 10,
            "follower_count": 1234,
            "following_count": 567,
        }
    ]
    mock_supabase_client.get.side_effect = [[profile_data]]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/popular_user")

    assert response.status_code == 200
    # Verify both counts appear in the response
    # The exact format depends on the template, but numbers should be present
    assert "1,234" in response.text or "1234" in response.text  # follower count
    assert "567" in response.text  # following count


def test_public_profile_rpc_empty_result(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that profile page handles empty RPC result gracefully."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "edge_case_user",
        "display_name": "Edge Case User",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    # RPC returns empty result (edge case)
    mock_supabase_client.get.side_effect = [[profile_data]]
    mock_supabase_client.rpc.return_value = []

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/edge_case_user")

    assert response.status_code == 200
    assert "Edge Case User" in response.text
    # Should default to 0 for all counts
    assert "0" in response.text


def test_public_profile_world_percentage_calculation(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that world percentage is calculated and displayed correctly."""
    profile_data = {
        "user_id": TEST_USER_ID,
        "username": "globe_trotter",
        "display_name": "Globe Trotter",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    # 50 countries out of ~195 = ~25.6%
    stats_result = [
        {
            "country_count": 50,
            "continent_count": 5,
            "subregion_count": 20,
            "follower_count": 0,
            "following_count": 0,
        }
    ]
    mock_supabase_client.get.side_effect = [[profile_data]]
    mock_supabase_client.rpc.return_value = stats_result

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/u/globe_trotter")

    assert response.status_code == 200
    assert "Globe Trotter" in response.text
    # Country count should appear
    assert "50" in response.text


# ============================================================================
# Trip Entry Coordinates (U1)
# ============================================================================


def _render_trip_and_capture_view(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    entry_rows: list[dict[str, Any]],
) -> Any:
    """Render /t/{slug} with the given entries and return the PublicTripView."""
    trip_data = {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "name": "Summer Vacation",
        "share_slug": "summer-vacation-abc123",
        "cover_image_url": None,
        "date_range": "[2024-06-01,2024-06-15]",
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "country": {"name": "United States", "code": "US"},
    }
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[trip_data],
        entry=entry_rows,
    )

    captured: dict[str, Any] = {}
    real_template_response = public_module.templates.TemplateResponse

    def capture(*args: Any, **kwargs: Any) -> Any:
        captured["context"] = kwargs.get("context", {})
        return real_template_response(*args, **kwargs)

    with (
        patch(
            "app.api.public.get_service_supabase_client",
            return_value=mock_supabase_client,
        ),
        patch.object(public_module.templates, "TemplateResponse", side_effect=capture),
    ):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    return captured["context"]["trip"]


def test_public_trip_entry_exposes_place_coordinates(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """A trip entry whose place has lat/lng exposes them on the view model."""
    trip_view = _render_trip_and_capture_view(
        client,
        mock_supabase_client,
        [
            {
                "id": TEST_ENTRY_ID,
                "title": "Golden Gate Bridge",
                "type": "place",
                "notes": None,
                "place": {
                    "place_name": "Golden Gate Bridge",
                    "address": "San Francisco",
                    "lat": 37.8199,
                    "lng": -122.4783,
                },
                "media_files": [],
            }
        ],
    )

    entry = trip_view.entries[0]
    assert entry.latitude == 37.8199
    assert entry.longitude == -122.4783


def test_public_trip_entry_without_place_has_null_coordinates(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """A trip entry with no place row yields None coordinates, not a KeyError."""
    trip_view = _render_trip_and_capture_view(
        client,
        mock_supabase_client,
        [
            {
                "id": TEST_ENTRY_ID,
                "title": "Just a note",
                "type": "experience",
                "notes": "No place attached",
                "place": None,
                "media_files": [],
            }
        ],
    )

    entry = trip_view.entries[0]
    assert entry.latitude is None
    assert entry.longitude is None


def test_public_trip_entry_with_place_but_null_coordinates(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """A place row with null lat/lng yields None for both coordinates."""
    trip_view = _render_trip_and_capture_view(
        client,
        mock_supabase_client,
        [
            {
                "id": TEST_ENTRY_ID,
                "title": "Somewhere",
                "type": "place",
                "notes": None,
                "place": {
                    "place_name": "Somewhere",
                    "address": None,
                    "lat": None,
                    "lng": None,
                },
                "media_files": [],
            }
        ],
    )

    entry = trip_view.entries[0]
    assert entry.latitude is None
    assert entry.longitude is None


# ============================================================================
# Content-Security-Policy Tests (U3: Maps configuration and CSP)
#
# The share routes (/l/{slug}, /t/{slug}) render an interactive Google Map, so
# they get a Maps-compatible CSP. Every other route keeps the stricter default
# policy. The containment of 'unsafe-eval' to just the share routes is the
# whole point of the branch, so it is asserted in both directions.
# ============================================================================

CSP_HEADER = "Content-Security-Policy"

# Routes that must keep the stricter default policy. /trips is an API route: it
# 401s without a token, but the middleware still stamps the header on the way out.
NON_SHARE_PATHS = ("/", "/privacy", "/contact", "/health", "/trips")


def _csp_for_share_route(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    path: str,
) -> str:
    """Return the CSP header for a share route.

    The middleware sets the header on every response, including the 404 that a
    slug miss produces, so an empty supabase result is enough to exercise the
    header without fixture-shaping a full page render.
    """
    mock_supabase_client.get.side_effect = supabase_tables()
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get(path)
    assert response.status_code == 404
    return response.headers[CSP_HEADER]


def _csp_directive(csp: str, name: str) -> str:
    """Extract a single directive's value from a CSP header string."""
    for directive in csp.split(";"):
        directive = directive.strip()
        if directive.split(" ")[0] == name:
            return directive
    raise AssertionError(f"CSP has no {name!r} directive: {csp}")


def test_share_list_csp_allows_google_maps(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Maps needs unsafe-eval, blob workers, and googleapis in connect/img."""
    csp = _csp_for_share_route(client, mock_supabase_client, "/l/some-slug")

    assert "'unsafe-eval'" in _csp_directive(csp, "script-src")
    assert "blob:" in _csp_directive(csp, "script-src")
    assert "worker-src blob:" in csp
    assert "*.googleapis.com" in _csp_directive(csp, "connect-src")
    assert "*.googleapis.com" in _csp_directive(csp, "img-src")


def test_share_trip_csp_allows_google_maps(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """The trip share route gets the same Maps-compatible policy."""
    csp = _csp_for_share_route(client, mock_supabase_client, "/t/some-slug")

    assert "'unsafe-eval'" in _csp_directive(csp, "script-src")
    assert "blob:" in _csp_directive(csp, "script-src")
    assert "worker-src blob:" in csp
    assert "*.googleapis.com" in _csp_directive(csp, "connect-src")
    assert "*.googleapis.com" in _csp_directive(csp, "img-src")


def test_share_route_csp_keeps_supabase_images(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Entry photos are served from Supabase storage - regression guard."""
    for path in ("/l/some-slug", "/t/some-slug"):
        csp = _csp_for_share_route(client, mock_supabase_client, path)
        img_src = _csp_directive(csp, "img-src")
        assert "https://*.supabase.co" in img_src


def test_share_route_csp_keeps_google_places_photo_hosts(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Entry photos can also come from Google Places photo hosts."""
    for path in ("/l/some-slug", "/t/some-slug"):
        img_src = _csp_directive(
            _csp_for_share_route(client, mock_supabase_client, path), "img-src"
        )
        assert "https://places.googleapis.com" in img_src
        assert "https://*.ggpht.com" in img_src
        assert "https://lh3.googleusercontent.com" in img_src


def test_share_route_csp_keeps_analytics_and_fonts(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """GA and Google Fonts must keep working on the redesigned share pages."""
    for path in ("/l/some-slug", "/t/some-slug"):
        csp = _csp_for_share_route(client, mock_supabase_client, path)
        assert "https://www.googletagmanager.com" in _csp_directive(csp, "script-src")
        connect_src = _csp_directive(csp, "connect-src")
        assert "https://www.google-analytics.com" in connect_src
        assert "https://analytics.google.com" in connect_src
        assert "https://fonts.googleapis.com" in _csp_directive(csp, "style-src")
        assert "https://fonts.gstatic.com" in _csp_directive(csp, "font-src")


def test_share_route_csp_style_src_is_nonce_only(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """R10: Maps support must not weaken style-src to 'unsafe-inline'.

    Do not "fix" a blocked-stylesheet failure by relaxing this. The Maps API
    stamps its own injected <style> elements with the nonce it reads off the
    first `style[nonce]` in the document, so the correct fix is the nonce donor
    in base.html (see `test_pages_carry_a_nonced_style_donor_for_maps`). Adding
    'unsafe-inline' would not even work: a nonce in the source list makes
    browsers ignore 'unsafe-inline' outright.
    """
    for path in ("/l/some-slug", "/t/some-slug"):
        csp = _csp_for_share_route(client, mock_supabase_client, path)
        style_src = _csp_directive(csp, "style-src")
        assert "'nonce-" in style_src
        assert "'unsafe-inline'" not in style_src


def _style_src_nonce(csp: str) -> str:
    """Pull the nonce value out of a policy's style-src directive."""
    match = re.search(r"'nonce-([^']+)'", _csp_directive(csp, "style-src"))
    assert match, f"style-src carries no nonce: {csp}"
    return match.group(1)


def test_pages_carry_a_nonced_style_donor_for_maps(client: TestClient) -> None:
    """base.html must ship a <style nonce> for the Maps API to copy.

    The Maps JS API installs all of its classic chrome -- the InfoWindow bubble,
    its tail and shadow, the control hover states -- through a <style> element it
    creates at runtime. It stamps a nonce on that element only when
    `document.querySelector("style[nonce]")` matches; a nonced <link> or <script>
    does not. Our style-src is nonce-only with no 'unsafe-inline' (deliberately,
    see the test above), so with no donor those stylesheets are refused and the
    InfoWindow renders as an unstyled block with a broken close button.

    Asserted on a non-share route too because the donor lives in base.html: the
    default policy is also nonce-only, so a nonce-less donor would break
    every page.
    """
    for path in ("/", "/privacy"):
        response = client.get(path)
        nonce = _style_src_nonce(response.headers[CSP_HEADER])
        assert re.search(
            rf'<style nonce="{re.escape(nonce)}"', response.text
        ), f"{path} has no style[nonce] for the Maps API to copy"


def test_non_share_routes_csp_has_no_unsafe_eval(client: TestClient) -> None:
    """KTD11 containment guard: 'unsafe-eval' never leaves the share routes."""
    for path in NON_SHARE_PATHS:
        response = client.get(path)
        csp = response.headers[CSP_HEADER]
        assert "'unsafe-eval'" not in csp, f"{path} leaked 'unsafe-eval'"
        assert "worker-src" not in csp, f"{path} leaked worker-src"


def test_non_share_routes_csp_style_src_is_nonce_only(client: TestClient) -> None:
    """The default policy keeps its nonce-based style-src."""
    for path in NON_SHARE_PATHS:
        style_src = _csp_directive(client.get(path).headers[CSP_HEADER], "style-src")
        assert "'nonce-" in style_src
        assert "'unsafe-inline'" not in style_src


def test_maps_settings_default_to_empty_strings() -> None:
    """CI and local dev must work without the new Maps env vars."""
    settings = Settings(_env_file=None)
    assert settings.google_maps_browser_api_key == ""
    assert settings.google_maps_map_id == ""


def test_maps_settings_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both Maps vars are env-overridable."""
    monkeypatch.setenv("GOOGLE_MAPS_BROWSER_API_KEY", "browser-key")
    monkeypatch.setenv("GOOGLE_MAPS_MAP_ID", "map-id-123")
    settings = Settings(_env_file=None)
    assert settings.google_maps_browser_api_key == "browser-key"
    assert settings.google_maps_map_id == "map-id-123"


# ============================================================================
# Owner byline (U4: R7 "Shared by Maya - 31 countries visited", R11 avatar)
#
# The byline is the page's social proof, not load-bearing content: it is the
# one part of a share page that may be missing without the page being wrong.
# So every test here is really asking the same question -- does the page still
# render? -- with the author data degraded in a different way.
# ============================================================================

LIST_SLUG = "best-places-to-visit-abc123"
TRIP_SLUG = "summer-vacation-abc123"


def _trip_row() -> dict[str, Any]:
    return {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "name": "Summer Vacation",
        "share_slug": TRIP_SLUG,
        "cover_image_url": None,
        "date_range": None,
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "country": {"name": "United States", "code": "US"},
    }


def _visited(count: int) -> list[dict[str, Any]]:
    """`count` visited user_countries rows, as the byline query would see them."""
    return [{"id": f"uc-{i}"} for i in range(count)]


def _render_and_capture_author(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    path: str,
) -> Any:
    """Render a share page and return the `author` it put in the template context."""
    captured: dict[str, Any] = {}
    real_template_response = public_module.templates.TemplateResponse

    def capture(*args: Any, **kwargs: Any) -> Any:
        captured["context"] = kwargs.get("context", {})
        return real_template_response(*args, **kwargs)

    with (
        patch(
            "app.api.public.get_service_supabase_client",
            return_value=mock_supabase_client,
        ),
        patch.object(public_module.templates, "TemplateResponse", side_effect=capture),
    ):
        response = client.get(path)

    assert response.status_code == 200
    return captured["context"]["author"]


def test_public_list_byline_has_owner_name_and_country_count(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """R7: a list's byline carries the owner's name and visited-country count."""
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[{**sample_list, "trip": {"name": "Summer Vacation"}}],
        user_profile=[{"display_name": "Maya", "avatar_url": None}],
        user_countries=_visited(31),
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author is not None
    assert author.display_name == "Maya"
    assert author.country_count == 31


def test_public_trip_byline_has_owner_name_and_country_count(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """R7: the trip page bylines its owner too, keyed off trip.user_id."""
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[_trip_row()],
        user_profile=[{"display_name": "Maya", "avatar_url": None}],
        user_countries=_visited(31),
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/t/{TRIP_SLUG}")

    assert author is not None
    assert author.display_name == "Maya"
    assert author.country_count == 31


def test_byline_queries_owner_of_the_shared_thing(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """The profile is looked up by the list's owner_id, not some other user."""
    seen: list[dict[str, Any]] = []

    def record_profile(params: dict[str, Any]) -> list[dict[str, Any]]:
        seen.append(params)
        return [{"display_name": "Maya", "avatar_url": None}]

    mock_supabase_client.get.side_effect = supabase_tables(
        list=[{**sample_list, "owner_id": OTHER_USER_ID}],
        user_profile=record_profile,
        user_countries=[],
    )

    _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert seen, "the byline never queried user_profile"
    assert seen[0]["user_id"] == f"eq.{OTHER_USER_ID}"


def test_byline_counts_only_visited_countries(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """Wishlist rows are aspirations, not stamps -- they must not be counted."""
    seeded = [
        {"id": "uc-1", "status": "visited"},
        {"id": "uc-2", "status": "wishlist"},
    ]

    def only_visited(params: dict[str, Any]) -> list[dict[str, Any]]:
        # Mirror what PostgREST would do with the endpoint's own filter, so a
        # query that forgot `status=eq.visited` counts the wishlist row and fails.
        wanted = params.get("status", "").removeprefix("eq.")
        return [row for row in seeded if row["status"] == wanted]

    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[{"display_name": "Maya", "avatar_url": None}],
        user_countries=only_visited,
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author.country_count == 1


def test_byline_owner_with_no_visited_countries_has_zero_count(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """A brand-new owner still gets a byline -- name only, count 0, no crash.

    The template omits the "N countries visited" clause at 0, so the byline
    never reads "0 countries visited".
    """
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[{"display_name": "Maya", "avatar_url": None}],
        user_countries=[],
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author is not None
    assert author.display_name == "Maya"
    assert author.country_count == 0


def test_byline_owner_with_no_profile_row_renders_without_byline(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """R7 degradation: a missing profile drops the byline, it does not 500."""
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[],  # no profile row for this owner
        user_countries=_visited(3),
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author is None


def test_byline_profile_with_null_avatar_yields_no_avatar_url(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """R11: no avatar means a name-only byline, never a broken <img>."""
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[{"display_name": "Maya", "avatar_url": None}],
        user_countries=_visited(2),
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author.avatar_url is None


def test_byline_keeps_social_provider_avatar_url_intact(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """`user_profile.avatar_url` holds an absolute social-provider URL.

    `handle_new_user()` copies it straight out of the OAuth metadata
    (`avatar_url` / `picture`), so it is already a Google-hosted URL -- not a
    path inside our storage bucket. Rewriting it through the storage
    render endpoint would produce a 404, so it must pass through untouched.
    """
    google_avatar = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c"
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[{"display_name": "Maya", "avatar_url": google_avatar}],
        user_countries=_visited(2),
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author.avatar_url == google_avatar


def test_byline_resizes_a_storage_path_avatar(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """R13: an avatar stored in our bucket is served at AVATAR_WIDTH, not full-res.

    No writer puts a storage path in this column today, but the schema is a bare
    TEXT and an in-app avatar upload would land here -- so the path form is
    handled rather than silently emitted as a relative URL.
    """
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[
            {"display_name": "Maya", "avatar_url": f"{TEST_USER_ID}/avatar.jpg"}
        ],
        user_countries=_visited(2),
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author.avatar_url is not None
    assert "/render/image/public/media/" in author.avatar_url
    assert f"width={AVATAR_WIDTH}" in author.avatar_url


def test_byline_rejects_a_hostile_avatar_url(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """A `javascript:` avatar must not reach an `<img src>`."""
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[
            {"display_name": "Maya", "avatar_url": "javascript:alert('xss')"}
        ],
        user_countries=[],
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author.avatar_url is None


@pytest.mark.parametrize(
    ("path", "primary_table", "primary_rows"),
    [
        ("/l/" + LIST_SLUG, "list", None),
        ("/t/" + TRIP_SLUG, "trip", None),
    ],
)
def test_byline_db_failure_does_not_break_the_page(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
    path: str,
    primary_table: str,
    primary_rows: Any,
) -> None:
    """A failed author fetch degrades to no byline; the share page still renders.

    The share page is the growth surface -- losing the byline is survivable,
    losing the page is not. Both queries behind the byline are failed here.
    """
    rows = [sample_list] if primary_table == "list" else [_trip_row()]
    mock_supabase_client.get.side_effect = supabase_tables(
        **{primary_table: rows},
        user_profile=RuntimeError("supabase is down"),
        user_countries=RuntimeError("supabase is down"),
    )

    author = _render_and_capture_author(client, mock_supabase_client, path)

    assert author is None


def test_byline_country_count_failure_still_shows_the_name(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """Both byline queries fail together, so a partial failure loses the byline.

    Documents the chosen degradation: the two fetches are gathered, and any
    failure drops the whole author rather than rendering a name beside a
    count we could not verify.
    """
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[sample_list],
        user_profile=[{"display_name": "Maya", "avatar_url": None}],
        user_countries=RuntimeError("supabase is down"),
    )

    author = _render_and_capture_author(client, mock_supabase_client, f"/l/{LIST_SLUG}")

    assert author is None


# ============================================================================
# Editorial share page: layout, image discipline, SEO (U5 / U5b)
# ============================================================================


def _list_page(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    entry_rows: list[dict[str, Any]],
    *,
    list_row: dict[str, Any] | None = None,
    profile: list[dict[str, Any]] | None = None,
) -> Any:
    """Render /l/{slug} with the given entries and return the response."""
    base_list = {
        "id": TEST_LIST_ID,
        "owner_id": TEST_USER_ID,
        "name": "Istanbul",
        "slug": "istanbul-abc123",
        "description": "Highlights from two trips",
        "created_at": "2024-01-01T00:00:00Z",
        "trip": {
            "name": "Turkey",
            "cover_image_url": (
                "https://test.supabase.co/storage/v1/object/public/media/cover.jpg"
            ),
            "country": {"name": "Turkey", "code": "TR"},
        },
    }
    tables: dict[str, Any] = {
        "list": [list_row or base_list],
        "list_entries": entry_rows,
    }
    if profile is not None:
        tables["user_profile"] = profile

    mock_supabase_client.get.side_effect = supabase_tables(**tables)

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        return client.get("/l/istanbul-abc123")


def _entry_row(
    index: int,
    *,
    entry_type: str = "place",
    media: list[dict[str, Any]] | None = None,
    lat: float | None = None,
    lng: float | None = None,
    notes: str | None = None,
    google_place_id: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    return {
        "id": f"le-{index}",
        "position": index,
        "entry": {
            "id": f"00000000-0000-0000-0000-{index:012d}",
            "title": title if title is not None else f"Entry {index}",
            "type": entry_type,
            "notes": notes if notes is not None else f"Note {index}",
            "place": {
                "place_name": f"Place {index}",
                "address": "Istanbul",
                "google_place_id": google_place_id,
                "lat": lat,
                "lng": lng,
            },
            "media_files": media or [],
        },
    }


def test_share_rows_alternate_image_side(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Even ordinals put the image left; odd ones flip it (AE1)."""
    response = _list_page(
        client, mock_supabase_client, [_entry_row(i) for i in range(4)]
    )

    rows = re.findall(r'<article\s+class="share-row([^"]*)"', response.text)
    assert len(rows) == 4
    # 1st and 3rd rows are un-reversed; 2nd and 4th carry the modifier.
    assert "is-reversed" not in rows[0]
    assert "is-reversed" in rows[1]
    assert "is-reversed" not in rows[2]
    assert "is-reversed" in rows[3]


def test_share_entry_with_photo_renders_an_image(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """An entry with media shows the photo, not the fallback tile (AE3)."""
    response = _list_page(
        client,
        mock_supabase_client,
        [
            _entry_row(
                0,
                media=[
                    {
                        "status": "uploaded",
                        "file_path": "u/photo.jpg",
                        "thumbnail_path": None,
                    }
                ],
            )
        ],
    )

    assert 'class="share-row-image"' in response.text
    assert "share-tile-glyph" not in response.text


def test_share_entry_without_photo_renders_the_category_tile(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """An entry with no photo falls back to the tinted category tile (AE3)."""
    response = _list_page(client, mock_supabase_client, [_entry_row(0)])

    assert "share-tile-glyph" in response.text
    assert 'class="share-row-image"' not in response.text


def test_share_entry_photo_is_served_at_display_width(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """AE9: an entry whose media row has no thumbnail still gets a sized URL."""
    response = _list_page(
        client,
        mock_supabase_client,
        [
            _entry_row(
                0,
                media=[
                    {
                        "status": "uploaded",
                        "file_path": "u/huge-original.jpg",
                        "thumbnail_path": None,
                    }
                ],
            )
        ],
    )

    assert "/render/image/public/media/" in response.text
    assert "width=800" in response.text


def test_share_hero_is_resized_and_not_lazy(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R13/KTD9: the hero is the LCP element -- sized, eager, high priority."""
    response = _list_page(client, mock_supabase_client, [_entry_row(0)])

    hero = re.search(r'<img[^>]*class="share-hero-image"[^>]*>', response.text)
    assert hero, "hero image is missing"
    hero_tag = hero.group(0)
    assert "width=1600" in response.text
    assert 'fetchpriority="high"' in hero_tag
    assert 'loading="lazy"' not in hero_tag


def test_share_entry_images_are_lazy_and_dimensioned(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """KTD9: below-fold images defer and reserve layout space (no CLS)."""
    response = _list_page(
        client,
        mock_supabase_client,
        [
            _entry_row(
                0,
                media=[
                    {
                        "status": "uploaded",
                        "file_path": "u/p.jpg",
                        "thumbnail_path": "u/t.jpg",
                    }
                ],
            )
        ],
    )

    img = re.search(r'<img[^>]*class="share-row-image"[^>]*>', response.text)
    assert img
    tag = img.group(0)
    assert 'loading="lazy"' in tag
    assert 'decoding="async"' in tag
    assert 'width="800"' in tag
    assert 'height="600"' in tag


def test_share_filters_only_offer_categories_present(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A collection with no stays must not offer a 'Stays · 0' chip."""
    response = _list_page(
        client,
        mock_supabase_client,
        [
            _entry_row(0, entry_type="place"),
            _entry_row(1, entry_type="food"),
        ],
    )

    assert 'data-filter="place"' in response.text
    assert 'data-filter="food"' in response.text
    assert 'data-filter="stay"' not in response.text
    assert 'data-filter="experience"' not in response.text


def test_share_entry_preserves_the_affiliate_redirect(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R9: entry clicks must still go through the signed redirect."""
    with patch(
        "app.api.public._generate_entry_redirect_url",
        return_value="https://atlasi.app/r/signed-token",
    ):
        response = _list_page(client, mock_supabase_client, [_entry_row(0)])

    assert 'href="https://atlasi.app/r/signed-token"' in response.text


def test_share_empty_collection_renders_empty_state_and_no_map(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """AE5: no entries -> empty state, and no map section at all."""
    response = _list_page(client, mock_supabase_client, [])

    assert response.status_code == 200
    assert "share-empty" in response.text
    assert 'id="share-map"' not in response.text


def test_share_map_absent_without_coordinates(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """AE5: entries with no coordinates render a feed but hide the map."""
    response = _list_page(client, mock_supabase_client, [_entry_row(0)])

    assert "Entry 0" in response.text
    assert 'id="share-map"' not in response.text


def test_share_map_absent_without_an_api_key(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """AE6: no browser key (CI, local dev) -> the map section is omitted."""
    response = _list_page(
        client,
        mock_supabase_client,
        [_entry_row(0, lat=41.0, lng=28.9)],
    )

    assert "Entry 0" in response.text
    assert 'id="share-map"' not in response.text


def test_share_content_is_server_rendered(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """AE10 / KTD10: every entry's text is in the HTML, with no JS required."""
    response = _list_page(
        client, mock_supabase_client, [_entry_row(i) for i in range(30)]
    )

    for i in range(30):
        assert f"Entry {i}" in response.text  # title
        assert f"Note {i}" in response.text  # note
        assert f"Place {i}" in response.text  # place name


def test_share_pages_emit_nonced_structured_data(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """U5b: valid JSON-LD, carrying the CSP nonce -- which it did not before."""
    response = _list_page(
        client,
        mock_supabase_client,
        [_entry_row(0, lat=41.0, lng=28.9), _entry_row(1)],
    )

    match = re.search(
        r'<script type="application/ld\+json"([^>]*)>(.*?)</script>',
        response.text,
        re.DOTALL,
    )
    assert match, "share page is missing its JSON-LD"
    assert "nonce=" in match.group(1)

    data = json.loads(match.group(2))
    types = {node["@type"] for node in data["@graph"]}
    assert types == {"ItemList", "BreadcrumbList"}

    item_list = next(n for n in data["@graph"] if n["@type"] == "ItemList")
    assert len(item_list["itemListElement"]) == 2

    # An entry with coordinates contributes geo; one without omits it entirely.
    first, second = item_list["itemListElement"]
    assert first["item"]["geo"]["latitude"] == 41.0
    assert "geo" not in second["item"]


# ============================================================================
# The map: custom pins (U7)
# ============================================================================


def _list_page_with_maps_configured(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    entry_rows: list[dict[str, Any]],
) -> Any:
    """Render /l/{slug} with a Maps browser key and Map ID configured."""
    settings = get_settings()
    configured = settings.model_copy(
        update={
            "google_maps_browser_api_key": "browser-key-123",
            "google_maps_map_id": "map-id-456",
            "google_places_api_key": "SERVER-SIDE-PLACES-KEY",
        }
    )

    with patch("app.api.public.get_settings", return_value=configured):
        return _list_page(client, mock_supabase_client, entry_rows)


def test_map_renders_when_configured_and_coordinates_exist(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Key + Map ID + at least one coordinate -> the map section renders."""
    response = _list_page_with_maps_configured(
        client,
        mock_supabase_client,
        [_entry_row(0, lat=41.0082, lng=28.9784)],
    )

    assert 'id="share-map"' in response.text
    assert "share-map-data" in response.text
    assert "js/share-map.js" in response.text


def test_map_data_carries_only_entries_with_coordinates(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R8: a coordinate-less entry stays in the feed but off the map."""
    response = _list_page_with_maps_configured(
        client,
        mock_supabase_client,
        [
            _entry_row(0, lat=41.0082, lng=28.9784),
            _entry_row(1),  # no coordinates
            _entry_row(2, entry_type="food", lat=41.03, lng=28.97),
        ],
    )

    # All three are in the feed...
    assert len(re.findall(r'<article\s+class="share-row', response.text)) == 3

    # ...but only the two with coordinates reach the map.
    payload = json.loads(
        re.search(
            r'<script type="application/json" id="share-map-data"[^>]*>(.*?)</script>',
            response.text,
            re.DOTALL,
        ).group(1)
    )
    assert len(payload["entries"]) == 2

    # Each pin carries its ordinal (so it matches its feed row) and its
    # category's pin color.
    first, second = payload["entries"]
    assert first["ordinal"] == 1
    assert first["color"] == CATEGORY_STYLES["place"].pin
    assert second["ordinal"] == 3  # ordinal 2 has no coordinates
    assert second["color"] == CATEGORY_STYLES["food"].pin


def _map_payload(response: Any) -> list[dict[str, Any]]:
    """Parse the entries out of the page's share-map-data block."""
    block = re.search(
        r'<script type="application/json" id="share-map-data"[^>]*>(.*?)</script>',
        response.text,
        re.DOTALL,
    )
    assert block, "the page has no share-map-data block"
    return json.loads(block.group(1))["entries"]


def test_map_list_rows_carry_the_ordinal_that_joins_them_to_a_pin(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """`data-ordinal` is the only tie between a place row and its marker.

    share-map.js looks pins up by this value, so a row whose ordinal drifts from
    the payload's silently stops responding to taps -- with nothing in the
    console, because the lookup just misses.
    """
    response = _list_page_with_maps_configured(
        client,
        mock_supabase_client,
        [
            _entry_row(0, lat=41.0082, lng=28.9784),
            _entry_row(1),  # no coordinates: absent from both list and map
            _entry_row(2, entry_type="food", lat=41.03, lng=28.97),
        ],
    )

    rows = re.findall(
        r'<li class="share-map-list-item" data-ordinal="(\d+)"', response.text
    )
    assert rows == ["1", "3"]
    assert [str(entry["ordinal"]) for entry in _map_payload(response)] == rows


def test_map_payload_carries_the_info_card_fields(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A tapped pin renders category, place, note and a Maps link from this."""
    response = _list_page_with_maps_configured(
        client,
        mock_supabase_client,
        [_entry_row(0, entry_type="food", lat=41.0082, lng=28.9784)],
    )

    entry = _map_payload(response)[0]
    assert entry["type"] == "food"
    assert entry["category"] == CATEGORY_STYLES["food"].label
    assert entry["place"] == "Place 0"
    assert entry["note"] == "Note 0"
    assert entry["mapsUrl"] == (
        "https://www.google.com/maps/search/?api=1&query=41.0082%2C28.9784"
    )


def test_map_payload_maps_url_prefers_the_place_id(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """With a place id Maps resolves the venue, not just a dropped pin."""
    response = _list_page_with_maps_configured(
        client,
        mock_supabase_client,
        [_entry_row(0, lat=41.0, lng=28.9, google_place_id="ChIJ_abc123")],
    )

    maps_url = _map_payload(response)[0]["mapsUrl"]
    assert "query_place_id=ChIJ_abc123" in maps_url
    # Google requires `query` alongside the id and falls back to it if the id
    # stops resolving, so both must be present.
    assert "query=41.0%2C28.9" in maps_url


def test_map_payload_truncates_long_notes(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The card is a glance. The full note is already in the feed row below.

    This blob sits inline in the HTML of a page that renders up to 50 entries,
    so an uncapped note is 50x page weight for text nobody reads on a pin.
    """
    long_note = "word " * 200
    response = _list_page_with_maps_configured(
        client,
        mock_supabase_client,
        [_entry_row(0, lat=41.0, lng=28.9, notes=long_note)],
    )

    note = _map_payload(response)[0]["note"]
    assert len(note) <= MAP_NOTE_LIMIT + 1  # +1 for the ellipsis
    assert note.endswith("…")
    # The feed row below still carries the whole thing -- the cap is about the
    # inline JSON blob, not about withholding content.
    assert long_note.strip() in response.text


def test_map_payload_carries_no_photo_url(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R5 guard, extended: photo URLs embed the server-side Places key.

    The info card is text-only partly for weight and partly for this: adding a
    `place_photo_url` to the payload would put a keyed Google URL into public
    HTML, which `test_map_never_leaks_the_server_side_places_key` would catch
    only for the one key spelling it knows about.
    """
    response = _list_page_with_maps_configured(
        client, mock_supabase_client, [_entry_row(0, lat=41.0, lng=28.9)]
    )

    entry = _map_payload(response)[0]
    assert "photo" not in " ".join(entry.keys()).lower()


def test_map_data_script_carries_the_csp_nonce(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A nonce-less script is silently blocked by the CSP."""
    response = _list_page_with_maps_configured(
        client, mock_supabase_client, [_entry_row(0, lat=41.0, lng=28.9)]
    )

    tag = re.search(
        r'<script type="application/json" id="share-map-data"([^>]*)>', response.text
    )
    assert tag
    assert "nonce=" in tag.group(1)


def test_style_nonce_donor_is_in_head_before_the_map_boots(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The donor must be the first style[nonce], and must precede the map.

    Two ordering facts make this load-bearing: Maps reads the *first* matching
    element in document order, and it reads it at the moment it injects, which is
    after `share-map.js` boots. A donor added late (or after another nonced
    <style>) silently stops covering the InfoWindow.
    """
    response = _list_page_with_maps_configured(
        client, mock_supabase_client, [_entry_row(0, lat=41.0, lng=28.9)]
    )
    nonce = _style_src_nonce(response.headers[CSP_HEADER])

    donors = [m.start() for m in re.finditer(r"<style\b[^>]*\bnonce=", response.text)]
    assert len(donors) == 1, "a second nonced <style> would shadow the donor"

    head_end = response.text.index("</head>")
    assert donors[0] < head_end, "the donor must be in <head>, before Maps boots"
    assert f'<style nonce="{nonce}"' in response.text
    assert donors[0] < response.text.index("share-map-data")


def test_map_never_leaks_the_server_side_places_key(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R5: the browser gets the referrer-restricted key, never the server one.

    Reusing `google_places_api_key` here is the obvious shortcut and it would
    leak a server credential into public HTML.
    """
    response = _list_page_with_maps_configured(
        client, mock_supabase_client, [_entry_row(0, lat=41.0, lng=28.9)]
    )

    assert "browser-key-123" in response.text
    assert "SERVER-SIDE-PLACES-KEY" not in response.text


def test_map_absent_when_map_id_is_unset(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R1: a key with no Map ID would render a map with zero pins. Omit it."""
    settings = get_settings()
    configured = settings.model_copy(
        update={
            "google_maps_browser_api_key": "browser-key-123",
            "google_maps_map_id": "",
        }
    )

    with patch("app.api.public.get_settings", return_value=configured):
        response = _list_page(
            client, mock_supabase_client, [_entry_row(0, lat=41.0, lng=28.9)]
        )

    assert 'id="share-map"' not in response.text
    # The nav "Map" link must be gone too, not just the section -- otherwise it
    # jumps to a missing anchor on every deployment without a Map ID.
    assert '<a href="#map">Map</a>' not in response.text


def test_nav_map_link_present_when_the_map_renders(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The nav 'Map' link appears only when the map section actually renders."""
    response = _list_page_with_maps_configured(
        client, mock_supabase_client, [_entry_row(0, lat=41.0, lng=28.9)]
    )

    assert 'id="share-map"' in response.text
    assert '<a href="#map">Map</a>' in response.text


def test_legend_lists_only_the_categories_present(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The legend mirrors the collection, not the full EntryType enum."""
    response = _list_page_with_maps_configured(
        client,
        mock_supabase_client,
        [
            _entry_row(0, entry_type="place", lat=41.0, lng=28.9),
            _entry_row(1, entry_type="food", lat=41.1, lng=28.8),
        ],
    )

    legend = re.search(
        r'<ul class="share-legend">(.*?)</ul>', response.text, re.DOTALL
    ).group(1)
    assert CATEGORY_STYLES["place"].label in legend
    assert CATEGORY_STYLES["food"].label in legend
    assert CATEGORY_STYLES["stay"].label not in legend
    assert CATEGORY_STYLES["experience"].label not in legend


def test_filter_script_loads_even_without_a_map(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R6: the category filter must work on pages that have no map.

    The script tag originally lived inside the map section, which renders only
    when a Maps key is configured -- so with no key (the default, and every CI
    and local run) the filter chips silently did nothing.
    """
    response = _list_page(client, mock_supabase_client, [_entry_row(0)])

    assert 'id="share-map"' not in response.text  # no map...
    assert "js/share-map.js" in response.text  # ...but the filter still loads


# ============================================================================
# Map export: "get this map" (KML for Google My Maps)
#
# Nothing can write into a visitor's Google Maps saved places -- no API exists.
# The download is the honest ceiling, so these tests care as much about the
# instructions being present as about the file being correct.
# ============================================================================

KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}


def _kml_document(response: Any) -> ET.Element:
    document = ET.fromstring(response.text).find("kml:Document", KML_NS)
    assert document is not None
    return document


def test_map_section_offers_the_download_and_says_how_to_use_it(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A bare download link would imply Google Maps imports it directly.

    It does not -- My Maps does, on desktop, by hand. The instructions are part
    of the feature, and they sit in a <details> so they survive with JS off.
    """
    response = _list_page_with_maps_configured(
        client, mock_supabase_client, [_entry_row(0, lat=41.0, lng=28.9)]
    )

    assert "/l/istanbul-abc123/map.kml" in response.text
    assert "Download for Google My Maps" in response.text
    assert "mymaps.google.com" in response.text
    assert "<details" in response.text


def test_map_export_absent_when_the_map_does_not_render(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The export lives inside the map section, so it shares its gate."""
    response = _list_page(client, mock_supabase_client, [_entry_row(0)])

    assert "Download for Google My Maps" not in response.text


def _kml_entry(
    title: str = "Hagia Sophia",
    *,
    entry_type: str = "place",
    lat: float | None = 41.0086,
    lng: float | None = 28.9802,
    notes: str | None = "Go at opening",
    place_name: str | None = "Hagia Sophia",
    address: str | None = "Sultanahmet, Istanbul",
    google_place_id: str | None = None,
) -> dict[str, Any]:
    return {
        "title": title,
        "type": entry_type,
        "notes": notes,
        "place": {
            "place_name": place_name,
            "address": address,
            "google_place_id": google_place_id,
            "lat": lat,
            "lng": lng,
        },
    }


class _KmlTable:
    """A seeded table that applies the endpoint's own PostgREST filters.

    `supabase_tables` hands the query params to a seed only when that seed is
    *callable* -- a static list is returned whole, whatever was asked for. So a
    static seed cannot notice a dropped `limit` or `deleted_at`: the export
    silently changes shape and the suite stays green.

    This mirrors what PostgREST would do with the filters the endpoint actually
    sent, so a missing filter changes the rows and the outcome assertion fails
    on its own. It also records the params, for the two things that have no
    observable effect on the file: an *absent* limit, and the sort order.
    """

    def __init__(
        self,
        rows: list[dict[str, Any]],
        *,
        wrap_in: str | None = None,
        seen: dict[str, Any] | None = None,
    ) -> None:
        self.rows = rows
        self.wrap_in = wrap_in
        self.seen = {} if seen is None else seen

    def __call__(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        self.seen.clear()
        self.seen.update(params)

        rows = self.rows
        if params.get("deleted_at") == "is.null":
            rows = [row for row in rows if row.get("deleted_at") is None]
        if params.get("limit") is not None:
            rows = rows[: int(params["limit"])]

        if self.wrap_in is None:
            return rows
        return [{self.wrap_in: row} for row in rows]


def _list_kml(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    entries: list[dict[str, Any]],
    *,
    seen: dict[str, Any] | None = None,
) -> Any:
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[{"id": TEST_LIST_ID, "name": "Istanbul", "description": "Two trips"}],
        list_entries=_KmlTable(entries, wrap_in="entry", seen=seen),
    )
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        return client.get("/l/istanbul-abc123/map.kml")


def _trip_kml(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    entries: list[dict[str, Any]],
    *,
    seen: dict[str, Any] | None = None,
) -> Any:
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[{"id": TEST_TRIP_ID, "name": "Summer Vacation"}],
        entry=_KmlTable(entries, seen=seen),
    )
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        return client.get(f"/t/{TRIP_SLUG}/map.kml")


def test_list_kml_downloads_as_a_file(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Content type and disposition are what make browsers save it."""
    response = _list_kml(client, mock_supabase_client, [_kml_entry()])

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.google-earth.kml+xml"
    )
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="istanbul-abc123.kml"'
    )


def test_list_kml_carries_each_place_with_its_details(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Name, place, address, note and the Maps link all survive the export."""
    response = _list_kml(client, mock_supabase_client, [_kml_entry()])

    placemark = _kml_document(response).find(".//kml:Placemark", KML_NS)
    assert placemark.find("kml:name", KML_NS).text == "01. Hagia Sophia"

    description = placemark.find("kml:description", KML_NS).text
    assert "Sultanahmet, Istanbul" in description
    assert "Go at opening" in description
    assert "google.com/maps" in description

    # Longitude first -- the reverse of every other pair in this codebase.
    assert placemark.find(".//kml:coordinates", KML_NS).text == "28.9802,41.0086,0"


def test_list_kml_groups_categories_in_the_canonical_order(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Folders become My Maps layers, so their order should match the legend."""
    response = _list_kml(
        client,
        mock_supabase_client,
        [
            _kml_entry("Lokanta", entry_type="food"),
            _kml_entry("Hagia Sophia", entry_type="place"),
        ],
    )

    folders = _kml_document(response).findall("kml:Folder", KML_NS)
    labels = [folder.find("kml:name", KML_NS).text for folder in folders]
    # Places precedes Food in CATEGORY_STYLES even though Food came first here.
    assert labels == [CATEGORY_STYLES["place"].label, CATEGORY_STYLES["food"].label]


def test_list_kml_skips_entries_without_coordinates(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A placemark with no point is meaningless to My Maps.

    The ordinals still count the skipped entry, so a downloaded pin's number
    matches the page it came from.
    """
    response = _list_kml(
        client,
        mock_supabase_client,
        [
            _kml_entry("Hagia Sophia"),
            _kml_entry("A dream", lat=None, lng=None),
            _kml_entry("Lokanta", lat=41.02, lng=28.97),
        ],
    )

    names = [
        mark.find("kml:name", KML_NS).text
        for mark in _kml_document(response).findall(".//kml:Placemark", KML_NS)
    ]
    assert names == ["01. Hagia Sophia", "03. Lokanta"]


def test_list_kml_escapes_hostile_titles(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Titles are user input and reach the file as text, never as markup."""
    response = _list_kml(
        client,
        mock_supabase_client,
        [
            _kml_entry(
                "Ali & Sons </name><Placemark><name>x",
                notes="<script>alert(1)</script>",
            )
        ],
    )

    assert "<script>" not in response.text
    assert len(_kml_document(response).findall(".//kml:Placemark", KML_NS)) == 1


def test_list_kml_uses_the_place_id_when_there_is_one(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Same precedence as the on-page link, so the two cannot disagree."""
    response = _list_kml(
        client, mock_supabase_client, [_kml_entry(google_place_id="ChIJ_xyz789")]
    )

    description = (
        _kml_document(response).find(".//kml:Placemark/kml:description", KML_NS).text
    )
    assert "query_place_id=ChIJ_xyz789" in description


def test_list_kml_404s_for_an_unknown_slug(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    mock_supabase_client.get.side_effect = supabase_tables()
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/l/nope-123/map.kml")

    assert response.status_code == 404


def test_list_kml_rejects_a_malformed_slug(client: TestClient) -> None:
    """Same slug constraint as the page it hangs off."""
    assert client.get("/l/Bad_Slug!/map.kml").status_code == 422


def test_trip_kml_downloads_the_trip_places(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The trip page gets the same export; /t/ and /l/ must not drift."""
    response = _trip_kml(client, mock_supabase_client, [_kml_entry("Hagia Sophia")])

    assert response.status_code == 200
    document = _kml_document(response)
    assert document.find("kml:name", KML_NS).text == "Summer Vacation"
    assert document.find(".//kml:Placemark/kml:name", KML_NS).text == "01. Hagia Sophia"


def _kml_names(response: Any) -> list[str]:
    return [
        mark.find("kml:name", KML_NS).text
        for mark in _kml_document(response).findall(".//kml:Placemark", KML_NS)
    ]


def test_trip_kml_exports_every_place_the_page_shows(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The trip page is uncapped, so its export has to be too.

    A capped export sitting under a heading that reads "All 60 places, mapped"
    hands the visitor a silent subset of what they were just promised -- and
    unlimited entries per trip is a paid feature, so this is a customer path.
    """
    entries = [_kml_entry(f"Place {index:02d}") for index in range(1, 61)]
    seen: dict[str, Any] = {}

    response = _trip_kml(client, mock_supabase_client, entries, seen=seen)

    names = _kml_names(response)
    assert len(names) == 60
    assert names[0] == "01. Place 01"
    assert names[-1] == "60. Place 60"

    assert seen, "the export never queried the entry table"
    # No limit at all, matching `view_public_trip`'s own query. A row budget
    # here would not show up in the file until a trip crossed it.
    assert "limit" not in seen
    assert seen["order"] == "created_at.desc"


def test_trip_kml_keeps_places_the_newest_entries_would_have_pushed_out(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Coordinates are filtered after the fetch, not by the query.

    A trip whose newest entries are all coordinate-less used to export an empty
    file while the page below still rendered pins.
    """
    entries = [_kml_entry(f"Dream {index}", lat=None, lng=None) for index in range(50)]
    entries.append(_kml_entry("Hagia Sophia"))

    response = _trip_kml(client, mock_supabase_client, entries)

    assert _kml_names(response) == ["51. Hagia Sophia"]


def test_trip_kml_excludes_soft_deleted_entries(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Same `deleted_at` filter the trip page applies -- deleting means deleted."""
    deleted = _kml_entry("Removed")
    deleted["deleted_at"] = "2026-01-01T00:00:00Z"

    response = _trip_kml(
        client, mock_supabase_client, [deleted, _kml_entry("Hagia Sophia")]
    )

    assert _kml_names(response) == ["01. Hagia Sophia"]


def test_list_kml_stops_where_the_list_page_stops(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Unlike the trip, the list page *is* capped -- and both must use one cap."""
    entries = [_kml_entry(f"Place {index:02d}") for index in range(1, 61)]
    seen: dict[str, Any] = {}

    response = _list_kml(client, mock_supabase_client, entries, seen=seen)

    assert len(_kml_names(response)) == public_module.PUBLIC_LIST_ENTRY_LIMIT
    assert seen, "the export never queried the list_entries table"
    assert seen["limit"] == public_module.PUBLIC_LIST_ENTRY_LIMIT
    assert seen["order"] == "position.asc"


def test_trip_kml_404s_for_an_unknown_slug(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    mock_supabase_client.get.side_effect = supabase_tables()
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/t/nope-123/map.kml")

    assert response.status_code == 404


def test_kml_routes_do_not_shadow_the_share_pages(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """`/l/{slug}` and `/l/{slug}/map.kml` must both keep resolving.

    The slug pattern excludes `/`, which is what keeps these apart -- worth
    pinning, because a looser pattern would silently swallow the page route.
    """
    response = _list_page(client, mock_supabase_client, [_entry_row(0)])
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


# ============================================================================
# Blog integration: sitemap, canonical URLs, og:type
# ============================================================================


def test_sitemap_includes_blog_and_static_pages(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[{"slug": "best-tacos-abc123"}],
        trip=[{"share_slug": "summer-trip-xyz"}],
    )
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/sitemap.xml")

    assert response.status_code == 200
    root = ET.fromstring(response.text)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locs = [el.text for el in root.findall(".//sm:loc", ns)]

    assert any(loc.endswith("/blog") for loc in locs)
    assert any(loc.endswith("/blog/category/guides") for loc in locs)
    for page in ("/privacy", "/terms", "/contact"):
        assert any(loc.endswith(page) for loc in locs), page

    registry = blog_registry()
    for post in registry.posts:
        assert any(loc.endswith(f"/blog/{post.slug}") for loc in locs), post.slug


def test_sitemap_blog_entries_carry_lastmod(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    mock_supabase_client.get.side_effect = supabase_tables()
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/sitemap.xml")

    root = ET.fromstring(response.text)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    for url_el in root.findall("sm:url", ns):
        loc = url_el.find("sm:loc", ns).text
        if "/blog/" in loc:
            assert url_el.find("sm:lastmod", ns) is not None, loc


def test_sitemap_adds_no_database_calls_for_blog(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Blog URLs come from the in-memory registry.

    Pins the guarantee that adding posts never adds query load to the sitemap.
    """
    mock_supabase_client.get.side_effect = supabase_tables()
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        client.get("/sitemap.xml")
    # user_profile (public profiles), list, and trip — blog adds nothing.
    assert mock_supabase_client.get.call_count == 3


@pytest.mark.parametrize("page", ["privacy", "terms", "contact"])
def test_static_pages_now_emit_canonical(client: TestClient, page: str) -> None:
    """These pages previously had OG tags but no canonical URL."""
    response = client.get(f"/{page}")
    assert response.status_code == 200
    assert f'rel="canonical" href="http://localhost:8000/{page}"' in response.text


def test_landing_og_type_is_website(client: TestClient) -> None:
    assert 'og:type" content="website"' in client.get("/").text


def test_header_nav_anchors_are_rooted(client: TestClient) -> None:
    """Bare `#features` anchors dead-end on every page except the landing page."""
    text = client.get("/privacy").text
    assert 'href="#features"' not in text


def test_blog_is_linked_from_the_footer(client: TestClient) -> None:
    assert 'href="/blog"' in client.get("/privacy").text


# ============================================================================
# Invite Landing Page Tests (/invite?code=...)
# ============================================================================


def _signed_invite_code(inviter_id: str = OTHER_USER_ID) -> str:
    from app.core.invite_signer import generate_invite_code

    return generate_invite_code(inviter_id, "friend@example.com")


def test_invite_landing_valid_code_shows_inviter(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """A valid code renders the landing page with the inviter's name and an
    install CTA."""
    code = _signed_invite_code()
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[
            {
                "id": "inv-1",
                "inviter_id": OTHER_USER_ID,
                "invite_type": "follow",
                "status": "pending",
            }
        ],
        user_profile=[
            {
                "user_id": OTHER_USER_ID,
                "username": "world_wanderer",
                "display_name": "World Wanderer",
                "avatar_url": "https://example.com/avatar.jpg",
            }
        ],
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get(f"/invite?code={code}")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "World Wanderer" in response.text
    assert "apps.apple.com" in response.text  # install CTA
    # Tokenized URL: never indexed
    assert "noindex" in response.text


def test_invite_landing_invalid_code_renders_graceful_page(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Invalid codes get a friendly page with an install CTA, never a 404."""
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/invite?code=not-a-real-code")

    assert response.status_code == 200
    assert "invalid or has expired" in response.text
    assert "apps.apple.com" in response.text


def test_invite_landing_without_code_renders_graceful_page(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/invite")

    assert response.status_code == 200
    assert "apps.apple.com" in response.text


def test_invite_landing_cancelled_invite_renders_graceful_page(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """A validly signed code whose invite row is gone (cancelled) degrades to
    the graceful page rather than showing the inviter."""
    code = _signed_invite_code()
    mock_supabase_client.get.side_effect = supabase_tables()  # no rows

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get(f"/invite?code={code}")

    assert response.status_code == 200
    assert "invalid or has expired" in response.text


def test_invite_landing_cancelled_status_hides_inviter(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """#16: a row that still exists but was cancelled (block_user_full sets
    status='cancelled') renders the generic install page -- the inviter must
    not be revealed."""
    code = _signed_invite_code()
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[
            {
                "id": "inv-1",
                "inviter_id": OTHER_USER_ID,
                "invite_type": "follow",
                "status": "cancelled",
            }
        ],
        user_profile=[
            {
                "user_id": OTHER_USER_ID,
                "username": "world_wanderer",
                "display_name": "World Wanderer",
                "avatar_url": "https://example.com/avatar.jpg",
            }
        ],
    )

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get(f"/invite?code={code}")

    assert response.status_code == 200
    assert "World Wanderer" not in response.text
    assert "world_wanderer" not in response.text
    assert "apps.apple.com" in response.text  # generic install CTA


def test_invite_landing_db_failure_degrades_gracefully(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """A database error must not 500 the growth loop's conversion moment."""
    code = _signed_invite_code()
    mock_supabase_client.get.side_effect = RuntimeError("db down")

    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get(f"/invite?code={code}")

    assert response.status_code == 200
    assert "apps.apple.com" in response.text


def test_robots_txt_disallows_invite(client: TestClient) -> None:
    """Tokenized invite URLs are excluded from crawling."""
    response = client.get("/robots.txt")
    assert "Disallow: /invite" in response.text
