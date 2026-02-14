"""TikTok Events API client.

Sends server-side events to TikTok's Events API for conversion tracking.
Uses direct HTTP calls via httpx (no client SDK needed).
"""

import hashlib
import logging
import time

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

TIKTOK_EVENTS_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/"

# Map internal event names to TikTok event names
EVENT_NAME_MAP: dict[str, str] = {
    "CompleteRegistration": "CompleteRegistration",
    "StartTrial": "Subscribe",
    "Subscribe": "CompletePayment",
    "FirstTripCreated": "AddToCart",
    "FirstPhotoImport": "ViewContent",
}


def _hash_sha256(value: str) -> str:
    """Normalize and SHA-256 hash a value for TikTok matching."""
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()


async def send_event(
    event_name: str,
    user_email: str | None,
    user_id: str,
    properties: dict,
) -> None:
    """Send a single event to TikTok Events API.

    Args:
        event_name: Internal event name (mapped to TikTok event).
        user_email: User's email for matching (hashed before sending).
        user_id: Supabase user ID (hashed as external_id).
        properties: Additional event properties.
    """
    settings = get_settings()
    if not settings.tiktok_events_access_token or not settings.tiktok_pixel_code:
        logger.debug("TikTok Events API not configured, skipping event: %s", event_name)
        return

    tt_event_name = EVENT_NAME_MAP.get(event_name, event_name)

    # Build user context with hashed identifiers
    user_context: dict = {
        "external_id": _hash_sha256(user_id),
    }
    if user_email:
        user_context["email"] = _hash_sha256(user_email)

    # Build event properties
    event_properties: dict = {}
    if event_name == "Subscribe" and "price" in properties:
        event_properties["currency"] = properties.get("currency", "USD")
        event_properties["value"] = str(properties.get("price", 0))
    if event_name == "StartTrial":
        event_properties["content_type"] = "subscription"

    payload = {
        "pixel_code": settings.tiktok_pixel_code,
        "event": tt_event_name,
        "timestamp": int(time.time()),
        "context": {
            "user": user_context,
        },
        "properties": event_properties if event_properties else None,
    }

    # Remove None values
    payload = {k: v for k, v in payload.items() if v is not None}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                TIKTOK_EVENTS_URL,
                json={"data": [payload]},
                headers={
                    "Access-Token": settings.tiktok_events_access_token,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            result = response.json()
            logger.info(
                "TikTok event sent: %s (code=%s)",
                tt_event_name,
                result.get("code", "?"),
            )
    except Exception:
        logger.exception("TikTok event failed: %s", tt_event_name)
