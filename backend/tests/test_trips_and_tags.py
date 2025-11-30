"""Tests for trip and trip_tags endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import mock_auth_dependency


def test_list_trips_requires_auth(client: TestClient) -> None:
    """Test that listing trips requires authentication."""
    response = client.get("/trips")
    assert response.status_code == 403


def test_list_trips_returns_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test listing trips returns empty list when none exist."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.get("/trips", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_list_trips_returns_trips(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test listing trips returns user's trips."""
    mock_supabase_client.get.return_value = [sample_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.get("/trips", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Summer Vacation"
    finally:
        app.dependency_overrides.clear()


def test_create_trip(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test creating a new trip."""
    mock_supabase_client.post.return_value = [sample_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.post(
                "/trips",
                headers=auth_headers,
                json={
                    "name": "Summer Vacation",
                    "country_id": "550e8400-e29b-41d4-a716-446655440001",
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Summer Vacation"
        assert "tags" in data
    finally:
        app.dependency_overrides.clear()


def test_create_trip_with_tags(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test creating a trip with tagged users."""
    from tests.conftest import OTHER_USER_ID, TEST_COUNTRY_ID, TEST_TAG_ID

    tag_data = {
        "id": TEST_TAG_ID,
        "trip_id": sample_trip["id"],
        "tagged_user_id": OTHER_USER_ID,
        "status": "pending",
        "initiated_by": mock_user.id,
        "notification_id": None,
        "created_at": "2024-01-01T00:00:00Z",
        "responded_at": None,
    }

    mock_supabase_client.post.side_effect = [[sample_trip], [tag_data]]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.post(
                "/trips",
                headers=auth_headers,
                json={
                    "name": "Summer Vacation",
                    "country_id": TEST_COUNTRY_ID,
                    "tagged_user_ids": [OTHER_USER_ID],
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert len(data["tags"]) == 1
        assert data["tags"][0]["status"] == "pending"
    finally:
        app.dependency_overrides.clear()


def test_get_trip(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test getting a single trip."""
    mock_supabase_client.get.side_effect = [[sample_trip], []]  # trip, then tags

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.get(f"/trips/{sample_trip['id']}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Summer Vacation"
    finally:
        app.dependency_overrides.clear()


def test_get_trip_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a trip that doesn't exist."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.get(
                "/trips/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_approve_trip_tag(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test approving a trip tag."""
    trip_id = "550e8400-e29b-41d4-a716-446655440002"
    tag = {
        "id": "tag-id-123",
        "trip_id": trip_id,
        "tagged_user_id": mock_user.id,
        "status": "pending",
        "responded_at": None,
    }
    updated_tag = {**tag, "status": "approved", "responded_at": "2024-01-01T00:00:00Z"}

    mock_supabase_client.get.return_value = [tag]
    mock_supabase_client.patch.return_value = [updated_tag]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.post(f"/trips/{trip_id}/approve", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "approved"
    finally:
        app.dependency_overrides.clear()


def test_decline_trip_tag(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test declining a trip tag."""
    trip_id = "550e8400-e29b-41d4-a716-446655440002"
    tag = {
        "id": "tag-id-123",
        "trip_id": trip_id,
        "tagged_user_id": mock_user.id,
        "status": "pending",
        "responded_at": None,
    }
    updated_tag = {**tag, "status": "declined", "responded_at": "2024-01-01T00:00:00Z"}

    mock_supabase_client.get.return_value = [tag]
    mock_supabase_client.patch.return_value = [updated_tag]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.post(f"/trips/{trip_id}/decline", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "declined"
    finally:
        app.dependency_overrides.clear()


def test_approve_already_actioned_tag_returns_409(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that approving an already actioned tag returns 409."""
    trip_id = "550e8400-e29b-41d4-a716-446655440002"
    tag = {
        "id": "tag-id-123",
        "trip_id": trip_id,
        "tagged_user_id": mock_user.id,
        "status": "approved",  # Already approved
        "responded_at": "2024-01-01T00:00:00Z",
    }

    mock_supabase_client.get.return_value = [tag]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.trips.get_supabase_client", return_value=mock_supabase_client):
            response = client.post(f"/trips/{trip_id}/approve", headers=auth_headers)
        assert response.status_code == 409
    finally:
        app.dependency_overrides.clear()
