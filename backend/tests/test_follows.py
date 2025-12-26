"""Tests for follow system endpoints."""

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

# ============================================================================
# Follow User Tests
# ============================================================================


def test_follow_user_requires_auth(client: TestClient) -> None:
    """Test that following a user requires authentication."""
    response = client.post(f"/follows/{OTHER_USER_ID}")
    assert response.status_code == 403


def test_follow_user_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully following another user."""
    # Mock responses: block check, existing follow check, target user exists
    mock_supabase_client.get.side_effect = [
        [],  # No blocks
        [],  # Not already following
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
            response = client.post(f"/follows/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "following"
        assert data["following_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_follow_user_already_following(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test following a user you're already following returns 200 (idempotent)."""
    # Mock responses: no blocks, already following
    mock_supabase_client.get.side_effect = [
        [],  # No blocks
        [{"id": "existing-follow"}],  # Already following
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/follows/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "already_following"
    finally:
        app.dependency_overrides.clear()


def test_follow_self_returns_400(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that following yourself returns 400."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/follows/{mock_user.id}", headers=auth_headers)
        assert response.status_code == 400
        assert "Cannot follow yourself" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_follow_blocked_user_returns_403(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that following a blocked user returns 403."""
    # Mock response: block exists
    mock_supabase_client.get.return_value = [{"id": "block-id"}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/follows/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 403
        assert "Cannot follow this user" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_follow_nonexistent_user_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that following a nonexistent user returns 404."""
    # Mock responses: no blocks, not following, user doesn't exist
    mock_supabase_client.get.side_effect = [
        [],  # No blocks
        [],  # Not following
        [],  # User doesn't exist
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/follows/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Unfollow User Tests
# ============================================================================


def test_unfollow_user_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully unfollowing a user."""
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(f"/follows/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unfollowed"
        assert data["following_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_unfollow_user_idempotent(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that unfollowing someone you don't follow is idempotent."""
    # Delete returns empty (nothing to delete)
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(f"/follows/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unfollowed"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Follow Stats Tests
# ============================================================================


def test_get_follow_stats(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting follow statistics."""
    # Mock followers and following
    mock_supabase_client.get.side_effect = [
        [{"id": "1"}, {"id": "2"}, {"id": "3"}],  # 3 followers
        [{"id": "1"}, {"id": "2"}],  # 2 following
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/stats", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["follower_count"] == 3
        assert data["following_count"] == 2
    finally:
        app.dependency_overrides.clear()


def test_get_follow_stats_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting follow statistics with no followers/following."""
    mock_supabase_client.get.side_effect = [[], []]  # No followers or following

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/stats", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["follower_count"] == 0
        assert data["following_count"] == 0
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Following List Tests
# ============================================================================


def test_get_following_list(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting list of users the current user follows."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "traveler",
        "display_name": "World Traveler",
        "avatar_url": None,
    }

    mock_supabase_client.get.side_effect = [
        [{"following_id": OTHER_USER_ID, "created_at": "2024-01-01T00:00:00Z"}],
        [sample_profile],
    ]
    mock_supabase_client.rpc.return_value = [{"user_id": OTHER_USER_ID, "count": 42}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/following", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["username"] == "traveler"
        assert data[0]["country_count"] == 42
    finally:
        app.dependency_overrides.clear()


def test_get_following_list_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting following list when not following anyone."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/following", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Followers List Tests
# ============================================================================


def test_get_followers_list(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting list of users following the current user."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "explorer",
        "display_name": "World Explorer",
        "avatar_url": "https://example.com/avatar.jpg",
    }

    mock_supabase_client.get.side_effect = [
        [{"follower_id": OTHER_USER_ID, "created_at": "2024-01-01T00:00:00Z"}],
        [sample_profile],
    ]
    mock_supabase_client.rpc.return_value = [{"user_id": OTHER_USER_ID, "count": 15}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/followers", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["username"] == "explorer"
        assert data[0]["avatar_url"] == "https://example.com/avatar.jpg"
        assert data[0]["country_count"] == 15
    finally:
        app.dependency_overrides.clear()


def test_get_followers_list_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting followers list when no one follows you."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/followers", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_get_following_list_orphaned_follows(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting following list when follows exist but profiles are missing."""
    # Follow records exist but no profiles found (orphaned data)
    mock_supabase_client.get.side_effect = [
        [{"following_id": OTHER_USER_ID, "created_at": "2024-01-01T00:00:00Z"}],
        [],  # No profiles found
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/following", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_get_followers_list_orphaned_follows(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting followers list when follows exist but profiles are missing."""
    # Follow records exist but no profiles found (orphaned data)
    mock_supabase_client.get.side_effect = [
        [{"follower_id": OTHER_USER_ID, "created_at": "2024-01-01T00:00:00Z"}],
        [],  # No profiles found
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.follows.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/follows/followers", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()
