"""Edge case tests for RevenueCat webhook."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def test_webhook_very_large_timestamp(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that very large (future) timestamps are handled."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    # Year 3000: 32503680000000 ms
    base_event["event"]["event_timestamp_ms"] = 32503680000000

    with patch(
        "app.api.webhooks.get_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_webhook_special_characters_in_event_id(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that special characters in event_id are handled."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    special_event_id = "evt_!@#$%^&*()_+-=[]{}|;':\",./<>?"
    base_event["event"]["id"] = special_event_id

    with patch(
        "app.api.webhooks.get_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    assert rpc_params["p_event_id"] == special_event_id


def test_webhook_original_app_user_id_passed(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that original_app_user_id is passed as revenuecat_id."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    base_event["event"]["original_app_user_id"] = "rc_customer_12345"

    with patch(
        "app.api.webhooks.get_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    assert rpc_params["p_revenuecat_id"] == "rc_customer_12345"


def test_webhook_expiration_datetime_conversion(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that valid expiration_at_ms converts to ISO string."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    # 2025-01-01 00:00:00 UTC
    base_event["event"]["expiration_at_ms"] = 1735689600000

    with patch(
        "app.api.webhooks.get_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    # Should be ISO format string
    assert rpc_params["p_expires_at"] is not None
    assert "2025-01-01" in rpc_params["p_expires_at"]


def test_webhook_invalid_expiration_timestamp_overflow(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that overflow expiration timestamp sets expires_at to None."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    # Overflow: causes OSError in datetime.fromtimestamp
    base_event["event"]["expiration_at_ms"] = 9999999999999999999

    with patch(
        "app.api.webhooks.get_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    assert rpc_params["p_expires_at"] is None


def test_webhook_service_role_client_used(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that webhook uses service role client (user_token=None)."""
    mock_supabase_client.rpc.return_value = {"updated": True}

    with patch(
        "app.api.webhooks.get_supabase_client",
        return_value=mock_supabase_client,
    ) as mock_get_client:
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    # Verify service role client was requested (user_token=None)
    mock_get_client.assert_called_once_with(user_token=None)


def test_webhook_event_id_passed_to_rpc(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """
    Document that event_id is passed to RPC for storage.

    The event_id is stored in last_webhook_event_id column but is NOT used
    for deduplication. Timestamp-based ordering is the primary mechanism.
    """
    mock_supabase_client.rpc.return_value = {"updated": True}

    with patch(
        "app.api.webhooks.get_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200

    # Verify event_id was passed to RPC
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    assert call_args[0][0] == "update_subscription_if_newer"
    assert rpc_params["p_event_id"] == "evt_123456"
