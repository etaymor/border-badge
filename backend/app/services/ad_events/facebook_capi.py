"""Facebook Conversions API client.

Sends server-side events to Meta's Conversions API for conversion tracking
and ad optimization. Uses the facebook-business SDK.

Events are deduplicated with the client-side Facebook SDK via shared event_id.
"""

import asyncio
import logging
from typing import Any

from facebook_business.adobjects.serverside.action_source import ActionSource
from facebook_business.adobjects.serverside.custom_data import CustomData
from facebook_business.adobjects.serverside.event import Event
from facebook_business.adobjects.serverside.event_request import EventRequest
from facebook_business.adobjects.serverside.user_data import UserData
from facebook_business.api import FacebookAdsApi

from app.core.config import get_settings
from app.services.ad_events.utils import hash_pii_sha256

logger = logging.getLogger(__name__)

# Map internal event names to Facebook CAPI standard event names
EVENT_NAME_MAP: dict[str, str] = {
    "CompleteRegistration": "CompleteRegistration",
    "StartTrial": "StartTrial",
    "Subscribe": "Purchase",
    "FirstTripCreated": "Lead",
    "FirstPhotoImport": "ViewContent",
}

_initialized = False


def _ensure_initialized() -> bool:
    """Initialize Facebook Ads API if credentials are configured. Returns True if ready."""
    global _initialized
    if _initialized:
        return True

    settings = get_settings()
    if not settings.facebook_pixel_id or not settings.facebook_capi_access_token:
        return False

    try:
        FacebookAdsApi.init(access_token=settings.facebook_capi_access_token)
    except Exception:
        logger.exception("Facebook Ads API init failed (check credentials)")
        return False
    _initialized = True
    return True


async def send_event(
    event_name: str,
    event_id: str,
    user_email: str | None,
    user_id: str,
    properties: dict[str, Any],
    *,
    event_time: int,
) -> None:
    """Send a single event to Facebook Conversions API.

    Args:
        event_name: Internal event name (mapped to FB standard event).
        event_id: Shared event ID for client/server deduplication.
        user_email: User's email for advanced matching (hashed before sending).
        user_id: Supabase user ID (hashed as external_id).
        properties: Additional event properties.
        event_time: Client-side Unix epoch seconds.
    """
    if not _ensure_initialized():
        logger.debug("Facebook CAPI not configured, skipping event: %s", event_name)
        return

    settings = get_settings()
    fb_event_name = EVENT_NAME_MAP.get(event_name, event_name)

    # Build user data with hashed PII for matching
    user_data = UserData(
        external_ids=[hash_pii_sha256(user_id)],
    )
    if user_email:
        user_data.emails = [hash_pii_sha256(user_email)]

    # Build custom data from properties (omit revenue when price is 0 or missing
    # to avoid distorting ROAS calculations)
    custom_data = None
    price = float(properties.get("price", 0))
    if event_name == "Subscribe" and price > 0:
        custom_data = CustomData(
            currency=properties.get("currency", "USD"),
            value=price,
        )

    event = Event(
        event_name=fb_event_name,
        event_time=event_time,
        user_data=user_data,
        custom_data=custom_data,
        event_id=event_id,
        action_source=ActionSource.APP,
    )

    try:
        event_request = EventRequest(
            events=[event],
            pixel_id=settings.facebook_pixel_id,
        )
        response = await asyncio.to_thread(event_request.execute)
        logger.info(
            "Facebook CAPI event sent: %s (events_received=%s)",
            fb_event_name,
            response.get("events_received", "?"),
        )
    except Exception:
        logger.exception("Facebook CAPI event failed: %s", fb_event_name)
