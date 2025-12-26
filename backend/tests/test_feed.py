"""Tests for activity feed endpoints."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_USER_ID,
    mock_auth_dependency,
)


# Sample feed data for tests - must match the expected database row format
def make_feed_row(
    activity_type: str = "country_visited",
    country_code: str = "US",
    country_name: str = "United States",
    country_id: str = "country-id-us",
    entry_id: str | None = None,
    entry_name: str | None = None,
    entry_type: str | None = None,
    location_name: str | None = None,
    entry_image_url: str | None = None,
) -> dict:
    """Create a sample feed row matching the database function output."""
    return {
        "user_id": OTHER_USER_ID,
        "username": "traveler",
        "avatar_url": None,
        "activity_type": activity_type,
        "created_at": "2024-01-01T12:00:00Z",
        "country_id": country_id,
        "country_code": country_code,
        "country_name": country_name,
        "entry_id": entry_id,
        "entry_name": entry_name,
        "entry_type": entry_type,
        "location_name": location_name,
        "entry_image_url": entry_image_url,
    }


# ============================================================================
# Main Feed Tests
# ============================================================================


def test_get_feed_requires_auth(client: TestClient) -> None:
    """Test that getting the feed requires authentication."""
    response = client.get("/feed")
    assert response.status_code == 403


def test_get_feed_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully getting the activity feed."""
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row(
            "entry_added",
            entry_id="entry-123",
            entry_name="Central Park",
            entry_type="place",
        ),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "has_more" in data
        assert len(data["items"]) == 2
        assert data["items"][0]["activity_type"] == "country_visited"
    finally:
        app.dependency_overrides.clear()


def test_get_feed_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting feed when no items exist."""
    mock_supabase_client.rpc.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["has_more"] is False
    finally:
        app.dependency_overrides.clear()


def test_get_feed_with_pagination(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting feed with pagination parameters."""
    # Return one more than limit to indicate has_more
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/feed?limit=2&before=2024-01-01T00:00:00Z", headers=auth_headers
            )
        assert response.status_code == 200
        data = response.json()
        # Should return limit items and set has_more
        assert len(data["items"]) == 2
        assert data["has_more"] is True
    finally:
        app.dependency_overrides.clear()


def test_get_feed_includes_user_info(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that feed items include user profile information."""
    mock_supabase_client.rpc.return_value = [make_feed_row()]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        item = data["items"][0]
        assert "user" in item
        assert item["user"]["username"] == "traveler"
        assert item["user"]["user_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_get_feed_includes_country_info(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that feed items include country information."""
    mock_supabase_client.rpc.return_value = [make_feed_row()]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        item = data["items"][0]
        assert "country" in item
        assert item["country"]["country_code"] == "US"
        assert item["country"]["country_name"] == "United States"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# User Feed Tests
# ============================================================================


def test_get_user_feed_requires_auth(client: TestClient) -> None:
    """Test that getting a user's feed requires authentication."""
    response = client.get(f"/feed/user/{OTHER_USER_ID}")
    assert response.status_code == 403


def test_get_user_feed_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully getting a specific user's activity feed."""
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row(
            "entry_added",
            entry_id="entry-123",
            entry_name="Louvre",
            entry_type="place",
        ),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/feed/user/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert len(data["items"]) == 2
    finally:
        app.dependency_overrides.clear()


def test_get_user_feed_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a user's feed when they have no activity."""
    mock_supabase_client.rpc.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/feed/user/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["has_more"] is False
    finally:
        app.dependency_overrides.clear()


def test_get_own_user_feed(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting your own activity feed."""
    # Replace user_id in the feed row with the current user's ID
    row = make_feed_row("country_visited")
    row["user_id"] = TEST_USER_ID

    mock_supabase_client.rpc.return_value = [row]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/feed/user/{TEST_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Feed Item Types Tests
# ============================================================================


def test_feed_country_visited_activity(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test feed item for country visited activity."""
    mock_supabase_client.rpc.return_value = [make_feed_row("country_visited")]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["activity_type"] == "country_visited"
        assert item["entry"] is None
        assert item["country"] is not None
    finally:
        app.dependency_overrides.clear()


def test_feed_entry_added_activity(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test feed item for entry added activity."""
    row = make_feed_row(
        "entry_added",
        entry_id="entry-123",
        entry_name="Eiffel Tower",
        entry_type="place",
        location_name="Paris, France",
        entry_image_url="https://example.com/photo.jpg",
    )

    mock_supabase_client.rpc.return_value = [row]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["activity_type"] == "entry_added"
        assert item["entry"] is not None
        assert item["entry"]["entry_type"] == "place"
        assert item["entry"]["entry_name"] == "Eiffel Tower"
        assert item["entry"]["image_url"] == "https://example.com/photo.jpg"
    finally:
        app.dependency_overrides.clear()


def test_get_user_feed_with_pagination(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test user feed returns next_cursor when has_more is true."""
    # Return one more than limit to indicate has_more
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/feed/user/{OTHER_USER_ID}?limit=2", headers=auth_headers
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["has_more"] is True
        assert data["next_cursor"] is not None
    finally:
        app.dependency_overrides.clear()
