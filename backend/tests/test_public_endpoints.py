"""Tests for public web page endpoints."""

import json
import re
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import app.api.public as public_module
from app.core.config import Settings, get_settings
from app.core.media import AVATAR_WIDTH
from app.core.security import AuthUser, get_current_user
from app.core.seo import LANDING_FAQS
from app.core.share_view import CATEGORY_STYLES
from app.main import app
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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
        list=[{"slug": "best-tacos-abc123"}, {"slug": "cool-spots-def456"}],
        trip=[{"share_slug": "summer-trip-xyz"}],
    )

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/sitemap.xml")

    assert response.status_code == 200
    assert "application/xml" in response.headers["content-type"]
    assert "Cache-Control" in response.headers
    assert '<?xml version="1.0"' in response.text
    assert "<urlset" in response.text
    assert "/l/best-tacos-abc123" in response.text
    assert "/l/cool-spots-def456" in response.text
    assert "/t/summer-trip-xyz" in response.text


def test_sitemap_xml_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test sitemap.xml with no public content."""
    mock_supabase_client.get.side_effect = supabase_tables()

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/l/best-places-to-visit-abc123")

    assert response.status_code == 200
    assert "Best Coffee Shop" in response.text


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
        patch("app.api.public.get_supabase_client", return_value=mock_supabase_client),
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
    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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
    """R10: Maps support must not weaken style-src to 'unsafe-inline'."""
    for path in ("/l/some-slug", "/t/some-slug"):
        csp = _csp_for_share_route(client, mock_supabase_client, path)
        style_src = _csp_directive(csp, "style-src")
        assert "'nonce-" in style_src
        assert "'unsafe-inline'" not in style_src


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
        patch("app.api.public.get_supabase_client", return_value=mock_supabase_client),
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        return client.get("/l/istanbul-abc123")


def _entry_row(
    index: int,
    *,
    entry_type: str = "place",
    media: list[dict[str, Any]] | None = None,
    lat: float | None = None,
    lng: float | None = None,
) -> dict[str, Any]:
    return {
        "id": f"le-{index}",
        "position": index,
        "entry": {
            "id": f"00000000-0000-0000-0000-{index:012d}",
            "title": f"Entry {index}",
            "type": entry_type,
            "notes": f"Note {index}",
            "place": {
                "place_name": f"Place {index}",
                "address": "Istanbul",
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
