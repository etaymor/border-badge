"""Schemas for social media ingest endpoints."""

from datetime import datetime
from enum import Enum
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SocialProvider(str, Enum):
    """Social media provider type."""

    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"


class SocialIngestRequest(BaseModel):
    """Request to ingest a social media URL."""

    url: str = Field(..., min_length=10, max_length=2048)
    caption: str | None = Field(None, max_length=2000)

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Validate URL is well-formed and from supported providers."""
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("URL must use HTTP or HTTPS")
        if not parsed.netloc:
            raise ValueError("URL must have a valid host")
        return v


class DetectedPlace(BaseModel):
    """Place candidate detected from social media content."""

    google_place_id: str | None = None
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    city: str | None = None
    country: str | None = None
    country_code: str | None = None
    confidence: float = Field(0.0, ge=0.0, le=1.0)


class SocialIngestResponse(BaseModel):
    """Response from social media ingest."""

    saved_source_id: UUID
    provider: SocialProvider
    canonical_url: str
    thumbnail_url: str | None = None
    author_handle: str | None = None
    title: str | None = None
    detected_place: DetectedPlace | None = None


class SavedSourceCreate(BaseModel):
    """Data for creating a saved source record."""

    user_id: UUID
    provider: SocialProvider
    original_url: str
    canonical_url: str
    thumbnail_url: str | None = None
    author_handle: str | None = None
    caption: str | None = None
    title: str | None = None
    oembed_data: dict[str, Any] | None = None


class SavedSource(BaseModel):
    """Saved source response model."""

    id: UUID
    user_id: UUID
    provider: SocialProvider
    original_url: str
    canonical_url: str
    thumbnail_url: str | None = None
    author_handle: str | None = None
    caption: str | None = None
    title: str | None = None
    oembed_data: dict[str, Any] | None = None
    entry_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class OEmbedCacheEntry(BaseModel):
    """oEmbed cache entry model."""

    id: UUID
    canonical_url: str
    provider: SocialProvider
    response: dict[str, Any]
    created_at: datetime
    expires_at: datetime


class OEmbedResponse(BaseModel):
    """Normalized oEmbed response from any provider."""

    title: str | None = None
    author_name: str | None = None
    author_url: str | None = None
    thumbnail_url: str | None = None
    thumbnail_width: int | None = None
    thumbnail_height: int | None = None
    html: str | None = None
    provider_name: str | None = None
    provider_url: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class SaveToTripRequest(BaseModel):
    """Request to save a social source to a trip as an entry."""

    saved_source_id: UUID
    trip_id: UUID
    place: DetectedPlace | None = None
    entry_type: str = "place"
    notes: str | None = None
