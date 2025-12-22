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
    # Google Places type information for category inference
    primary_type: str | None = None  # e.g., "restaurant", "hotel", "tourist_attraction"
    types: list[str] = Field(default_factory=list)  # All place types
    google_photo_url: str | None = None


class SocialIngestResponse(BaseModel):
    """Response from social media ingest.

    Returns oEmbed metadata and detected place without persisting to saved_source.
    The client should pass this data to /ingest/save-to-trip when saving.
    """

    provider: SocialProvider
    canonical_url: str
    thumbnail_url: str | None = None
    author_handle: str | None = None
    title: str | None = None
    detected_place: DetectedPlace | None = None


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
    """Request to save a social source to a trip as an entry.

    Includes full ingest data instead of referencing a saved_source_id.
    """

    trip_id: UUID
    # Ingest data (previously from saved_source)
    provider: SocialProvider
    canonical_url: str = Field(..., max_length=2048)
    thumbnail_url: str | None = Field(None, max_length=2048)
    author_handle: str | None = Field(None, max_length=200)
    title: str | None = Field(None, max_length=200)
    # User-provided data
    place: DetectedPlace | None = None
    entry_type: str = Field("place", max_length=50)
    notes: str | None = Field(None, max_length=2000)
