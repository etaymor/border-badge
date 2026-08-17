"""Schemas for social media ingest endpoints."""

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SocialProvider(str, Enum):
    """Social media provider type."""

    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"


# Video frame validation limits (DoS prevention)
MAX_FRAMES_FROM_CLIENT = 20  # Max number of frames client can send
MAX_FRAME_BASE64_LENGTH = 2_000_000  # ~1.5MB decoded (base64 is ~4/3 original size)


class SocialIngestRequest(BaseModel):
    """Request to ingest a social media URL."""

    url: str = Field(..., min_length=10, max_length=2048)
    caption: str | None = Field(None, max_length=2000)
    # Base64-encoded JPEG/PNG frames sampled on-device (optional)
    # Limited to prevent DoS via memory/CPU exhaustion
    video_frames: list[str] | None = Field(None, max_length=MAX_FRAMES_FROM_CLIENT)
    # Extraction method preference for agent-native control
    extraction_method: Literal["auto", "llm", "regex"] = "auto"
    # Skip cache lookup and force fresh extraction (for cache invalidation)
    skip_cache: bool = False

    @field_validator("video_frames")
    @classmethod
    def validate_frame_sizes(cls, v: list[str] | None) -> list[str] | None:
        """Validate individual frame sizes to prevent DoS via oversized payloads."""
        if v is None:
            return v
        for i, frame in enumerate(v):
            if len(frame) > MAX_FRAME_BASE64_LENGTH:
                raise ValueError(
                    f"Frame {i} exceeds maximum size of {MAX_FRAME_BASE64_LENGTH} characters"
                )
        return v

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
    name: str = Field(..., max_length=200)
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
    # LLM-predicted entry type for automatic categorization (Place|Stay|Food|Experience)
    llm_entry_type: Literal["place", "food", "stay", "experience"] | None = None


class DetectedCountry(BaseModel):
    """Country detected from social media content via location hints.

    Returned even when a specific place couldn't be detected, allowing the
    client to default trips to this country and bias place autocomplete.
    """

    country_code: str = Field(..., min_length=2, max_length=2)
    country_name: str
    latitude: float | None = None
    longitude: float | None = None


class SuggestedTrip(BaseModel):
    """A trip suggested for saving detected places.

    Used by agents to batch-save without interactive trip selection.
    """

    id: UUID
    name: str
    country_code: str | None = None
    is_system: bool = False  # True for "Saved Places" system trip


class SocialIngestResponse(BaseModel):
    """Response from social media ingest.

    Returns oEmbed metadata and detected place(s) without persisting to saved_source.
    The client should pass this data to /ingest/save-to-trip or /ingest/save-places when saving.
    """

    provider: SocialProvider
    canonical_url: str
    thumbnail_url: str | None = None
    author_handle: str | None = None
    title: str | None = None
    # Multi-place extraction: array of all detected places (max 10)
    detected_places: list[DetectedPlace] = []
    # DEPRECATED: keep for backward compat, populated with first place from detected_places
    detected_place: DetectedPlace | None = None
    # Country hint even when place detection fails (for trip defaulting & autocomplete bias)
    detected_country: DetectedCountry | None = None
    # Extraction method used (llm, regex, video, or none if no place detected)
    extraction_method_used: Literal["llm", "regex", "video", "none"] | None = None
    # Extraction source for multi-place (caption, video_frames, carousel, screenshot)
    extraction_source: (
        Literal["caption", "video_frames", "carousel", "screenshot"] | None
    ) = None
    # Extraction latency in milliseconds
    extraction_latency_ms: int | None = None
    # Context location detected from content (e.g., "Thailand") - used as search bias
    context_location: str | None = None
    # Suggested trips for agent-native batch save (matching country first, then "Saved Places")
    suggested_trips: list["SuggestedTrip"] = []
    # User-facing error message when extraction fails due to platform limitations
    extraction_error: str | None = None


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


class PlaceToSave(BaseModel):
    """A single place to be saved in a batch operation."""

    google_place_id: str = Field(..., min_length=1, max_length=512)
    name: str = Field(..., min_length=1, max_length=256)
    entry_type: Literal["place", "food", "stay", "experience"] = Field("place")
    address: str | None = Field(None, max_length=512)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    city: str | None = Field(None, max_length=200)
    country: str | None = Field(None, max_length=200)
    country_code: str | None = Field(None, min_length=2, max_length=2)
    google_photo_url: str | None = Field(None, max_length=2048)


class SavePlacesRequest(BaseModel):
    """Request to save multiple places from a social media post to a trip.

    Used for multi-place extraction where a single post contains multiple places.
    """

    trip_id: UUID
    places: list[PlaceToSave] = Field(..., min_length=1, max_length=20)
    # Ingest data (from social media)
    provider: SocialProvider
    canonical_url: str = Field(..., max_length=2048)
    thumbnail_url: str | None = Field(None, max_length=2048)
    author_handle: str | None = Field(None, max_length=256)
    title: str | None = Field(None, max_length=2200)
    # Notes applied to all entries
    notes: str | None = Field(None, max_length=5000)


class SavePlaceResult(BaseModel):
    """Result for a single place in a batch save operation."""

    place_name: str
    status: Literal["saved", "duplicate", "error"]
    entry_id: UUID | None = None
    error_message: str | None = None


class SavePlacesResponse(BaseModel):
    """Response from batch save operation."""

    saved_count: int
    skipped_count: int  # Duplicates that were skipped
    saved_entry_ids: list[UUID]
    skipped_place_names: list[str] = []  # Names of places that were skipped
    # Per-place status for detailed error handling
    results: list[SavePlaceResult] = []


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
    # Instagram captions can be up to 2200 chars, allow full caption
    title: str | None = Field(None, max_length=2200)
    # User-provided data
    place: DetectedPlace | None = None
    entry_type: Literal["place", "food", "stay", "experience"] = Field("place")
    notes: str | None = Field(None, max_length=2000)
