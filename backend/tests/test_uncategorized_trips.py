"""Tests for uncategorized trip (Saved Places) and entry move endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    TEST_ENTRY_ID,
    TEST_TRIP_ID,
    mock_auth_dependency,
)

# ============================================================================
# GET /trips/uncategorized Tests
# ============================================================================


def test_get_uncategorized_trip_requires_auth(client: TestClient) -> None:
    """Test that getting uncategorized trip requires authentication."""
    response = client.get("/trips/uncategorized")
    assert response.status_code == 403


def test_get_uncategorized_trip_creates_if_not_exists(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_uncategorized_trip: dict[str, Any],
) -> None:
    """Test that GET /trips/uncategorized creates trip via RPC if doesn't exist."""
    # RPC returns the newly created trip with entry_count=0
    mock_supabase_client.rpc.return_value = [sample_uncategorized_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trips/uncategorized", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Saved Places"
        assert data["is_system"] is True
        assert data["country_code"] is None
        assert data["entry_count"] == 0

        # Verify RPC was called
        mock_supabase_client.rpc.assert_called_once_with(
            "get_or_create_uncategorized_trip"
        )
    finally:
        app.dependency_overrides.clear()


def test_get_uncategorized_trip_returns_existing_with_entry_count(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_uncategorized_trip: dict[str, Any],
) -> None:
    """Test that GET /trips/uncategorized returns existing trip with entry count."""
    # Existing trip with 5 entries
    trip_with_entries = {**sample_uncategorized_trip, "entry_count": 5}
    mock_supabase_client.rpc.return_value = [trip_with_entries]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trips/uncategorized", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["entry_count"] == 5
    finally:
        app.dependency_overrides.clear()


def test_get_uncategorized_trip_rpc_failure_returns_500(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that RPC failure returns 500 error."""
    # RPC returns empty result
    mock_supabase_client.rpc.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trips/uncategorized", headers=auth_headers)

        assert response.status_code == 500
        assert "Failed to get or create" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# PATCH /entries/{id}/move Tests
# ============================================================================


def test_move_entry_requires_auth(client: TestClient) -> None:
    """Test that moving entry requires authentication."""
    response = client.patch(
        f"/entries/{TEST_ENTRY_ID}/move",
        json={"trip_id": TEST_TRIP_ID},
    )
    assert response.status_code == 403


def test_move_entry_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
    sample_place: dict[str, Any],
) -> None:
    """Test successfully moving an entry to a different trip."""
    # Entry after moving to new trip
    moved_entry = {**sample_entry, "trip_id": TEST_TRIP_ID}

    # RPC returns both entry and place
    mock_supabase_client.rpc.return_value = [
        {"entry_row": moved_entry, "place_row": sample_place}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}/move",
                headers=auth_headers,
                json={"trip_id": TEST_TRIP_ID},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["trip_id"] == TEST_TRIP_ID
        assert data["place"]["place_name"] == "Central Park"

        # Verify RPC was called with correct params
        mock_supabase_client.rpc.assert_called_once_with(
            "move_entry_to_trip",
            {"p_entry_id": str(sample_entry["id"]), "p_target_trip_id": TEST_TRIP_ID},
        )
    finally:
        app.dependency_overrides.clear()


def test_move_entry_without_place(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Test moving an entry that has no associated place."""
    moved_entry = {**sample_entry, "trip_id": TEST_TRIP_ID}

    # RPC returns entry but no place
    mock_supabase_client.rpc.return_value = [
        {"entry_row": moved_entry, "place_row": None}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}/move",
                headers=auth_headers,
                json={"trip_id": TEST_TRIP_ID},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["place"] is None
    finally:
        app.dependency_overrides.clear()


def test_move_entry_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test moving a non-existent entry returns 404."""
    # RPC returns empty result when entry not found
    mock_supabase_client.rpc.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/entries/550e8400-e29b-41d4-a716-446655440999/move",
                headers=auth_headers,
                json={"trip_id": TEST_TRIP_ID},
            )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# POST /entries/bulk-move Tests
# ============================================================================


def test_bulk_move_entries_requires_auth(client: TestClient) -> None:
    """Test that bulk move requires authentication."""
    response = client.post(
        "/entries/bulk-move",
        json={"entry_ids": [TEST_ENTRY_ID], "target_trip_id": TEST_TRIP_ID},
    )
    assert response.status_code == 403


def test_bulk_move_entries_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Test successfully bulk moving entries."""
    entry1 = {**sample_entry, "id": "550e8400-e29b-41d4-a716-446655440020"}
    entry2 = {**sample_entry, "id": "550e8400-e29b-41d4-a716-446655440021"}
    moved_entries = [
        {**entry1, "trip_id": TEST_TRIP_ID},
        {**entry2, "trip_id": TEST_TRIP_ID},
    ]

    # RPC returns moved count and entries
    mock_supabase_client.rpc.return_value = [
        {"moved_count": 2, "entries": moved_entries}
    ]
    # get for fetching places
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/entries/bulk-move",
                headers=auth_headers,
                json={
                    "entry_ids": [entry1["id"], entry2["id"]],
                    "target_trip_id": TEST_TRIP_ID,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["moved_count"] == 2
        assert len(data["entries"]) == 2

        # Verify RPC was called with correct params
        mock_supabase_client.rpc.assert_called_once_with(
            "bulk_move_entries_to_trip",
            {
                "p_entry_ids": [entry1["id"], entry2["id"]],
                "p_target_trip_id": TEST_TRIP_ID,
            },
        )
    finally:
        app.dependency_overrides.clear()


def test_bulk_move_entries_with_places(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
    sample_place: dict[str, Any],
) -> None:
    """Test bulk move returns entries with their places."""
    entry1_id = "550e8400-e29b-41d4-a716-446655440020"
    entry1 = {**sample_entry, "id": entry1_id, "trip_id": TEST_TRIP_ID}
    place1 = {**sample_place, "entry_id": entry1_id}

    mock_supabase_client.rpc.return_value = [{"moved_count": 1, "entries": [entry1]}]
    # First get call for entry1's place
    mock_supabase_client.get.return_value = [place1]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/entries/bulk-move",
                headers=auth_headers,
                json={
                    "entry_ids": [entry1_id],
                    "target_trip_id": TEST_TRIP_ID,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["entries"][0]["place"]["place_name"] == "Central Park"
    finally:
        app.dependency_overrides.clear()


def test_bulk_move_rpc_failure_returns_500(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that RPC failure returns 500 error."""
    mock_supabase_client.rpc.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/entries/bulk-move",
                headers=auth_headers,
                json={
                    "entry_ids": [TEST_ENTRY_ID],
                    "target_trip_id": TEST_TRIP_ID,
                },
            )

        assert response.status_code == 500
        assert "Failed to move" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# GET /trips?include_system Tests
# ============================================================================


def test_list_trips_excludes_system_by_default(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test that system trips are excluded by default."""
    trip_with_country = {**sample_trip, "country": {"code": "US"}}
    mock_supabase_client.get.return_value = [trip_with_country]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trips", headers=auth_headers)

        assert response.status_code == 200

        # Verify is_system=eq.false was in the query params
        # Call is db.get("trip", params) so params is args[1]
        call_args = mock_supabase_client.get.call_args
        params = call_args[0][1]  # Positional args: ("trip", params)
        assert params["is_system"] == "eq.false"
    finally:
        app.dependency_overrides.clear()


def test_list_trips_includes_system_when_requested(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_uncategorized_trip: dict[str, Any],
) -> None:
    """Test that system trips can be included with include_system=true."""
    trip_with_country = {**sample_trip, "country": {"code": "US"}}
    system_trip = {**sample_uncategorized_trip, "country": None}
    mock_supabase_client.get.return_value = [trip_with_country, system_trip]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/trips?include_system=true", headers=auth_headers)

        assert response.status_code == 200

        # Verify is_system filter was NOT applied
        # Call is db.get("trip", params) so params is args[1]
        call_args = mock_supabase_client.get.call_args
        params = call_args[0][1]  # Positional args: ("trip", params)
        assert "is_system" not in params
    finally:
        app.dependency_overrides.clear()
