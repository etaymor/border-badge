"""API route for ad event tracking.

Receives ad events from the mobile app and fans them out to
Facebook Conversions API and TikTok Events API server-side.
"""

import logging

from fastapi import APIRouter

from app.core.security import CurrentUser
from app.schemas.ad_events import AdEventRequest
from app.services.ad_events import track_ad_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ad-events", tags=["ad-events"])


@router.post("")
async def post_ad_event(body: AdEventRequest, user: CurrentUser) -> dict:
    """Receive ad event from mobile client, fan out to FB CAPI + TikTok."""
    await track_ad_event(
        event_name=body.event_name,
        event_id=body.event_id,
        user_email=user.email,
        user_id=str(user.id),
        properties=body.properties,
    )
    return {"status": "ok"}
