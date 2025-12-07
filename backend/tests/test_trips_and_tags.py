"""Tests for trip and trip_tags endpoints."""

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.api.trips import format_daterange
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
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trips", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_format_daterange_none_when_no_bounds() -> None:
    """Helper returns None when both bounds are missing."""
    assert format_daterange(None, None) is None


def test_format_daterange_full_range() -> None:
    """Helper formats full bounded ranges correctly."""
    start = date(2024, 6, 1)
    end = date(2024, 6, 15)
    assert format_daterange(start, end) == "[2024-06-01,2024-06-15]"


def test_format_daterange_open_start() -> None:
    """Helper formats ranges with only an end date using -infinity."""
    end = date(2024, 6, 15)
    assert format_daterange(None, end) == "[-infinity,2024-06-15]"


def test_format_daterange_open_end() -> None:
    """Helper formats ranges with only a start date using infinity."""
    start = date(2024, 6, 1)
    assert format_daterange(start, None) == "[2024-06-01,infinity]"


def test_list_trips_returns_trips(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test listing trips returns user's trips."""
    # Trip now includes nested country from JOIN
    trip_with_country = {**sample_trip, "country": {"code": "US"}}
    mock_supabase_client.get.return_value = [trip_with_country]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trips", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Summer Vacation"
        assert data[0]["country_code"] == "US"
    finally:
        app.dependency_overrides.clear()


def test_create_trip(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test creating a new trip."""
    # First call is for country lookup, second is checking existing names
    mock_supabase_client.get.side_effect = [[sample_country], []]
    mock_supabase_client.post.return_value = [sample_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/trips",
                headers=auth_headers,
                json={
                    "name": "Summer Vacation",
                    "country_code": "US",
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Summer Vacation"
        assert data["country_code"] == "US"
        assert "tags" in data
    finally:
        app.dependency_overrides.clear()


def test_create_trip_with_tags(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test creating a trip with tagged users."""
    from tests.conftest import OTHER_USER_ID, TEST_TAG_ID

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

    # First get is for country lookup, second is for checking existing names
    mock_supabase_client.get.side_effect = [[sample_country], []]
    mock_supabase_client.post.side_effect = [[sample_trip], [tag_data]]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/trips",
                headers=auth_headers,
                json={
                    "name": "Summer Vacation",
                    "country_code": "US",
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
    sample_country: dict[str, Any],
) -> None:
    """Test getting a single trip."""
    # Trip now includes nested country from JOIN, then tags
    trip_with_country = {**sample_trip, "country": {"code": "US"}}
    mock_supabase_client.get.side_effect = [[trip_with_country], []]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/trips/{sample_trip['id']}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Summer Vacation"
        assert data["country_code"] == "US"
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
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
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
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
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
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
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
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/trips/{trip_id}/approve", headers=auth_headers)
        assert response.status_code == 409
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Duplicate Trip Name Tests
# ============================================================================


def test_create_trip_with_duplicate_name_appends_suffix(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test that creating a trip with a duplicate name appends (2) suffix."""
    # Existing trip with same name
    existing_trip = {**sample_trip, "name": "Summer Vacation"}
    # New trip should get (2) suffix
    new_trip = {**sample_trip, "name": "Summer Vacation (2)"}

    # First get is for country lookup, second is for checking existing names
    mock_supabase_client.get.side_effect = [[sample_country], [existing_trip]]
    mock_supabase_client.post.return_value = [new_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/trips",
                headers=auth_headers,
                json={
                    "name": "Summer Vacation",
                    "country_code": "US",
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Summer Vacation (2)"
    finally:
        app.dependency_overrides.clear()


def test_create_trip_with_multiple_duplicates_increments_suffix(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test that creating a trip finds the next available suffix."""
    # Existing trips with name and (2) suffix
    existing_trips = [
        {**sample_trip, "name": "Summer Vacation"},
        {**sample_trip, "name": "Summer Vacation (2)"},
    ]
    # New trip should get (3) suffix
    new_trip = {**sample_trip, "name": "Summer Vacation (3)"}

    # First get is for country lookup, second is for checking existing names
    mock_supabase_client.get.side_effect = [[sample_country], existing_trips]
    mock_supabase_client.post.return_value = [new_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/trips",
                headers=auth_headers,
                json={
                    "name": "Summer Vacation",
                    "country_code": "US",
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Summer Vacation (3)"
    finally:
        app.dependency_overrides.clear()


def test_create_trip_strips_existing_suffix_before_checking(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test that creating a trip with "(2)" in name normalizes correctly."""
    # User submits "Summer Vacation (2)" but "Summer Vacation" exists
    existing_trip = {**sample_trip, "name": "Summer Vacation"}
    # Should get (2) suffix since base name exists
    new_trip = {**sample_trip, "name": "Summer Vacation (2)"}

    # First get is for country lookup, second is for checking existing names
    mock_supabase_client.get.side_effect = [[sample_country], [existing_trip]]
    mock_supabase_client.post.return_value = [new_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/trips",
                headers=auth_headers,
                json={
                    "name": "Summer Vacation (2)",  # User explicitly adds (2)
                    "country_code": "US",
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Summer Vacation (2)"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Update Trip Tests
# ============================================================================


def test_update_trip(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test updating a trip."""
    # Patch now returns trip with nested country from JOIN
    updated_trip = {**sample_trip, "name": "Winter Getaway", "country": {"code": "US"}}

    mock_supabase_client.patch.return_value = [updated_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/trips/{sample_trip['id']}",
                headers=auth_headers,
                json={"name": "Winter Getaway"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Winter Getaway"
        assert data["country_code"] == "US"
    finally:
        app.dependency_overrides.clear()


def test_update_trip_with_dates(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test updating a trip with date range."""
    # Patch now returns trip with nested country from JOIN
    updated_trip = {
        **sample_trip,
        "date_range": "[2024-07-01,2024-07-15]",
        "country": {"code": "US"},
    }

    # for fetching existing date_range (no longer needs country lookup)
    mock_supabase_client.get.return_value = [sample_trip]
    mock_supabase_client.patch.return_value = [updated_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/trips/{sample_trip['id']}",
                headers=auth_headers,
                json={
                    "date_start": "2024-07-01",
                    "date_end": "2024-07-15",
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["date_range"] == "[2024-07-01,2024-07-15]"
        assert data["country_code"] == "US"
    finally:
        app.dependency_overrides.clear()


def test_update_trip_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating a trip that doesn't exist returns 404."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/trips/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
                json={"name": "New Name"},
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_update_trip_no_fields_returns_400(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test updating a trip with no fields returns 400."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/trips/{sample_trip['id']}",
                headers=auth_headers,
                json={},
            )
        assert response.status_code == 400
        assert "No fields to update" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Delete and Restore Trip Tests
# ============================================================================


def test_delete_trip(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test soft-deleting a trip."""
    deleted_trip = {**sample_trip, "deleted_at": "2024-01-15T12:00:00Z"}

    mock_supabase_client.patch.return_value = [deleted_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                f"/trips/{sample_trip['id']}",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_delete_trip_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting a trip that doesn't exist returns 404."""
    # RPC soft_delete_trip returns False when trip not found or not authorized
    mock_supabase_client.rpc.return_value = False

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/trips/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_restore_trip(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_country: dict[str, Any],
) -> None:
    """Test restoring a soft-deleted trip."""
    # Patch now returns trip with nested country from JOIN
    restored_trip = {**sample_trip, "deleted_at": None, "country": {"code": "US"}}

    mock_supabase_client.patch.return_value = [restored_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{sample_trip['id']}/restore",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == sample_trip["id"]
        assert data["country_code"] == "US"
    finally:
        app.dependency_overrides.clear()


def test_restore_trip_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test restoring a trip that doesn't exist returns 404."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/trips/550e8400-e29b-41d4-a716-446655440999/restore",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_format_daterange_invalid_range_raises_error(client: TestClient) -> None:
    """Test that start date after end date raises HTTPException."""
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        format_daterange(date(2024, 6, 15), date(2024, 6, 1))  # end before start

    assert exc_info.value.status_code == 400
    assert "date_start must be on or before date_end" in exc_info.value.detail
