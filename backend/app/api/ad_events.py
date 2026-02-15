"""API route for ad event tracking.

Receives ad events from the mobile app and fans them out to
Facebook Conversions API and TikTok Events API server-side.
"""

import logging

from fastapi import APIRouter, Request

from app.core.security import CurrentUser
from app.main import limiter
from app.schemas.ad_events import AdEventRequest
from app.services.ad_events import track_ad_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ad-events", tags=["ad-events"])


@router.post("")
@limiter.limit("20/minute")
async def post_ad_event(
    request: Request, body: AdEventRequest, user: CurrentUser
) -> dict:
    """Receive ad event from mobile client, fan out to FB CAPI + TikTok."""
    await track_ad_event(
        event_name=body.event_name,
        event_id=body.event_id,
        user_email=user.email,
        user_id=str(user.id),
        properties=body.properties,
        event_time=body.timestamp,
    )
    return {"status": "ok"}
