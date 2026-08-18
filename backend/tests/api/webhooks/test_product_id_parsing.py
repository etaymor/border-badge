"""Product ID parsing tests for RevenueCat webhook."""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    "product_id,expected_plan",
    [
        ("com.atlasi.Premium.Annual", "annual"),
        ("com.atlasi.premium.annual", "annual"),
        ("com.atlasi.Premium.yearly", "annual"),
        ("com.atlasi.Premium.Monthly", "monthly"),
        ("com.atlasi.premium.monthly", "monthly"),
        ("com.atlasi.Premium.Weekly", "weekly"),
        ("com.atlasi.premium.weekly", "weekly"),
    ],
)
def test_webhook_product_id_parsing(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
    product_id: str,
    expected_plan: str,
) -> None:
    """Test various product_id formats are correctly parsed."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    base_event["event"]["product_id"] = product_id

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
    assert rpc_params["p_plan"] == expected_plan


def test_webhook_unknown_product_id_null_plan(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that unknown product_id format results in None plan."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    base_event["event"]["product_id"] = "com.atlasi.Premium.Lifetime"

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
    assert rpc_params["p_plan"] is None


def test_webhook_missing_product_id_null_plan(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
    base_event: dict[str, Any],
) -> None:
    """Test that missing product_id results in None plan."""
    mock_supabase_client.rpc.return_value = {"updated": True}
    del base_event["event"]["product_id"]

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
    assert rpc_params["p_plan"] is None
