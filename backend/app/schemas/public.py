"""Schemas for public web views (trips, landing page)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, field_validator

from app.core.validators import validate_image_url


class PublicTripEntry(BaseModel):
    """Entry data for public trip view with media URLs."""

    id: UUID
    type: str
    title: str
    notes: str | None = None
    place_name: str | None = None
    address: str | None = None
    media_urls: list[str] = []
    place_photo_url: str | None = None
    redirect_url: str | None = None


class PublicTripView(BaseModel):
    """Public view of a shared trip (accessible by share_slug without authentication)."""

    id: UUID
    name: str
    share_slug: str
    country_name: str
    country_code: str
    cover_image_url: str | None = None
    date_range: str | None = None
    created_at: datetime
    entries: list[PublicTripEntry] = []

    @field_validator("cover_image_url")
    @classmethod
    def validate_cover_image_url(cls, v: str | None) -> str | None:
        """Validate cover image URL uses https protocol."""
        return validate_image_url(v)


class TripShareResponse(BaseModel):
    """Response when generating or retrieving a trip share link."""

    share_slug: str
    share_url: str
