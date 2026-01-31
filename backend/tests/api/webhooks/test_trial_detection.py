"""Trial detection tests for RevenueCat webhook."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def test_webhook_trial_period_sets_trial_status(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that period_type=TRIAL overrides status to trial."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    base_event["event"]["period_type"] = "TRIAL"

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
    assert rpc_params["p_status"] == "trial"


def test_webhook_normal_period_keeps_premium(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that period_type=NORMAL keeps premium status."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    base_event["event"]["period_type"] = "NORMAL"

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
    assert rpc_params["p_status"] == "premium"


def test_webhook_missing_period_type_defaults_premium(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that missing period_type defaults to premium."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    del base_event["event"]["period_type"]

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
    assert rpc_params["p_status"] == "premium"
