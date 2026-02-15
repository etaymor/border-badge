"""Tests for ad event tracking.

Covers:
- Service fan-out (timestamp propagation, concurrent dispatch, error isolation)
- Facebook CAPI (event name mapping, PII hashing, revenue handling, dedup ID)
- TikTok Events API (event name mapping, payload structure, revenue handling)
- PII hashing utility
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.ad_events.service import track_ad_event
from app.services.ad_events.utils import hash_pii_sha256

# ---------------------------------------------------------------------------
# PII hashing
# ---------------------------------------------------------------------------


class TestHashPii:
    def test_hashes_email_to_sha256(self):
        result = hash_pii_sha256("test@example.com")
        # SHA-256 produces 64 hex chars
        assert len(result) == 64
        assert result.isalnum()

    def test_lowercases_before_hashing(self):
        assert hash_pii_sha256("Test@Example.COM") == hash_pii_sha256("test@example.com")

    def test_strips_whitespace_before_hashing(self):
        assert hash_pii_sha256("  test@example.com  ") == hash_pii_sha256("test@example.com")

    def test_deterministic(self):
        assert hash_pii_sha256("hello") == hash_pii_sha256("hello")

    def test_different_inputs_different_hashes(self):
        assert hash_pii_sha256("a@b.com") != hash_pii_sha256("c@d.com")


# ---------------------------------------------------------------------------
# Service fan-out
# ---------------------------------------------------------------------------


class TestTrackAdEvent:
    @pytest.mark.asyncio
    async def test_forwards_timestamp_to_facebook(self):
        client_ts = int(time.time()) - 60

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
            assert mock_fb.call_args.kwargs.get("event_time") == client_ts

    @pytest.mark.asyncio
    async def test_forwards_timestamp_to_tiktok(self):
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
            assert mock_tt.call_args.kwargs.get("event_time") == client_ts

    @pytest.mark.asyncio
    async def test_defaults_timestamp_when_none(self):
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

    @pytest.mark.asyncio
    async def test_facebook_failure_does_not_block_tiktok(self):
        """Error isolation: one platform failing shouldn't affect the other."""
        with (
            patch(
                "app.services.ad_events.service.facebook_capi.send_event",
                new_callable=AsyncMock,
                side_effect=RuntimeError("FB down"),
            ),
            patch(
                "app.services.ad_events.service.tiktok_events.send_event",
                new_callable=AsyncMock,
            ) as mock_tt,
        ):
            # Should not raise
            await track_ad_event(
                event_name="Subscribe",
                event_id="evt-456",
                user_email="user@test.com",
                user_id="user-xyz",
                properties={"plan": "annual", "price": 49.99, "currency": "USD"},
            )

            mock_tt.assert_called_once()

    @pytest.mark.asyncio
    async def test_tiktok_failure_does_not_block_facebook(self):
        with (
            patch(
                "app.services.ad_events.service.facebook_capi.send_event",
                new_callable=AsyncMock,
            ) as mock_fb,
            patch(
                "app.services.ad_events.service.tiktok_events.send_event",
                new_callable=AsyncMock,
                side_effect=RuntimeError("TT down"),
            ),
        ):
            await track_ad_event(
                event_name="Subscribe",
                event_id="evt-789",
                user_email="user@test.com",
                user_id="user-xyz",
                properties={},
            )

            mock_fb.assert_called_once()

    @pytest.mark.asyncio
    async def test_forwards_all_arguments(self):
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
                event_name="Subscribe",
                event_id="evt-sub",
                user_email="a@b.com",
                user_id="uid-1",
                properties={"plan": "annual", "price": 49.99},
                event_time=1700000000,
            )

            # Service passes positional args to platform clients
            fb_args = mock_fb.call_args.args
            assert fb_args[0] == "Subscribe"  # event_name
            assert fb_args[1] == "evt-sub"  # event_id
            assert fb_args[2] == "a@b.com"  # user_email

            tt_args = mock_tt.call_args.args
            assert tt_args[0] == "Subscribe"  # event_name
            assert tt_args[1] == "a@b.com"  # user_email


# ---------------------------------------------------------------------------
# Facebook CAPI
# ---------------------------------------------------------------------------


class TestFacebookCapi:
    @pytest.mark.asyncio
    async def test_skips_when_not_configured(self):
        """Should silently skip when pixel_id or access_token is missing."""
        import app.services.ad_events.facebook_capi as fb

        fb._initialized = False

        with patch("app.services.ad_events.facebook_capi.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                facebook_pixel_id="",
                facebook_capi_access_token="",
            )
            # Should not raise
            await fb.send_event(
                event_name="CompleteRegistration",
                event_id="evt-1",
                user_email="test@example.com",
                user_id="user-1",
                properties={},
            )

    def test_maps_event_names_correctly(self):
        from app.services.ad_events.facebook_capi import EVENT_NAME_MAP

        assert EVENT_NAME_MAP["CompleteRegistration"] == "CompleteRegistration"
        assert EVENT_NAME_MAP["StartTrial"] == "StartTrial"
        assert EVENT_NAME_MAP["Subscribe"] == "Purchase"
        assert EVENT_NAME_MAP["FirstTripCreated"] == "Lead"
        assert EVENT_NAME_MAP["FirstPhotoImport"] == "ViewContent"

    @pytest.mark.asyncio
    async def test_includes_revenue_for_subscribe_with_price(self):
        """Subscribe events with price > 0 should include CustomData with value."""
        import app.services.ad_events.facebook_capi as fb

        fb._initialized = True

        with (
            patch("app.services.ad_events.facebook_capi.get_settings") as mock_settings,
            patch("app.services.ad_events.facebook_capi.EventRequest") as MockEventRequest,
            patch("app.services.ad_events.facebook_capi.Event") as MockEvent,
        ):
            mock_settings.return_value = MagicMock(
                facebook_pixel_id="123",
                facebook_capi_access_token="tok",
            )
            mock_req_instance = MagicMock()
            mock_req_instance.execute.return_value = {"events_received": 1}
            MockEventRequest.return_value = mock_req_instance

            await fb.send_event(
                event_name="Subscribe",
                event_id="evt-sub",
                user_email="a@b.com",
                user_id="uid-1",
                properties={"plan": "annual", "price": 49.99, "currency": "USD"},
            )

            event_kwargs = MockEvent.call_args.kwargs
            assert event_kwargs["custom_data"] is not None

    @pytest.mark.asyncio
    async def test_omits_revenue_for_subscribe_with_zero_price(self):
        """Subscribe events with price=0 should NOT include revenue CustomData."""
        import app.services.ad_events.facebook_capi as fb

        fb._initialized = True

        with (
            patch("app.services.ad_events.facebook_capi.get_settings") as mock_settings,
            patch("app.services.ad_events.facebook_capi.EventRequest") as MockEventRequest,
            patch("app.services.ad_events.facebook_capi.Event") as MockEvent,
        ):
            mock_settings.return_value = MagicMock(
                facebook_pixel_id="123",
                facebook_capi_access_token="tok",
            )
            mock_req_instance = MagicMock()
            mock_req_instance.execute.return_value = {"events_received": 1}
            MockEventRequest.return_value = mock_req_instance

            await fb.send_event(
                event_name="Subscribe",
                event_id="evt-sub",
                user_email="a@b.com",
                user_id="uid-1",
                properties={"plan": "annual", "price": 0},
            )

            event_kwargs = MockEvent.call_args.kwargs
            assert event_kwargs["custom_data"] is None

    @pytest.mark.asyncio
    async def test_hashes_email_and_user_id(self):
        """PII should be hashed before sending to Facebook."""
        import app.services.ad_events.facebook_capi as fb

        fb._initialized = True

        with (
            patch("app.services.ad_events.facebook_capi.get_settings") as mock_settings,
            patch("app.services.ad_events.facebook_capi.EventRequest") as MockEventRequest,
            patch("app.services.ad_events.facebook_capi.Event"),
            patch("app.services.ad_events.facebook_capi.UserData") as MockUserData,
        ):
            mock_settings.return_value = MagicMock(
                facebook_pixel_id="123",
                facebook_capi_access_token="tok",
            )
            mock_req_instance = MagicMock()
            mock_req_instance.execute.return_value = {"events_received": 1}
            MockEventRequest.return_value = mock_req_instance

            await fb.send_event(
                event_name="CompleteRegistration",
                event_id="evt-1",
                user_email="Test@Example.COM",
                user_id="user-123",
                properties={},
            )

            user_data_kwargs = MockUserData.call_args.kwargs
            external_id = user_data_kwargs["external_ids"][0]
            assert external_id != "user-123"
            assert len(external_id) == 64  # SHA-256 hex


# ---------------------------------------------------------------------------
# TikTok Events API
# ---------------------------------------------------------------------------


class TestTiktokEvents:
    @pytest.mark.asyncio
    async def test_skips_when_not_configured(self):
        """Should silently skip when access_token or pixel_code is missing."""
        import app.services.ad_events.tiktok_events as tt

        with patch("app.services.ad_events.tiktok_events.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                tiktok_events_access_token="",
                tiktok_pixel_code="",
            )
            await tt.send_event(
                event_name="CompleteRegistration",
                user_email="test@example.com",
                user_id="user-1",
                properties={},
            )

    def test_maps_event_names_correctly(self):
        from app.services.ad_events.tiktok_events import EVENT_NAME_MAP

        assert EVENT_NAME_MAP["CompleteRegistration"] == "CompleteRegistration"
        assert EVENT_NAME_MAP["StartTrial"] == "Subscribe"
        assert EVENT_NAME_MAP["Subscribe"] == "CompletePayment"
        assert EVENT_NAME_MAP["FirstTripCreated"] == "AddToCart"
        assert EVENT_NAME_MAP["FirstPhotoImport"] == "ViewContent"

    @pytest.mark.asyncio
    async def test_sends_correct_payload_structure(self):
        import app.services.ad_events.tiktok_events as tt

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"code": 0}
        mock_client.post.return_value = mock_response

        with (
            patch("app.services.ad_events.tiktok_events.get_settings") as mock_settings,
            patch(
                "app.services.ad_events.tiktok_events.get_http_client",
                return_value=mock_client,
            ),
        ):
            mock_settings.return_value = MagicMock(
                tiktok_events_access_token="tok",
                tiktok_pixel_code="px123",
            )

            await tt.send_event(
                event_name="CompleteRegistration",
                user_email="a@b.com",
                user_id="uid-1",
                properties={},
                event_time=1700000000,
            )

            call_kwargs = mock_client.post.call_args
            payload = call_kwargs.kwargs["json"]["data"][0]
            assert payload["pixel_code"] == "px123"
            assert payload["event"] == "CompleteRegistration"
            assert payload["timestamp"] == 1700000000
            assert "email" in payload["context"]["user"]
            assert "external_id" in payload["context"]["user"]
            # PII should be hashed
            assert payload["context"]["user"]["email"] != "a@b.com"

    @pytest.mark.asyncio
    async def test_includes_revenue_for_subscribe_with_price(self):
        import app.services.ad_events.tiktok_events as tt

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"code": 0}
        mock_client.post.return_value = mock_response

        with (
            patch("app.services.ad_events.tiktok_events.get_settings") as mock_settings,
            patch(
                "app.services.ad_events.tiktok_events.get_http_client",
                return_value=mock_client,
            ),
        ):
            mock_settings.return_value = MagicMock(
                tiktok_events_access_token="tok",
                tiktok_pixel_code="px123",
            )

            await tt.send_event(
                event_name="Subscribe",
                user_email="a@b.com",
                user_id="uid-1",
                properties={"price": 49.99, "currency": "USD"},
            )

            payload = mock_client.post.call_args.kwargs["json"]["data"][0]
            assert payload["properties"]["value"] == "49.99"
            assert payload["properties"]["currency"] == "USD"

    @pytest.mark.asyncio
    async def test_omits_revenue_for_subscribe_with_zero_price(self):
        import app.services.ad_events.tiktok_events as tt

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"code": 0}
        mock_client.post.return_value = mock_response

        with (
            patch("app.services.ad_events.tiktok_events.get_settings") as mock_settings,
            patch(
                "app.services.ad_events.tiktok_events.get_http_client",
                return_value=mock_client,
            ),
        ):
            mock_settings.return_value = MagicMock(
                tiktok_events_access_token="tok",
                tiktok_pixel_code="px123",
            )

            await tt.send_event(
                event_name="Subscribe",
                user_email="a@b.com",
                user_id="uid-1",
                properties={"price": 0},
            )

            payload = mock_client.post.call_args.kwargs["json"]["data"][0]
            assert "value" not in payload.get("properties", {})
