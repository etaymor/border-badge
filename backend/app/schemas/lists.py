"""Schemas for shareable list endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ListEntryCreate(BaseModel):
    """Entry to add to a list."""

    entry_id: UUID
    position: int | None = None


class ListCreate(BaseModel):
    """Request to create a shareable list."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    entry_ids: list[UUID] = Field(default_factory=list)


class ListUpdate(BaseModel):
    """Request to update a list."""

    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)


class ListEntriesUpdate(BaseModel):
    """Request to update entries in a list."""

    entry_ids: list[UUID]


class ListEntry(BaseModel):
    """Entry in a list with position."""

    id: UUID
    entry_id: UUID
    position: int
    created_at: datetime


class ListSummary(BaseModel):
    """List summary for list views."""

    id: UUID
    trip_id: UUID
    owner_id: UUID
    name: str
    slug: str
    description: str | None = None
    entry_count: int = 0
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class ListDetail(BaseModel):
    """Full list details with entries."""

    id: UUID
    trip_id: UUID
    owner_id: UUID
    name: str
    slug: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    entries: list[ListEntry] = []


class PublicListEntry(BaseModel):
    """Entry data for public list view with media URLs."""

    id: UUID
    title: str
    type: str
    notes: str | None = None
    link: str | None = None
    place_name: str | None = None
    address: str | None = None
    google_place_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    media_urls: list[str] = []


class PublicListView(BaseModel):
    """Public view of a list (accessible by slug without authentication)."""

    id: UUID
    name: str
    slug: str
    description: str | None = None
    trip_name: str | None = None
    country_name: str | None = None
    created_at: datetime
    entries: list[PublicListEntry] = []
