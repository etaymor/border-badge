"""Pydantic schemas for ad event tracking."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class AdEventRequest(BaseModel):
    """Request body for tracking an ad conversion event."""

    event_name: Literal[
        "CompleteRegistration",
        "StartTrial",
        "Subscribe",
        "FirstTripCreated",
        "FirstPhotoImport",
    ]
    event_id: str
    properties: dict[str, Any] = Field(default_factory=dict)
    timestamp: int = Field(
        description="Client-side Unix epoch seconds when the event occurred.",
    )
