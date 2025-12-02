"""Schemas for entry and place endpoints."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel


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
    metadata: dict[str, Any] | None = None
    date: datetime | None = None


class EntryCreate(EntryBase):
    """Request to create an entry."""

    place: PlaceCreate | None = None


class EntryUpdate(BaseModel):
    """Request to update an entry."""

    title: str | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None
    date: datetime | None = None


class Entry(BaseModel):
    """Entry response model."""

    id: UUID
    trip_id: UUID
    type: EntryType
    title: str
    notes: str | None = None
    metadata: dict[str, Any] | None = None
    date: datetime | None = None
    created_at: datetime
    deleted_at: datetime | None = None


class EntryWithPlace(Entry):
    """Entry with optional nested place data."""

    place: Place | None = None
