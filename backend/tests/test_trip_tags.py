"""Tests for trip tag creation, block enforcement, and consent withdrawal."""

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

SAMPLE_TAG_ROW = {
    "id": TEST_TAG_ID,
    "trip_id": TEST_TRIP_ID,
    "tagged_user_id": OTHER_USER_ID,
    "status": "pending",
    "initiated_by": None,
    "notification_id": None,
    "created_at": "2024-01-01T00:00:00Z",
    "responded_at": None,
}


# ============================================================================
# Tag creation (POST /trip-tags/{trip_id}/tags/{tagged_user_id})
# ============================================================================


def test_add_trip_tag_notifies_after_successful_insert(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Tag creation inserts first; the notification is a background task that
    runs only after the insert succeeded."""
    mock_supabase_client.get.side_effect = [
        [{"id": TEST_TRIP_ID, "name": "Summer Vacation"}],  # Trip ownership
        [{"user_id": OTHER_USER_ID}],  # Target exists
        [],  # No existing tag
    ]
    mock_supabase_client.rpc.return_value = False  # Not blocked
    mock_supabase_client.post.return_value = [
        {**SAMPLE_TAG_ROW, "initiated_by": mock_user.id}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.send_trip_tag_notification",
                new_callable=AsyncMock,
            ) as mock_notify,
        ):
            response = client.post(
                f"/trip-tags/{TEST_TRIP_ID}/tags/{OTHER_USER_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        assert response.json()["status"] == "pending"
        # Insert happened, then the notification was scheduled and ran
        insert_call = mock_supabase_client.post.call_args
        assert insert_call[0][0] == "trip_tags"
        assert insert_call[0][1]["notification_id"] is None
        mock_notify.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_add_trip_tag_target_not_found_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Tagging a nonexistent user returns 404 without inserting or notifying."""
    mock_supabase_client.get.side_effect = [
        [{"id": TEST_TRIP_ID, "name": "Summer Vacation"}],  # Trip ownership
        [],  # Target does not exist
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.send_trip_tag_notification",
                new_callable=AsyncMock,
            ) as mock_notify,
        ):
            response = client.post(
                f"/trip-tags/{TEST_TRIP_ID}/tags/{OTHER_USER_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
        mock_supabase_client.post.assert_not_called()
        mock_notify.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_add_trip_tag_blocked_pair_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A block in either direction yields 404 (not revealing the user exists);
    nothing is inserted and no notification goes out."""
    mock_supabase_client.get.side_effect = [
        [{"id": TEST_TRIP_ID, "name": "Summer Vacation"}],  # Trip ownership
        [{"user_id": OTHER_USER_ID}],  # Target exists
    ]
    mock_supabase_client.rpc.return_value = True  # Blocked (either direction)

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.send_trip_tag_notification",
                new_callable=AsyncMock,
            ) as mock_notify,
        ):
            response = client.post(
                f"/trip-tags/{TEST_TRIP_ID}/tags/{OTHER_USER_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
        rpc_call = mock_supabase_client.rpc.call_args
        assert rpc_call[0][0] == "is_blocked_bidirectional"
        assert rpc_call[0][1] == {"p_user_id": OTHER_USER_ID}
        mock_supabase_client.post.assert_not_called()
        mock_notify.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_add_trip_tag_no_notification_when_insert_fails(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A failed tag insert returns 500 and never notifies the tagged user."""
    mock_supabase_client.get.side_effect = [
        [{"id": TEST_TRIP_ID, "name": "Summer Vacation"}],  # Trip ownership
        [{"user_id": OTHER_USER_ID}],  # Target exists
        [],  # No existing tag
    ]
    mock_supabase_client.rpc.return_value = False  # Not blocked
    mock_supabase_client.post.return_value = []  # Insert failed

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.send_trip_tag_notification",
                new_callable=AsyncMock,
            ) as mock_notify,
        ):
            response = client.post(
                f"/trip-tags/{TEST_TRIP_ID}/tags/{OTHER_USER_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 500
        mock_notify.assert_not_called()
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Consent withdrawal (DELETE /trip-tags/{trip_id}/tag)
# ============================================================================


def test_withdraw_trip_tag_requires_auth(client: TestClient) -> None:
    response = client.delete(f"/trip-tags/{TEST_TRIP_ID}/tag")
    assert response.status_code == 403


def test_withdraw_approved_trip_tag_deletes_own_tag(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """The tagged user can withdraw consent from an APPROVED tag (plan Q3):
    the tag row is deleted, scoped to the caller's own tagged_user_id."""
    service_client = AsyncMock()
    mock_supabase_client.get.return_value = [{"id": TEST_TAG_ID}]
    service_client.delete.return_value = [{"id": TEST_TAG_ID}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.get_service_supabase_client",
                return_value=service_client,
            ),
        ):
            response = client.delete(
                f"/trip-tags/{TEST_TRIP_ID}/tag", headers=auth_headers
            )
        assert response.status_code == 204
        # The lookup proved the tag belongs to the caller...
        lookup_params = mock_supabase_client.get.call_args[0][1]
        assert lookup_params["tagged_user_id"] == f"eq.{mock_user.id}"
        # ...and the delete stays scoped to the caller's own tag
        delete_call = service_client.delete.call_args
        assert delete_call[0][0] == "trip_tags"
        assert delete_call[0][1]["id"] == f"eq.{TEST_TAG_ID}"
        assert delete_call[0][1]["tagged_user_id"] == f"eq.{mock_user.id}"
    finally:
        app.dependency_overrides.clear()


def test_withdraw_trip_tag_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Withdrawing a tag that does not exist returns 404; nothing is deleted."""
    service_client = AsyncMock()
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.get_service_supabase_client",
                return_value=service_client,
            ),
        ):
            response = client.delete(
                f"/trip-tags/{TEST_TRIP_ID}/tag", headers=auth_headers
            )
        assert response.status_code == 404
        service_client.delete.assert_not_called()
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Pending tags exclude blocked initiators
# ============================================================================


def test_pending_trip_tags_filters_blocked_initiators(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Pending tags initiated by a user with a block in either direction are
    hidden (defense in depth: block_user_full clears them at block time, but
    pre-existing rows must not surface either)."""
    blocked_initiator = "550e8400-e29b-41d4-a716-446655440777"
    tag_from_ok_user = {
        "id": TEST_TAG_ID,
        "trip_id": TEST_TRIP_ID,
        "initiated_by": OTHER_USER_ID,
        "created_at": "2024-01-01T00:00:00Z",
        "trip": {"name": "Good Trip", "country": {"code": "US"}},
    }
    tag_from_blocked_user = {
        "id": "550e8400-e29b-41d4-a716-446655440888",
        "trip_id": TEST_TRIP_ID,
        "initiated_by": blocked_initiator,
        "created_at": "2024-01-02T00:00:00Z",
        "trip": {"name": "Blocked Trip", "country": {"code": "FR"}},
    }

    service_client = AsyncMock()
    mock_supabase_client.get.side_effect = [
        [tag_from_blocked_user, tag_from_ok_user],  # Pending tags
        [  # Initiator profiles
            {"user_id": OTHER_USER_ID, "username": "gooduser", "avatar_url": None},
            {"user_id": blocked_initiator, "username": "baduser", "avatar_url": None},
        ],
    ]
    service_client.get.side_effect = [
        [],  # Blocks by the current user against initiators
        [{"blocker_id": blocked_initiator}],  # Initiator blocked the current user
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.get_service_supabase_client",
                return_value=service_client,
            ),
        ):
            response = client.get("/trip-tags/pending", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["initiated_by"] == OTHER_USER_ID
        assert data[0]["trip_name"] == "Good Trip"
    finally:
        app.dependency_overrides.clear()
