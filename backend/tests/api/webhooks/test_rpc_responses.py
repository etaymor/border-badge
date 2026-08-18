"""RPC response handling tests for RevenueCat webhook."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def test_webhook_rpc_updated_true_returns_success(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that RPC returning {updated: true} returns success."""
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


def test_webhook_rpc_skipped_returns_skipped(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that RPC returning {skipped: true} returns skipped."""
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


def test_webhook_rpc_updated_false_returns_user_not_found(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that RPC returning {updated: false} returns user_not_found."""
    mock_supabase_client.rpc.return_value = {
        "updated": False,
        "reason": "user_not_found",
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
    assert response.json()["status"] == "user_not_found"


def test_webhook_rpc_returns_none_user_not_found(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that RPC returning None returns user_not_found."""
    mock_supabase_client.rpc.return_value = None

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
    assert response.json()["status"] == "user_not_found"


def test_webhook_rpc_returns_empty_dict_user_not_found(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that RPC returning empty dict returns user_not_found."""
    mock_supabase_client.rpc.return_value = {}

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
    assert response.json()["status"] == "user_not_found"
