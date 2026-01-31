"""Shared fixtures for webhook tests."""

from typing import Any
from unittest.mock import patch

import pytest

from tests.conftest import TEST_USER_ID


@pytest.fixture
def valid_webhook_secret() -> str:
    """Valid webhook authorization secret."""
    return "Bearer test-webhook-secret-123"


@pytest.fixture
def webhook_headers(valid_webhook_secret: str) -> dict[str, str]:
    """Headers with valid webhook authorization."""
    return {"Authorization": valid_webhook_secret}


@pytest.fixture
def base_event() -> dict[str, Any]:
    """Base RevenueCat event payload."""
    return {
        "event": {
            "type": "INITIAL_PURCHASE",
            "app_user_id": TEST_USER_ID,
            "id": "evt_123456",
            "product_id": "com.atlasi.Premium.Monthly",
            "period_type": "NORMAL",
            "expiration_at_ms": 1735689600000,  # 2025-01-01
            "event_timestamp_ms": 1704067200000,  # 2024-01-01
            "original_app_user_id": f"rc_{TEST_USER_ID}",
        }
    }


@pytest.fixture
def mock_settings(valid_webhook_secret: str):
    """Mock settings with webhook auth configured."""
    with patch("app.api.webhooks.settings") as mock:
        mock.revenuecat_webhook_auth_header = valid_webhook_secret
        yield mock
