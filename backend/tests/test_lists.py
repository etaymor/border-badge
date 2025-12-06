"""Tests for shareable list endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_ENTRY_ID,
    TEST_LIST_ID,
    TEST_TRIP_ID,
    TEST_USER_ID,
    mock_auth_dependency,
)

# ============================================================================
# Auth & Access Control
# ============================================================================


def test_list_trip_lists_requires_auth(client: TestClient) -> None:
    """Test that listing trip lists requires authentication."""
    response = client.get(f"/trips/{TEST_TRIP_ID}/lists")
    assert response.status_code == 403


def test_create_list_requires_auth(client: TestClient) -> None:
    """Test that creating a list requires authentication."""
    response = client.post(
        f"/trips/{TEST_TRIP_ID}/lists",
        json={"name": "Test List"},
    )
    assert response.status_code == 403


def test_create_list_requires_trip_ownership(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that non-owners cannot create lists for a trip."""
    # Return empty list for trip ownership check
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/lists",
                headers=auth_headers,
                json={"name": "Test List"},
            )
        assert response.status_code == 404
        assert "not found or not authorized" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Core CRUD Operations
# ============================================================================


def test_create_list_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_list: dict[str, Any],
    sample_entry: dict[str, Any],
    sample_list_entry: dict[str, Any],
) -> None:
    """Test creating a list with entries returns list with slug."""
    # Mock: trip ownership check, entry validation, list creation, entry creation
    mock_supabase_client.get.side_effect = [
        [sample_trip],  # Trip ownership check
        [sample_entry],  # Entry validation
    ]
    mock_supabase_client.post.side_effect = [
        [sample_list],  # List creation
        [sample_list_entry],  # List entry creation
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/lists",
                headers=auth_headers,
                json={
                    "name": "Best Places to Visit",
                    "description": "My favorite spots",
                    "entry_ids": [TEST_ENTRY_ID],
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Best Places to Visit"
        assert "slug" in data
        assert data["slug"] is not None
        assert len(data["entries"]) == 1
    finally:
        app.dependency_overrides.clear()


def test_create_list_always_public(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_entry: dict[str, Any],
    sample_list_entry: dict[str, Any],
) -> None:
    """Ensure new lists are forced to public visibility."""
    mock_supabase_client.get.side_effect = [
        [sample_trip],
        [sample_entry],
    ]
    mock_supabase_client.post.side_effect = [
        [
            {
                "id": str(TEST_LIST_ID),
                "trip_id": str(TEST_TRIP_ID),
                "owner_id": TEST_USER_ID,
                "name": "Always Public List",
                "slug": "always-public-list",
                "is_public": False,  # Simulate DB default; API should override to true
                "description": None,
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            }
        ],
        [sample_list_entry],
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/lists",
                headers=auth_headers,
                json={
                    "name": "Always Public List",
                    "entry_ids": [TEST_ENTRY_ID],
                },
            )

        assert response.status_code == 201
        # First call is to the list table, second is entries
        list_payload = mock_supabase_client.post.call_args_list[0].args[1]
        assert list_payload["is_public"] is True
        # Response should reflect public visibility regardless of DB default
        assert response.json()["is_public"] is True
    finally:
        app.dependency_overrides.clear()


def test_get_list_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_list: dict[str, Any],
    sample_list_entry: dict[str, Any],
) -> None:
    """Test getting a list returns list with entries."""
    mock_supabase_client.get.side_effect = [
        [sample_list],  # List fetch
        [sample_list_entry],  # Entries fetch
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/lists/{TEST_LIST_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Best Places to Visit"
        assert data["slug"] == "best-places-to-visit-abc123"
        assert len(data["entries"]) == 1
    finally:
        app.dependency_overrides.clear()


def test_update_list_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_list: dict[str, Any],
) -> None:
    """Test owner can update list name and description."""
    updated_list = {**sample_list, "name": "Updated List Name"}
    mock_supabase_client.patch.return_value = [updated_list]
    mock_supabase_client.get.return_value = []  # No entries

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/lists/{TEST_LIST_ID}",
                headers=auth_headers,
                json={"name": "Updated List Name"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated List Name"
    finally:
        app.dependency_overrides.clear()


def test_delete_list_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test owner can soft-delete a list."""
    # Soft delete uses patch, not delete
    mock_supabase_client.patch.return_value = [
        {
            "id": str(TEST_LIST_ID),
            "trip_id": str(TEST_TRIP_ID),
            "owner_id": TEST_USER_ID,
            "name": "Test List",
            "slug": "test-list",
            "is_public": True,
            "created_at": "2024-01-01T00:00:00+00:00",
            "updated_at": "2024-01-01T00:00:00+00:00",
            "deleted_at": "2024-01-01T00:00:00+00:00",
        }
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                f"/lists/{TEST_LIST_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Entry Validation
# ============================================================================


def test_create_list_rejects_invalid_entry_ids(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
) -> None:
    """Test that creating a list with invalid entry IDs returns 400."""
    invalid_entry_id = "550e8400-e29b-41d4-a716-446655440999"

    # Mock: trip ownership succeeds, but entry validation returns empty
    mock_supabase_client.get.side_effect = [
        [sample_trip],  # Trip ownership check
        [],  # Entry validation - no valid entries found
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/lists",
                headers=auth_headers,
                json={
                    "name": "Test List",
                    "entry_ids": [invalid_entry_id],
                },
            )
        assert response.status_code == 400
        assert "Invalid entry IDs" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Public Access
# ============================================================================


def test_get_public_list_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_list: dict[str, Any],
) -> None:
    """Test public list is accessible by slug without auth."""
    # Add trip data for the public view
    list_with_trip = {
        **sample_list,
        "trip": {"name": "Summer Vacation", "country": {"name": "United States"}},
    }
    mock_supabase_client.get.side_effect = [
        [list_with_trip],  # List by slug
        [],  # Entries (empty for simplicity)
    ]

    # No auth override - this is a public endpoint
    with patch("app.api.lists.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/public/lists/best-places-to-visit-abc123")

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Best Places to Visit"
    assert data["slug"] == "best-places-to-visit-abc123"
    assert data["trip_name"] == "Summer Vacation"


def test_get_public_list_not_found_when_private(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that private lists return 404 on public endpoint."""
    # Return empty list (simulating either not found or is_public=false filter)
    mock_supabase_client.get.return_value = []

    with patch("app.api.lists.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/public/lists/nonexistent-slug")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# ============================================================================
# Authorization & Validation
# ============================================================================


def test_get_list_unauthorized_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    auth_headers: dict[str, str],
) -> None:
    """Test that non-owner cannot view private list."""
    # Create a mock user different from the list owner
    other_user = AuthUser(
        user_id=OTHER_USER_ID,
        email="other@example.com",
    )
    # Private list owned by someone else
    private_list = {
        "id": TEST_LIST_ID,
        "trip_id": TEST_TRIP_ID,
        "owner_id": TEST_USER_ID,  # Different from other_user
        "name": "Private List",
        "slug": "private-list-123",
        "description": None,
        "is_public": False,  # Private
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_supabase_client.get.return_value = [private_list]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(other_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/lists/{TEST_LIST_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()


def test_get_public_list_invalid_slug_returns_422(
    client: TestClient,
) -> None:
    """Test that invalid slug format returns 422."""
    # Invalid slugs: uppercase, spaces, special characters
    invalid_slugs = [
        "UPPERCASE",
        "has spaces",
        "special@chars!",
        "under_score",
    ]
    for slug in invalid_slugs:
        response = client.get(f"/public/lists/{slug}")
        assert response.status_code == 422, f"Expected 422 for slug: {slug}"


# ============================================================================
# Bulk Insert Behavior
# ============================================================================


def test_create_list_rollback_on_entry_insert_failure(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trip: dict[str, Any],
    sample_list: dict[str, Any],
    sample_entry: dict[str, Any],
) -> None:
    """Test that list is rolled back when bulk entry insert fails."""
    # Mock: trip ownership check, entry validation success
    mock_supabase_client.get.side_effect = [
        [sample_trip],  # Trip ownership check
        [sample_entry],  # Entry validation
    ]
    # Mock: list created, but entry insert returns partial (failure)
    mock_supabase_client.post.side_effect = [
        [sample_list],  # List creation succeeds
        [],  # Entry bulk insert fails (returns empty)
    ]
    mock_supabase_client.delete.return_value = []  # Rollback delete

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/lists",
                headers=auth_headers,
                json={
                    "name": "Test List",
                    "entry_ids": [TEST_ENTRY_ID],
                },
            )
        assert response.status_code == 500
        assert "Failed to add all entries" in response.json()["detail"]
        # Verify rollback was attempted
        mock_supabase_client.delete.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_update_list_entries_fails_on_partial_insert(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_list: dict[str, Any],
    sample_entry: dict[str, Any],
) -> None:
    """Test that update_list_entries fails when bulk insert is partial."""
    # Mock: ownership check succeeds, entry validation succeeds, no existing entries
    mock_supabase_client.get.side_effect = [
        [sample_list],  # List ownership check
        [sample_entry],  # Entry validation
        [],  # Existing entries fetch (empty - no existing entries)
    ]
    mock_supabase_client.post.return_value = []  # Bulk insert fails (returns empty)

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.put(
                f"/lists/{TEST_LIST_ID}/entries",
                headers=auth_headers,
                json={"entry_ids": [TEST_ENTRY_ID]},
            )
        assert response.status_code == 500
        assert "Failed to add new entries" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Not Found and Restore Tests
# ============================================================================


def test_get_list_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a list that doesn't exist returns 404."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/lists/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_update_list_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating a list that doesn't exist returns 404."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/lists/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
                json={"name": "New Name"},
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_delete_list_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting a list that doesn't exist returns 404."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/lists/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_restore_list(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_list: dict[str, Any],
) -> None:
    """Test restoring a soft-deleted list."""
    restored_list = {**sample_list, "deleted_at": None}

    mock_supabase_client.patch.return_value = [restored_list]
    mock_supabase_client.get.return_value = []  # No entries

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/lists/{TEST_LIST_ID}/restore",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(TEST_LIST_ID)
    finally:
        app.dependency_overrides.clear()


def test_restore_list_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test restoring a list that doesn't exist returns 404."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.lists.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/lists/550e8400-e29b-41d4-a716-446655440999/restore",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()
