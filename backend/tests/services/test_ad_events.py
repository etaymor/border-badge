"""Tests for ad event tracking timestamp propagation.

Verifies that client-provided timestamps are forwarded through the full
pipeline: API route → service → platform clients (Facebook CAPI, TikTok).
"""

import time
from unittest.mock import AsyncMock, patch

import pytest

from app.services.ad_events.service import track_ad_event


@pytest.mark.asyncio
async def test_track_ad_event_forwards_timestamp_to_facebook():
    """Client timestamp should be passed to Facebook CAPI send_event."""
    client_ts = int(time.time()) - 60  # 1 minute ago

    with (
        patch(
            "app.services.ad_events.service.facebook_capi.send_event",
            new_callable=AsyncMock,
        ) as mock_fb,
        patch(
            "app.services.ad_events.service.tiktok_events.send_event",
            new_callable=AsyncMock,
        ),
    ):
        await track_ad_event(
            event_name="CompleteRegistration",
            event_id="evt-123",
            user_email="test@example.com",
            user_id="user-abc",
            properties={},
            event_time=client_ts,
        )

        mock_fb.assert_called_once()
        call_kwargs = mock_fb.call_args
        # event_time should be forwarded as a positional or keyword arg
        assert (
            client_ts in call_kwargs.args
            or call_kwargs.kwargs.get("event_time") == client_ts
        )


@pytest.mark.asyncio
async def test_track_ad_event_forwards_timestamp_to_tiktok():
    """Client timestamp should be passed to TikTok send_event."""
    client_ts = int(time.time()) - 60

    with (
        patch(
            "app.services.ad_events.service.facebook_capi.send_event",
            new_callable=AsyncMock,
        ),
        patch(
            "app.services.ad_events.service.tiktok_events.send_event",
            new_callable=AsyncMock,
        ) as mock_tt,
    ):
        await track_ad_event(
            event_name="CompleteRegistration",
            event_id="evt-123",
            user_email="test@example.com",
            user_id="user-abc",
            properties={},
            event_time=client_ts,
        )

        mock_tt.assert_called_once()
        call_kwargs = mock_tt.call_args
        assert (
            client_ts in call_kwargs.args
            or call_kwargs.kwargs.get("event_time") == client_ts
        )


@pytest.mark.asyncio
async def test_track_ad_event_defaults_timestamp_when_none():
    """When no timestamp is provided, platform clients should still be called."""
    with (
        patch(
            "app.services.ad_events.service.facebook_capi.send_event",
            new_callable=AsyncMock,
        ) as mock_fb,
        patch(
            "app.services.ad_events.service.tiktok_events.send_event",
            new_callable=AsyncMock,
        ) as mock_tt,
    ):
        await track_ad_event(
            event_name="CompleteRegistration",
            event_id="evt-123",
            user_email="test@example.com",
            user_id="user-abc",
            properties={},
        )

        mock_fb.assert_called_once()
        mock_tt.assert_called_once()
