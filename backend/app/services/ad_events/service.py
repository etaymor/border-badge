"""Ad events fan-out service.

Orchestrates sending conversion events to both Facebook CAPI and TikTok
Events API concurrently. Failures in one platform don't affect the other.
"""

import asyncio
import logging

from app.services.ad_events import facebook_capi, tiktok_events

logger = logging.getLogger(__name__)


async def track_ad_event(
    event_name: str,
    event_id: str,
    user_email: str | None,
    user_id: str,
    properties: dict,
) -> None:
    """Fan out ad event to Facebook CAPI and TikTok Events API concurrently.

    Args:
        event_name: Internal event name (each platform maps to its own name).
        event_id: Shared event ID for Facebook client/server deduplication.
        user_email: User's email for matching (hashed by each client).
        user_id: Supabase user ID.
        properties: Additional event properties from the mobile client.
    """
    results = await asyncio.gather(
        facebook_capi.send_event(event_name, event_id, user_email, user_id, properties),
        tiktok_events.send_event(event_name, user_email, user_id, properties),
        return_exceptions=True,
    )

    for i, result in enumerate(results):
        if isinstance(result, Exception):
            platform = "Facebook CAPI" if i == 0 else "TikTok Events"
            logger.error("%s event failed for %s: %s", platform, event_name, result)
