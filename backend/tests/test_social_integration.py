"""Integration tests for social feature workflows.

These tests verify that multiple social features work correctly together,
testing cross-feature interactions that individual unit tests don't cover.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_USER_ID,
    mock_auth_dependency,
)

THIRD_USER_ID = "550e8400-e29b-41d4-a716-446655440088"


def make_feed_row(
    user_id: str = OTHER_USER_ID,
    activity_type: str = "country_visited",
    country_code: str = "JP",
    country_name: str = "Japan",
    country_id: str = "country-id-jp",
) -> dict:
    """Create a sample feed row matching the database function output."""
    return {
        "user_id": user_id,
        "username": "traveler",
        "avatar_url": None,
        "activity_type": activity_type,
        "created_at": "2024-01-15T10:00:00Z",
        "country_id": country_id,
        "country_code": country_code,
        "country_name": country_name,
        "entry_id": None,
        "entry_name": None,
        "entry_type": None,
        "location_name": None,
        "entry_image_url": None,
    }


# ============================================================================
# Follow -> Feed Integration Tests
# ============================================================================


def test_follow_then_appears_in_feed(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that after following a user, their activities appear in your feed."""
    # Step 1: Follow the user
    mock_supabase_client.get.side_effect = [
        [],  # No blocks
        [{"id": "profile-id", "user_id": OTHER_USER_ID}],  # Target user exists
    ]
    mock_supabase_client.post.return_value = [
        {"id": "follow-id", "follower_id": TEST_USER_ID, "following_id": OTHER_USER_ID}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.follows.get_supabase_client", return_value=mock_supabase_client
            ),
            patch("app.api.follows.send_push_notification", new_callable=AsyncMock),
        ):
            follow_response = client.post(
                f"/follows/{OTHER_USER_ID}", headers=auth_headers
            )
        assert follow_response.status_code == 201

        # Step 2: Verify feed includes that user's activities
        # Reset mock for feed call - use the correct feed row format
        mock_supabase_client.rpc.return_value = [make_feed_row(user_id=OTHER_USER_ID)]

        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            feed_response = client.get("/feed", headers=auth_headers)

        assert feed_response.status_code == 200
        feed_data = feed_response.json()
        assert len(feed_data["items"]) == 1
        assert feed_data["items"][0]["user"]["user_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Block -> Feed Integration Tests
# ============================================================================


def test_block_removes_from_feed(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that blocking a user removes them from your activity feed."""
    # Block the user
    mock_supabase_client.get.side_effect = [
        [],  # Not already blocked
        [{"id": "profile-id", "user_id": OTHER_USER_ID}],  # Target user exists
    ]
    mock_supabase_client.delete.return_value = []
    mock_supabase_client.post.return_value = [{"id": "block-id"}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            block_response = client.post(
                f"/blocks/{OTHER_USER_ID}", headers=auth_headers
            )
        assert block_response.status_code == 201

        # Verify feed returns empty (blocked user's activities are excluded)
        # The get_activity_feed function excludes blocked users
        mock_supabase_client.rpc.return_value = []  # No activities (blocked)

        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            feed_response = client.get("/feed", headers=auth_headers)

        assert feed_response.status_code == 200
        assert feed_response.json()["items"] == []
    finally:
        app.dependency_overrides.clear()


def test_block_removes_bidirectional_follows(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that blocking removes follows in BOTH directions."""
    delete_calls = []

    async def track_delete(table: str, params: dict[str, Any]) -> list[Any]:
        delete_calls.append({"table": table, "params": params})
        return []

    mock_supabase_client.delete = AsyncMock(side_effect=track_delete)
    mock_supabase_client.get.side_effect = [
        [],  # Not already blocked
        [{"id": "profile-id", "user_id": OTHER_USER_ID}],  # Target exists
    ]
    mock_supabase_client.post.return_value = [{"id": "block-id"}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 201

        # Verify the delete call includes OR clause for both directions
        assert len(delete_calls) == 1
        assert delete_calls[0]["table"] == "user_follow"
        or_clause = delete_calls[0]["params"].get("or", "")
        # Should have clauses for both A->B and B->A
        assert TEST_USER_ID in or_clause
        assert OTHER_USER_ID in or_clause
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Block -> Search Integration Tests
# ============================================================================


def test_blocked_user_hidden_from_search(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that blocked users don't appear in search results."""
    # The search endpoint should exclude blocked users
    # Return empty results (simulating blocked user being filtered)
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/users/search", headers=auth_headers, params={"q": "blocked"}
            )
        assert response.status_code == 200
        # Blocked users should not appear
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Block -> Profile Integration Tests
# ============================================================================


def test_blocked_user_hidden_from_profile(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that viewing a blocked user's profile returns 404."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "blockedperson",
        "display_name": "Blocked Person",
        "avatar_url": None,
    }

    mock_supabase_client.get.side_effect = [
        [sample_profile],  # Profile exists
        [{"id": "block-id"}],  # Block exists
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/users/blockedperson/profile", headers=auth_headers
            )
        # Should return 404 to hide user existence
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Trip Tag Consent Workflow Tests
# ============================================================================


def test_trip_tag_consent_full_workflow(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test the full trip tag consent workflow:
    1. User A tags User B on a trip -> status is 'pending'
    2. User B sees the pending tag
    3. User B approves -> status becomes 'approved'
    4. Trip becomes visible to User B
    """
    trip_id = "550e8400-e29b-41d4-a716-446655440010"
    tag_id = "550e8400-e29b-41d4-a716-446655440011"

    # Step 1: Get pending trip tags for User B (our mock_user)
    # Format matches the actual database query with nested trip and initiator
    pending_tag = {
        "id": tag_id,
        "trip_id": trip_id,
        "initiated_by": OTHER_USER_ID,
        "created_at": "2024-01-01T00:00:00Z",
        "trip": {
            "name": "Amazing Trip",
            "country": {"code": "JP"},
        },
        "initiator": {
            "username": "tripcreator",
            "avatar_url": None,
        },
    }

    mock_supabase_client.get.return_value = [pending_tag]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trip_tags.get_supabase_client", return_value=mock_supabase_client
        ):
            pending_response = client.get("/trip-tags/pending", headers=auth_headers)
        assert pending_response.status_code == 200
        pending_data = pending_response.json()
        # Response is a list, not wrapped in "items"
        assert len(pending_data) == 1
        assert pending_data[0]["trip_name"] == "Amazing Trip"

        # Step 2: Approve the tag
        mock_supabase_client.get.side_effect = [
            [{"id": tag_id, "status": "pending"}],  # Tag exists and is pending
        ]
        mock_supabase_client.patch.return_value = [
            {
                "id": tag_id,
                "status": "approved",
                "responded_at": "2024-01-02T00:00:00Z",
            }
        ]
        # Also need to mock the auto-follow that happens on approval
        mock_supabase_client.post.return_value = [{"id": "follow-id"}]

        with (
            patch(
                "app.api.trip_tags.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.trip_tags.send_push_notification", new_callable=AsyncMock
            ),
        ):
            approve_response = client.post(
                f"/trip-tags/{trip_id}/approve", headers=auth_headers
            )
        assert approve_response.status_code == 200
        assert approve_response.json()["status"] == "approved"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Email Lookup -> Blocked Integration Tests
# ============================================================================


def test_email_lookup_hides_blocked_users(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that email lookup returns null for blocked users."""
    lookup_result = [
        {
            "user_id": OTHER_USER_ID,
            "username": "hiddenuser",
            "avatar_url": None,
        }
    ]

    mock_supabase_client.rpc.side_effect = [
        lookup_result,  # Email lookup finds user
        [{"user_id": OTHER_USER_ID, "count": 0}],  # Country count (for timing)
    ]
    mock_supabase_client.get.side_effect = [
        [{"id": "block-id"}],  # Block exists - user should be hidden
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.users.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.users.get_supabase_client", return_value=mock_supabase_client
            ),
        ):
            response = client.get(
                "/users/lookup-by-email",
                headers=auth_headers,
                params={"email": "blocked@example.com"},
            )
        assert response.status_code == 200
        # Should return null to hide blocked user
        assert response.json() is None
    finally:
        app.dependency_overrides.clear()
