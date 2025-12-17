"""Schemas for traveler classification endpoint."""

from pydantic import BaseModel, Field


class TravelerClassificationRequest(BaseModel):
    """Request to classify a traveler based on their visited countries."""

    countries_visited: list[str] = Field(
        ..., min_length=1, description="Country codes (e.g., ['US', 'JP', 'FR'])"
    )
    interest_tags: list[str] = Field(
        default=[], description="Optional interest tags for classification hints"
    )


class TravelerClassificationResponse(BaseModel):
    """Response with traveler classification results."""

    traveler_type: str = Field(
        ..., description="2-4 word traveler type label, Title Case"
    )
    signature_country: str = Field(
        ..., description="Country code representing their travel identity"
    )
    confidence: float = Field(..., ge=0, le=1, description="Classification confidence")
    rationale_short: str = Field(
        ..., max_length=100, description="Brief explanation of classification"
    )
