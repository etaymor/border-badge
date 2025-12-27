"""Schemas for user profile endpoints."""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class TrackingPreference(str, Enum):
    """Country tracking preference options."""

    CLASSIC = "classic"
    UN_COMPLETE = "un_complete"
    EXPLORER_PLUS = "explorer_plus"
    FULL_ATLAS = "full_atlas"


class ProfileUpdate(BaseModel):
    """Request to update user profile preferences."""

    username: str | None = None
    display_name: str | None = None
    home_country_code: str | None = None
    travel_motives: list[str] | None = None
    persona_tags: list[str] | None = None
    tracking_preference: TrackingPreference | None = None


class Profile(BaseModel):
    """User profile response model."""

    id: UUID
    user_id: UUID
    username: str
    display_name: str
    avatar_url: str | None = None
    home_country_code: str | None = None
    travel_motives: list[str] = []
    persona_tags: list[str] = []
    tracking_preference: TrackingPreference = TrackingPreference.FULL_ATLAS
    created_at: datetime
    updated_at: datetime | None = None
