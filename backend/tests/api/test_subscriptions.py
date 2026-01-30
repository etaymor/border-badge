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


def test_verify_subscription_uses_timestamp_ordered_update(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_free_profile: dict[str, Any],
) -> None:
    """Test verify endpoint uses update_subscription_if_newer RPC for event ordering."""
    from unittest.mock import MagicMock

    # Mock profile lookup
    mock_supabase_client.get.return_value = [sample_free_profile]
    # Mock RPC to return updated
    mock_supabase_client.rpc = AsyncMock(return_value={"updated": True})

    # Mock RevenueCat API response with active subscription
    revenuecat_response = {
        "subscriber": {
            "entitlements": {
                "Full Access": {
                    "expires_date": "2030-12-31T00:00:00Z",
                    "period_type": "normal",
                    "product_identifier": "com.app.annual",
                }
            }
        }
    }

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch("app.api.subscriptions.settings") as mock_settings,
            patch("app.api.subscriptions.get_supabase_client") as mock_get_client,
            patch("app.api.subscriptions.httpx.AsyncClient") as mock_httpx,
        ):
            mock_settings.revenuecat_api_key = "test-api-key"
            mock_get_client.return_value = mock_supabase_client

            # Mock httpx response - use MagicMock for sync json() method
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = revenuecat_response
            mock_httpx_instance = AsyncMock()
            mock_httpx_instance.get = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(
                return_value=mock_httpx_instance
            )
            mock_httpx.return_value.__aexit__ = AsyncMock()

            response = client.post("/subscriptions/verify", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "verified"
        assert data["subscription_status"] == "premium"

        # Verify RPC was called with update_subscription_if_newer
        mock_supabase_client.rpc.assert_called_once()
        call_args = mock_supabase_client.rpc.call_args
        assert call_args[0][0] == "update_subscription_if_newer"

        # Verify RPC params include timestamp-ordering fields
        rpc_params = call_args[0][1]
        assert rpc_params["p_user_id"] == str(mock_user.id)
        assert rpc_params["p_status"] == "premium"
        assert rpc_params["p_plan"] == "annual"
        assert "p_event_timestamp_ms" in rpc_params
        assert isinstance(rpc_params["p_event_timestamp_ms"], int)
        assert "p_event_id" in rpc_params
        assert rpc_params["p_event_id"].startswith(f"verify-{mock_user.id}-")
    finally:
        app.dependency_overrides.clear()


def test_verify_subscription_respects_event_ordering(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_premium_profile: dict[str, Any],
) -> None:
    """Test verify endpoint does not overwrite newer webhook data (skipped response)."""
    from unittest.mock import MagicMock

    # Mock profile lookup with existing RevenueCat ID
    mock_supabase_client.get.return_value = [sample_premium_profile]
    # Mock RPC to return skipped (webhook data is newer)
    mock_supabase_client.rpc = AsyncMock(return_value={"skipped": True})

    # Mock RevenueCat API response with active subscription
    revenuecat_response = {
        "subscriber": {
            "entitlements": {
                "Full Access": {
                    "expires_date": "2030-12-31T00:00:00Z",
                    "period_type": "normal",
                    "product_identifier": "com.app.monthly",
                }
            }
        }
    }

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch("app.api.subscriptions.settings") as mock_settings,
            patch("app.api.subscriptions.get_supabase_client") as mock_get_client,
            patch("app.api.subscriptions.httpx.AsyncClient") as mock_httpx,
        ):
            mock_settings.revenuecat_api_key = "test-api-key"
            mock_get_client.return_value = mock_supabase_client

            # Mock httpx response - use MagicMock for sync json() method
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = revenuecat_response
            mock_httpx_instance = AsyncMock()
            mock_httpx_instance.get = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(
                return_value=mock_httpx_instance
            )
            mock_httpx.return_value.__aexit__ = AsyncMock()

            response = client.post("/subscriptions/verify", headers=auth_headers)

        # Verify still returns success (client doesn't need to know update was skipped)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "verified"

        # Verify the timestamp-ordered RPC was used
        mock_supabase_client.rpc.assert_called_once()
        call_args = mock_supabase_client.rpc.call_args
        assert call_args[0][0] == "update_subscription_if_newer"
    finally:
        app.dependency_overrides.clear()


def test_verify_subscription_trial_status(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_free_profile: dict[str, Any],
) -> None:
    """Test verify endpoint correctly identifies trial subscriptions."""
    from unittest.mock import MagicMock

    mock_supabase_client.get.return_value = [sample_free_profile]
    mock_supabase_client.rpc = AsyncMock(return_value={"updated": True})

    # Mock RevenueCat API response with trial subscription
    revenuecat_response = {
        "subscriber": {
            "entitlements": {
                "Full Access": {
                    "expires_date": "2030-12-31T00:00:00Z",
                    "period_type": "trial",
                    "product_identifier": "com.app.monthly",
                }
            }
        }
    }

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch("app.api.subscriptions.settings") as mock_settings,
            patch("app.api.subscriptions.get_supabase_client") as mock_get_client,
            patch("app.api.subscriptions.httpx.AsyncClient") as mock_httpx,
        ):
            mock_settings.revenuecat_api_key = "test-api-key"
            mock_get_client.return_value = mock_supabase_client

            # Mock httpx response - use MagicMock for sync json() method
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = revenuecat_response
            mock_httpx_instance = AsyncMock()
            mock_httpx_instance.get = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(
                return_value=mock_httpx_instance
            )
            mock_httpx.return_value.__aexit__ = AsyncMock()

            response = client.post("/subscriptions/verify", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["subscription_status"] == "trial"

        # Verify RPC was called with trial status
        rpc_params = mock_supabase_client.rpc.call_args[0][1]
        assert rpc_params["p_status"] == "trial"
    finally:
        app.dependency_overrides.clear()


def test_verify_subscription_expired(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_premium_profile: dict[str, Any],
) -> None:
    """Test verify endpoint handles expired subscriptions."""
    from unittest.mock import MagicMock

    mock_supabase_client.get.return_value = [sample_premium_profile]
    mock_supabase_client.rpc = AsyncMock(return_value={"updated": True})

    # Mock RevenueCat API response with expired subscription
    revenuecat_response = {
        "subscriber": {
            "entitlements": {
                "Full Access": {
                    "expires_date": "2020-01-01T00:00:00Z",  # Past date
                    "period_type": "normal",
                    "product_identifier": "com.app.annual",
                }
            }
        }
    }

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch("app.api.subscriptions.settings") as mock_settings,
            patch("app.api.subscriptions.get_supabase_client") as mock_get_client,
            patch("app.api.subscriptions.httpx.AsyncClient") as mock_httpx,
        ):
            mock_settings.revenuecat_api_key = "test-api-key"
            mock_get_client.return_value = mock_supabase_client

            # Mock httpx response - use MagicMock for sync json() method
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = revenuecat_response
            mock_httpx_instance = AsyncMock()
            mock_httpx_instance.get = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(
                return_value=mock_httpx_instance
            )
            mock_httpx.return_value.__aexit__ = AsyncMock()

            response = client.post("/subscriptions/verify", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["subscription_status"] == "free"

        # Verify RPC was called with free status
        rpc_params = mock_supabase_client.rpc.call_args[0][1]
        assert rpc_params["p_status"] == "free"
    finally:
        app.dependency_overrides.clear()
