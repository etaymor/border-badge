"""Schemas for user profile endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ProfileUpdate(BaseModel):
    """Request to update user profile preferences."""

    home_country_code: str | None = None
    travel_motives: list[str] | None = None
    persona_tags: list[str] | None = None


class Profile(BaseModel):
    """User profile response model."""

    id: UUID
    user_id: UUID
    display_name: str
    avatar_url: str | None = None
    home_country_code: str | None = None
    travel_motives: list[str] = []
    persona_tags: list[str] = []
    created_at: datetime
    updated_at: datetime | None = None
