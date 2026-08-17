"""Malformed payload tests for RevenueCat webhook."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from tests.conftest import TEST_USER_ID


def test_webhook_missing_event_object(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that missing event object is handled gracefully."""
    response = client.post(
        "/webhooks/revenuecat",
        json={},
        headers=webhook_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"
    assert response.json()["reason"] == "no_user_id"


def test_webhook_missing_app_user_id(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that missing app_user_id returns ignored."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "id": "evt_123",
            "event_timestamp_ms": 1704067200000,
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ignored"
    assert data["reason"] == "no_user_id"


def test_webhook_empty_app_user_id(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that empty string app_user_id returns ignored."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": "",
            "event_timestamp_ms": 1704067200000,
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    assert response.json()["reason"] == "no_user_id"


def test_webhook_invalid_uuid_format(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that invalid UUID format returns ignored with invalid_user_id."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": "not-a-valid-uuid",
            "event_timestamp_ms": 1704067200000,
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ignored"
    assert data["reason"] == "invalid_user_id"


def test_webhook_missing_event_timestamp_ms(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that missing event_timestamp_ms returns ignored."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": TEST_USER_ID,
            "id": "evt_123",
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ignored"
    assert data["reason"] == "invalid_timestamp"


def test_webhook_non_integer_event_timestamp_ms(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that string timestamp returns ignored."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": TEST_USER_ID,
            "event_timestamp_ms": "1704067200000",  # String, not int
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    assert response.json()["reason"] == "invalid_timestamp"


def test_webhook_float_event_timestamp_ms(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that float timestamp returns ignored (must be int)."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": TEST_USER_ID,
            "event_timestamp_ms": 1704067200000.5,  # Float
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    assert response.json()["reason"] == "invalid_timestamp"


def test_webhook_negative_event_timestamp_ms(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that negative timestamp returns ignored."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": TEST_USER_ID,
            "event_timestamp_ms": -1704067200000,
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    assert response.json()["reason"] == "invalid_timestamp"


def test_webhook_zero_event_timestamp_ms(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that zero timestamp returns ignored."""
    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": TEST_USER_ID,
            "event_timestamp_ms": 0,
        }
    }
    response = client.post(
        "/webhooks/revenuecat",
        json=payload,
        headers=webhook_headers,
    )
    assert response.status_code == 200
    assert response.json()["reason"] == "invalid_timestamp"


def test_webhook_invalid_expiration_type_string(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    mock_supabase_client: AsyncMock,
    webhook_headers: dict[str, str],
) -> None:
    """Test that string expiration_at_ms is gracefully handled (skipped)."""
    mock_supabase_client.rpc.return_value = {"updated": True}

    payload = {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": TEST_USER_ID,
            "event_timestamp_ms": 1704067200000,
            "expiration_at_ms": "1735689600000",  # String instead of int
        }
    }

    with patch(
        "app.api.webhooks.get_service_supabase_client",
        return_value=mock_supabase_client,
    ):
        response = client.post(
            "/webhooks/revenuecat",
            json=payload,
            headers=webhook_headers,
        )

    # Should still succeed, expires_at will be None
    assert response.status_code == 200
    # Verify RPC was called with None for p_expires_at
    call_args = mock_supabase_client.rpc.call_args
    rpc_params = call_args[0][1]
    assert rpc_params["p_expires_at"] is None


def test_webhook_empty_payload(
    client: TestClient,
    mock_settings,  # noqa: ARG001
    webhook_headers: dict[str, str],
) -> None:
    """Test that empty JSON payload returns ignored."""
    response = client.post(
        "/webhooks/revenuecat",
        json={},
        headers=webhook_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"
