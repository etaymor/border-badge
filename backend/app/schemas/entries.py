"""Schemas for entry and place endpoints."""

from datetime import datetime
from enum import Enum
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, field_validator


class EntryType(str, Enum):
    """Entry type categories."""

    PLACE = "place"
    FOOD = "food"
    STAY = "stay"
    EXPERIENCE = "experience"


class PlaceBase(BaseModel):
    """Base place fields."""

    google_place_id: str | None = None
    place_name: str
    lat: float | None = None
    lng: float | None = None
    address: str | None = None
    extra_data: dict[str, Any] | None = None


class PlaceCreate(PlaceBase):
    """Request to create/update place data."""

    pass


class Place(PlaceBase):
    """Place response model."""

    id: UUID
    entry_id: UUID


class EntryBase(BaseModel):
    """Base entry fields."""

    type: EntryType
    title: str
    notes: str | None = None
    link: str | None = None
    metadata: dict[str, Any] | None = None
    date: datetime | None = None

    @field_validator("link")
    @classmethod
    def validate_link(cls, v: str | None) -> str | None:
        """Validate that link is a well-formed URL if provided."""
        if v is None:
            return v
        parsed = urlparse(v)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError("Link must be a valid URL with scheme and host")
        return v


class EntryCreate(EntryBase):
    """Request to create an entry."""

    place: PlaceCreate | None = None
    pending_media_ids: list[UUID] | None = None  # Media uploaded before entry creation


class EntryUpdate(BaseModel):
    """Request to update an entry."""

    title: str | None = None
    type: EntryType | None = None
    notes: str | None = None
    link: str | None = None
    metadata: dict[str, Any] | None = None
    date: datetime | None = None
    place: PlaceCreate | None = None

    @field_validator("link")
    @classmethod
    def validate_link(cls, v: str | None) -> str | None:
        """Validate that link is a well-formed URL if provided."""
        if v is None:
            return v
        parsed = urlparse(v)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError("Link must be a valid URL with scheme and host")
        return v


class Entry(BaseModel):
    """Entry response model."""

    id: UUID
    trip_id: UUID
    type: EntryType
    title: str
    notes: str | None = None
    link: str | None = None
    metadata: dict[str, Any] | None = None
    date: datetime | None = None
    created_at: datetime
    deleted_at: datetime | None = None


class EntryMediaFile(BaseModel):
    """Media file info for entry responses."""

    id: UUID
    url: str
    thumbnail_url: str | None = None
    status: str


class EntryWithPlace(Entry):
    """Entry with optional nested place and media data."""

    place: Place | None = None
    media_files: list[EntryMediaFile] = []
