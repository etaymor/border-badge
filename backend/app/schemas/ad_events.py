"""Pydantic schemas for ad event tracking."""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("properties")
    @classmethod
    def validate_properties(cls, v: dict[str, Any]) -> dict[str, Any]:
        if "price" in v:
            try:
                float(v["price"])
            except (ValueError, TypeError):
                raise ValueError("price must be numeric") from None
        return v
