"""Out-of-order webhook delivery tests for RevenueCat webhook."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def test_webhook_older_event_skipped(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """
    Test that older events are skipped when a newer event was already processed.

    The RPC function update_subscription_if_newer compares event_timestamp_ms
    against last_webhook_timestamp_ms in user_profile. If the incoming event
    is older, it returns {skipped: true, reason: 'older_event'}.
    """
    mock_supabase_client.rpc.return_value = {
        "skipped": True,
        "reason": "older_event",
    }

    with patch(
        "app.api.webhooks.get_service_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "skipped"
    assert data["reason"] == "older_event"


def test_webhook_newer_event_updates(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """
    Test that newer events successfully update the subscription.

    RPC compares timestamps and updates if incoming > stored.
    """
    mock_supabase_client.rpc.return_value = {"updated": True}

    with patch(
        "app.api.webhooks.get_service_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_webhook_same_timestamp_event_skipped(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """
    Test that events with same timestamp are skipped (>= comparison in RPC).

    This prevents duplicate processing of the same event.
    """
    mock_supabase_client.rpc.return_value = {
        "skipped": True,
        "reason": "older_event",
    }

    with patch(
        "app.api.webhooks.get_service_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers=webhook_headers,
        )

    assert response.status_code == 200
    assert response.json()["status"] == "skipped"
