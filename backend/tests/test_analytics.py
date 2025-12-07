"""Tests for analytics event logging."""

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

from app.core.analytics import log_landing_viewed, log_list_viewed, log_trip_viewed


def test_log_landing_viewed(caplog: "pytest.LogCaptureFixture") -> None:
    """Test landing page view logging."""
    with caplog.at_level(logging.INFO, logger="analytics"):
        log_landing_viewed()
    assert "page_view: landing" in caplog.text


def test_log_list_viewed(caplog: "pytest.LogCaptureFixture") -> None:
    """Test list page view logging."""
    with caplog.at_level(logging.INFO, logger="analytics"):
        log_list_viewed("best-tacos-abc123")
    assert "page_view: list" in caplog.text
    assert "best-tacos-abc123" in caplog.text


def test_log_trip_viewed(caplog: "pytest.LogCaptureFixture") -> None:
    """Test trip page view logging."""
    with caplog.at_level(logging.INFO, logger="analytics"):
        log_trip_viewed("summer-abc123")
    assert "page_view: trip" in caplog.text
    assert "summer-abc123" in caplog.text
