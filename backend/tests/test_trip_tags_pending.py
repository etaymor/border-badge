"""Tests for GET /trip-tags/pending endpoint."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_TAG_ID,
    TEST_TRIP_ID,
    mock_auth_dependency,
)


def test_pending_trip_tags_requires_auth(client: TestClient) -> None:
    """Test that GET /trip-tags/pending requires authentication."""
    response = client.get("/trip-tags/pending")
    assert response.status_code == 403


def test_pending_trip_tags_returns_empty_list(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that GET /trip-tags/pending returns empty list when no pending tags."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trip_tags.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trip-tags/pending", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_pending_trip_tags_returns_tags_for_user(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that GET /trip-tags/pending returns pending tags with trip and initiator details."""
    # Mock the database response - first call gets tags with trip data,
    # second call fetches initiator profiles separately
    pending_tag_with_trip = {
        "id": TEST_TAG_ID,
        "trip_id": TEST_TRIP_ID,
        "initiated_by": OTHER_USER_ID,
        "created_at": "2024-01-01T00:00:00Z",
        "trip": {
            "name": "Summer Vacation",
            "country": {"code": "US"},
        },
    }
    initiator_profile = {
        "user_id": OTHER_USER_ID,
        "username": "traveler_jane",
        "avatar_url": "https://example.com/avatar.jpg",
    }
    # First call returns tags, second call returns initiator profiles
    mock_supabase_client.get.side_effect = [
        [pending_tag_with_trip],
        [initiator_profile],
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trip_tags.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trip-tags/pending", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1

        # Verify response structure
        tag = data[0]
        assert tag["id"] == TEST_TAG_ID
        assert tag["trip_id"] == TEST_TRIP_ID
        assert tag["trip_name"] == "Summer Vacation"
        assert tag["trip_country_code"] == "US"
        assert tag["initiated_by"] == OTHER_USER_ID
        assert tag["initiated_by_username"] == "traveler_jane"
        assert tag["initiated_by_avatar_url"] == "https://example.com/avatar.jpg"
        assert tag["created_at"] == "2024-01-01T00:00:00Z"
    finally:
        app.dependency_overrides.clear()


def test_pending_trip_tags_handles_missing_initiator(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that GET /trip-tags/pending handles missing initiator gracefully."""
    # Mock tag where initiator is None (e.g., user deleted)
    pending_tag_no_initiator = {
        "id": TEST_TAG_ID,
        "trip_id": TEST_TRIP_ID,
        "initiated_by": None,
        "created_at": "2024-01-01T00:00:00Z",
        "trip": {
            "name": "Beach Trip",
            "country": {"code": "MX"},
        },
        "initiator": None,
    }
    mock_supabase_client.get.return_value = [pending_tag_no_initiator]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trip_tags.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trip-tags/pending", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1

        tag = data[0]
        assert tag["trip_name"] == "Beach Trip"
        assert tag["trip_country_code"] == "MX"
        assert tag["initiated_by"] is None
        assert tag["initiated_by_username"] is None
        assert tag["initiated_by_avatar_url"] is None
    finally:
        app.dependency_overrides.clear()


def test_pending_trip_tags_respects_pagination(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that GET /trip-tags/pending respects limit and offset parameters."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trip_tags.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/trip-tags/pending?limit=10&offset=5", headers=auth_headers
            )
        assert response.status_code == 200

        # Verify the query was called with correct pagination params
        # The params dict is the second positional argument to db.get(table, params)
        call_args = mock_supabase_client.get.call_args
        params = call_args[0][1]  # Second positional arg is the params dict
        assert params["limit"] == 10
        assert params["offset"] == 5
    finally:
        app.dependency_overrides.clear()
