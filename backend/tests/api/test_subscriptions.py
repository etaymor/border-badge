"""Tests for subscription API endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import TEST_TRIP_ID, TEST_USER_ID, mock_auth_dependency

# ============================================================================
# GET /subscriptions/status Tests
# ============================================================================


def test_get_subscription_status_requires_auth(client: TestClient) -> None:
    """Test that getting subscription status requires authentication."""
    response = client.get("/subscriptions/status")
    assert response.status_code == 403


def test_get_subscription_status_free(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_free_profile: dict[str, Any],
) -> None:
    """Test getting subscription status for free user."""
    mock_supabase_client.get.return_value = [sample_free_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "free"
        assert data["plan"] is None
        assert data["expires_at"] is None
    finally:
        app.dependency_overrides.clear()


def test_get_subscription_status_premium(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_premium_profile: dict[str, Any],
) -> None:
    """Test getting subscription status for premium user."""
    mock_supabase_client.get.return_value = [sample_premium_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "premium"
        assert data["plan"] == "annual"
        assert data["expires_at"] is not None
    finally:
        app.dependency_overrides.clear()


def test_get_subscription_status_trial(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trial_profile: dict[str, Any],
) -> None:
    """Test getting subscription status for trial user."""
    mock_supabase_client.get.return_value = [sample_trial_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "trial"
        assert data["plan"] == "monthly"
    finally:
        app.dependency_overrides.clear()


def test_get_subscription_status_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting subscription status when profile not found."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/status", headers=auth_headers)
        assert response.status_code == 404
        assert "Profile not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# GET /subscriptions/usage Tests
# ============================================================================


def test_get_usage_limits_requires_auth(client: TestClient) -> None:
    """Test that getting usage limits requires authentication."""
    response = client.get("/subscriptions/usage")
    assert response.status_code == 403


def test_get_usage_limits(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_free_profile: dict[str, Any],
) -> None:
    """Test getting usage limits."""
    mock_supabase_client.get.return_value = [sample_free_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/usage", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["share_extension_count"] == 0
        assert data["share_extension_limit"] == 5
        assert data["photo_import_count"] == 0
        assert data["photo_import_limit"] == 1
        assert data["entries_per_trip_limit"] == 10
    finally:
        app.dependency_overrides.clear()


def test_get_usage_limits_defaults_nulls_to_zero(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that null usage values default to zero."""
    profile_with_nulls = {
        "id": TEST_USER_ID,
        "usage_share_extension_count": None,
        "usage_photo_import_count": None,
    }
    mock_supabase_client.get.return_value = [profile_with_nulls]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/usage", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["share_extension_count"] == 0
        assert data["photo_import_count"] == 0
    finally:
        app.dependency_overrides.clear()


def test_get_usage_limits_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting usage limits when profile not found."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/usage", headers=auth_headers)
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# POST /subscriptions/usage/increment Tests
# ============================================================================


def test_increment_usage_requires_auth(client: TestClient) -> None:
    """Test that incrementing usage requires authentication."""
    response = client.post(
        "/subscriptions/usage/increment", json={"feature": "share_extension"}
    )
    assert response.status_code == 403


def test_increment_share_extension_usage(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test incrementing share extension usage."""
    mock_supabase_client.rpc = AsyncMock(return_value=3)

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "share_extension"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "incremented"
        assert data["new_count"] == 3
        mock_supabase_client.rpc.assert_called_once_with(
            "increment_share_extension_usage", {"p_user_id": mock_user.id}
        )
    finally:
        app.dependency_overrides.clear()


def test_increment_photo_import_usage(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test incrementing photo import usage."""
    mock_supabase_client.rpc = AsyncMock(return_value=1)

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "photo_import"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "incremented"
        assert data["new_count"] == 1
        mock_supabase_client.rpc.assert_called_once_with(
            "increment_photo_import_usage", {"p_user_id": mock_user.id}
        )
    finally:
        app.dependency_overrides.clear()


def test_increment_usage_invalid_feature(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test incrementing with invalid feature."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "invalid_feature"},
            )
        assert response.status_code == 422  # Pydantic validation error
    finally:
        app.dependency_overrides.clear()


def test_increment_usage_rpc_failure(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test incrementing when RPC fails."""
    mock_supabase_client.rpc = AsyncMock(side_effect=Exception("Database error"))

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "share_extension"},
            )
        assert response.status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_increment_usage_invalid_rpc_response(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test incrementing when RPC returns invalid response."""
    mock_supabase_client.rpc = AsyncMock(return_value=None)

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "share_extension"},
            )
        assert response.status_code == 500
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# GET /subscriptions/can-add-entry/{trip_id} Tests
# ============================================================================


def test_can_add_entry_requires_auth(client: TestClient) -> None:
    """Test that checking entry permission requires authentication."""
    response = client.get(f"/subscriptions/can-add-entry/{TEST_TRIP_ID}")
    assert response.status_code == 403


def test_can_add_entry_premium_user(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_premium_profile: dict[str, Any],
) -> None:
    """Test premium user can always add entries."""
    mock_supabase_client.get.return_value = [sample_premium_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get(
                f"/subscriptions/can-add-entry/{TEST_TRIP_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["allowed"] is True
    finally:
        app.dependency_overrides.clear()


def test_can_add_entry_trial_user(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_trial_profile: dict[str, Any],
) -> None:
    """Test trial user can always add entries."""
    mock_supabase_client.get.return_value = [sample_trial_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get(
                f"/subscriptions/can-add-entry/{TEST_TRIP_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["allowed"] is True
    finally:
        app.dependency_overrides.clear()


def test_can_add_entry_free_user_under_limit(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_free_profile: dict[str, Any],
) -> None:
    """Test free user can add entry when under limit."""
    # First call: profile, Second call: entries (5 existing)
    mock_supabase_client.get.side_effect = [
        [sample_free_profile],
        [{"id": f"entry-{i}"} for i in range(5)],
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get(
                f"/subscriptions/can-add-entry/{TEST_TRIP_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["allowed"] is True
        assert data["count"] == 5
        assert data["limit"] == 10
        assert data["remaining"] == 5
    finally:
        app.dependency_overrides.clear()


def test_can_add_entry_free_user_at_limit(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_free_profile: dict[str, Any],
) -> None:
    """Test free user blocked when at limit."""
    # First call: profile, Second call: entries (10 existing)
    mock_supabase_client.get.side_effect = [
        [sample_free_profile],
        [{"id": f"entry-{i}"} for i in range(10)],
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get(
                f"/subscriptions/can-add-entry/{TEST_TRIP_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["allowed"] is False
        assert data["count"] == 10
        assert data["remaining"] == 0
    finally:
        app.dependency_overrides.clear()


def test_can_add_entry_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting can-add-entry when profile not found."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get(
                f"/subscriptions/can-add-entry/{TEST_TRIP_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# POST /subscriptions/verify Tests
# ============================================================================


def test_verify_subscription_requires_auth(client: TestClient) -> None:
    """Test that verifying subscription requires authentication."""
    response = client.post("/subscriptions/verify")
    assert response.status_code == 403


def test_verify_subscription_not_configured(
    client: TestClient,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test verify returns 501 when RevenueCat not configured."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.subscriptions.settings") as mock_settings:
            mock_settings.revenuecat_api_key = None
            response = client.post("/subscriptions/verify", headers=auth_headers)
        assert response.status_code == 501
        assert "not configured" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Timezone Edge Case Documentation
# ============================================================================
# SCENARIO: Client-side timezone mismatches with monthly reset
#
# Problem: User in UTC+14 saves at Jan 31 23:59 local (still Jan 31 UTC).
# Device thinks it's Feb 1 → resets counter to 0 → shows "5 available"
# Backend sees Jan 31 UTC → doesn't reset → count is still 4
#
# Current Design (CORRECT):
# 1. Backend RPC (increment_share_extension_usage) is AUTHORITATIVE
#    - Uses server UTC time to determine if reset applies
#    - Increments count AFTER reset, so enforcement is always correct
# 2. Client-side calculation (/usage endpoint returns period_start) is UX HINT only
#    - Client shows effective usage based on period_start
#    - Timezone mismatches only affect the display, not enforcement
# 3. Worst case: User sees "4 available" but can still save
#    - Better UX than showing "5 available" then hitting backend limit
#
# Test below documents this contract: RPC is source of truth for increment.


def test_share_extension_period_reset_on_new_month(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """
    Document the timezone edge case contract.

    RPC (increment_share_extension_usage) is the authoritative source for reset.
    Client-side period calculations are UX hints only. The RPC uses server UTC
    time to determine if a reset applies, so enforcement is always correct
    regardless of client timezone mismatches.
    """
    # RPC always returns the correct count after applying backend reset logic
    mock_supabase_client.rpc = AsyncMock(return_value=1)  # Reset applied, now at 1

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            # Client calls RPC to increment (not client-side calculation)
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "share_extension"},
            )
        assert response.status_code == 200
        data = response.json()
        # RPC returns 1, indicating a reset was applied before incrementing
        assert data["new_count"] == 1
        # RPC was called with correct user ID (authorization built into RPC)
        mock_supabase_client.rpc.assert_called_once_with(
            "increment_share_extension_usage", {"p_user_id": mock_user.id}
        )
    finally:
        app.dependency_overrides.clear()
