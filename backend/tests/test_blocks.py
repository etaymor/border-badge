"""Tests for blocking system endpoints."""

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
# Block User Tests
# ============================================================================


def test_block_user_requires_auth(client: TestClient) -> None:
    """Test that blocking a user requires authentication."""
    response = client.post(f"/blocks/{OTHER_USER_ID}")
    assert response.status_code == 403


def test_block_user_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully blocking another user."""
    # Mock responses: not already blocked, target user exists
    mock_supabase_client.get.side_effect = [
        [],  # Not already blocked
        [{"id": "profile-id", "user_id": OTHER_USER_ID}],  # Target user exists
    ]
    mock_supabase_client.delete.return_value = []  # Follows removed
    mock_supabase_client.post.return_value = [
        {"id": "block-id", "blocker_id": TEST_USER_ID, "blocked_id": OTHER_USER_ID}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "blocked"
        assert data["blocked_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_block_user_idempotent(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test blocking a user you've already blocked returns already_blocked."""
    # Mock response: already blocked
    mock_supabase_client.get.return_value = [{"id": "existing-block-id"}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "already_blocked"
        assert data["blocked_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_block_user_self_fails_400(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that blocking yourself returns 400."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{mock_user.id}", headers=auth_headers)
        assert response.status_code == 400
        assert "Cannot block yourself" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_block_user_not_found_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that blocking a nonexistent user returns 404."""
    # Mock responses: not already blocked, user doesn't exist
    mock_supabase_client.get.side_effect = [
        [],  # Not already blocked
        [],  # User doesn't exist
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Unblock User Tests
# ============================================================================


def test_unblock_user_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully unblocking a user."""
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unblocked"
        assert data["blocked_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_unblock_user_idempotent(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that unblocking someone you haven't blocked is idempotent."""
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unblocked"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Get Blocked Users Tests
# ============================================================================


def test_get_blocked_users_requires_auth(client: TestClient) -> None:
    """Test that getting blocked users requires authentication."""
    response = client.get("/blocks")
    assert response.status_code == 403


def test_get_blocked_users_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting blocked users when no one is blocked."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/blocks", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_get_blocked_users_paginated(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting blocked users with pagination."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "blockeduser",
        "avatar_url": "https://example.com/avatar.jpg",
    }

    mock_supabase_client.get.side_effect = [
        [{"blocked_id": OTHER_USER_ID, "created_at": "2024-01-01T00:00:00Z"}],
        [sample_profile],
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/blocks", headers=auth_headers, params={"limit": 10, "offset": 0}
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["username"] == "blockeduser"
        assert data[0]["user_id"] == OTHER_USER_ID
        assert data[0]["avatar_url"] == "https://example.com/avatar.jpg"
    finally:
        app.dependency_overrides.clear()


def test_get_blocked_users_orphaned_blocks(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting blocked users when block records exist but profiles are missing."""
    # Block records exist but no profiles found (orphaned data)
    mock_supabase_client.get.side_effect = [
        [{"blocked_id": OTHER_USER_ID, "created_at": "2024-01-01T00:00:00Z"}],
        [],  # No profiles found
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/blocks", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Block Removes Follows Tests
# ============================================================================


def test_block_removes_follow_bidirectional(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that blocking a user removes follows in both directions."""
    # Track delete calls to verify bidirectional removal
    delete_calls = []

    async def track_delete(table: str, params: dict[str, Any]) -> list[Any]:
        delete_calls.append({"table": table, "params": params})
        return []

    mock_supabase_client.delete = AsyncMock(side_effect=track_delete)
    mock_supabase_client.get.side_effect = [
        [],  # Not already blocked
        [{"id": "profile-id", "user_id": OTHER_USER_ID}],  # Target user exists
    ]
    mock_supabase_client.post.return_value = [
        {"id": "block-id", "blocker_id": TEST_USER_ID, "blocked_id": OTHER_USER_ID}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 201

        # Verify delete was called for user_follow table with bidirectional OR clause
        assert len(delete_calls) == 1
        assert delete_calls[0]["table"] == "user_follow"
        # The OR clause should handle both directions
        assert "or" in delete_calls[0]["params"]
    finally:
        app.dependency_overrides.clear()
