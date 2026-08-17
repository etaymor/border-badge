"""Tests for blocking system endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
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
    """Test successfully blocking another user via the block_user_full RPC."""
    # Target user exists
    mock_supabase_client.get.return_value = [
        {"id": "profile-id", "user_id": OTHER_USER_ID}
    ]
    # RPC returns True when a new block row was created
    mock_supabase_client.rpc.return_value = True

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
        # Block semantics live in SQL: the endpoint delegates to the RPC
        mock_supabase_client.rpc.assert_awaited_once_with(
            "block_user_full", {"p_blocked_id": OTHER_USER_ID}
        )
    finally:
        app.dependency_overrides.clear()


def test_block_user_idempotent(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test blocking a user you've already blocked returns already_blocked."""
    # Target user exists
    mock_supabase_client.get.return_value = [
        {"id": "profile-id", "user_id": OTHER_USER_ID}
    ]
    # RPC returns False when the block row already existed
    mock_supabase_client.rpc.return_value = False

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
    # Target user doesn't exist
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
        # The RPC is never reached for a nonexistent target
        mock_supabase_client.rpc.assert_not_awaited()
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
# Block Semantics Live in SQL (block_user_full RPC)
# ============================================================================


def test_block_delegates_cleanup_to_rpc(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Blocking runs entirely through block_user_full, not JWT-scoped writes.

    The old implementation issued JWT-scoped deletes against user_follow and a
    direct insert into user_block; RLS silently no-oped the other-direction
    delete. The endpoint must now issue no table writes at all - follow
    removal (both directions), inbox purges, and the idempotent block insert
    all happen inside the SECURITY DEFINER RPC.
    """
    mock_supabase_client.get.return_value = [
        {"id": "profile-id", "user_id": OTHER_USER_ID}
    ]
    mock_supabase_client.rpc.return_value = True

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.blocks.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(f"/blocks/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 201

        # No JWT-scoped table writes from the endpoint itself
        mock_supabase_client.delete.assert_not_awaited()
        mock_supabase_client.post.assert_not_awaited()
        # Exactly one RPC call carries all block semantics
        mock_supabase_client.rpc.assert_awaited_once_with(
            "block_user_full", {"p_blocked_id": OTHER_USER_ID}
        )
    finally:
        app.dependency_overrides.clear()
