"""Tests for public web page endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    TEST_ENTRY_ID,
    TEST_TRIP_ID,
    TEST_USER_ID,
    mock_auth_dependency,
)

# ============================================================================
# Landing Page Tests
# ============================================================================


def test_landing_page_returns_html(client: TestClient) -> None:
    """Test that landing page returns HTML."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Border Badge" in response.text


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
    mock_supabase_client.get.side_effect = [
        [list_with_trip],  # List by slug
        [],  # Entries (empty)
    ]

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
    mock_supabase_client.get.return_value = []

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
    mock_supabase_client.get.side_effect = [
        [list_with_trip],
        [],
    ]

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
    mock_supabase_client.get.side_effect = [
        [list_with_trip],
        entry_rows,
    ]

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
    mock_supabase_client.get.side_effect = [
        [trip_data],  # Trip by share_slug
        [],  # Entries (empty)
    ]

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
    mock_supabase_client.get.return_value = []

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
    mock_supabase_client.get.side_effect = [
        [trip_data],
        [],
    ]

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
    mock_supabase_client.get.side_effect = [
        [{"slug": "best-tacos-abc123"}, {"slug": "cool-spots-def456"}],  # public lists
        [{"share_slug": "summer-trip-xyz"}],  # public trips
    ]

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
    mock_supabase_client.get.side_effect = [
        [],  # no public lists
        [],  # no public trips
    ]

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
    mock_supabase_client.get.side_effect = [
        [trip_data],
        entry_rows,
    ]

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    assert "Golden Gate Bridge" in response.text


def test_public_list_private_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that private list (is_public=false) returns 404."""
    # The query filters by is_public=true, so an empty result means list doesn't exist or is private
    mock_supabase_client.get.return_value = []

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/l/private-list-slug")

    assert response.status_code == 404
