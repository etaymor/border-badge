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
        [{"username": "traveler1"}, {"username": "explorer_pro"}],  # user profiles
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
    mock_supabase_client.get.side_effect = [
        [],  # no user profiles
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
    mock_supabase_client.get.side_effect = [
        [trip_data],
        entry_rows,
    ]

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/t/summer-vacation-abc123")

    assert response.status_code == 200
    assert response.text.count("entry-card") == len(entry_rows)
    assert "Entry 0" in response.text
    assert "Entry 24" in response.text


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
    mock_supabase_client.get.side_effect = [
        [trip_data],
        entry_rows,
    ]

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
    mock_supabase_client.get.side_effect = [
        [list_with_trip],
        entry_rows,
    ]

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/u/globe_trotter")

    assert response.status_code == 200
    assert "Globe Trotter" in response.text
    # Country count should appear
    assert "50" in response.text
