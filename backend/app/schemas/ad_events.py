"""Pydantic schemas for ad event tracking."""

from pydantic import BaseModel


class AdEventRequest(BaseModel):
    """Request body for tracking an ad conversion event."""

    event_name: str
    event_id: str
    properties: dict = {}
    timestamp: int
