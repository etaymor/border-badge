"""Authorization header tests for RevenueCat webhook."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def test_webhook_missing_authorization_header(client: TestClient) -> None:
    """Test that missing Authorization header returns 422 validation error."""
    response = client.post("/webhooks/revenuecat", json={"event": {}})
    assert response.status_code == 422  # FastAPI's Header(...) requires it


def test_webhook_invalid_authorization_header(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    base_event: dict[str, Any],
) -> None:
    """Test that invalid authorization secret returns 401."""
    response = client.post(
        "/webhooks/revenuecat",
        json=base_event,
        headers={"Authorization": "Bearer wrong-secret"},
    )
    assert response.status_code == 401
    assert "Invalid authorization" in response.json()["detail"]


def test_webhook_valid_authorization_header(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that valid authorization allows webhook processing."""
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
    assert response.json()["status"] == "success"


def test_webhook_not_configured_empty_string(
    client: TestClient,
    base_event: dict[str, Any],
) -> None:
    """Test that unconfigured webhook auth (empty string) returns 500."""
    with patch("app.api.webhooks.settings") as mock_settings:
        mock_settings.revenuecat_webhook_auth_header = ""
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers={"Authorization": "Bearer any-secret"},
        )
    assert response.status_code == 500
    assert "Webhook not configured" in response.json()["detail"]


def test_webhook_not_configured_none_value(
    client: TestClient,
    base_event: dict[str, Any],
) -> None:
    """Test that None webhook auth returns 500."""
    with patch("app.api.webhooks.settings") as mock_settings:
        mock_settings.revenuecat_webhook_auth_header = None
        response = client.post(
            "/webhooks/revenuecat",
            json=base_event,
            headers={"Authorization": "Bearer any-secret"},
        )
    assert response.status_code == 500
