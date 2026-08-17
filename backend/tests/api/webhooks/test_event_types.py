"""Event type handling tests for RevenueCat webhook."""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    "event_type,expected_status",
    [
        ("INITIAL_PURCHASE", "premium"),
        ("RENEWAL", "premium"),
        ("PRODUCT_CHANGE", "premium"),
        ("UNCANCELLATION", "premium"),
        ("CANCELLATION", "premium"),  # Still active until period end
        ("BILLING_ISSUE", "premium"),  # Grace period
    ],
)
def test_webhook_event_type_maps_to_premium(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
    event_type: str,
    expected_status: str,
) -> None:
    """Test that various event types map to premium status."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    base_event["event"]["type"] = event_type

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

    # Verify correct status passed to RPC
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    assert rpc_params["p_status"] == expected_status


def test_webhook_expiration_sets_free(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that EXPIRATION event sets status to free."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    base_event["event"]["type"] = "EXPIRATION"

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
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    assert rpc_params["p_status"] == "free"


def test_webhook_unknown_event_type_ignored(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that unknown event types are ignored."""
    base_event["event"]["type"] = "UNKNOWN_EVENT_TYPE"

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
    assert data["status"] == "ignored"
    assert "unhandled_event" in data["reason"]

    # RPC should NOT have been called
    mock_supabase_client.rpc.assert_not_called()


def test_webhook_subscriber_analysis_ignored(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that SUBSCRIBER_ANALYSIS event (common RevenueCat event) is ignored."""
    base_event["event"]["type"] = "SUBSCRIBER_ANALYSIS"

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
    assert response.json()["status"] == "ignored"
