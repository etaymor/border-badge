"""Schemas for trip and trip_tags endpoints."""

from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class TripTagStatus(str, Enum):
    """Trip tag consent status."""

    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"


class TripTag(BaseModel):
    """Trip tag response model."""

    id: UUID
    trip_id: UUID
    tagged_user_id: UUID
    status: TripTagStatus
    initiated_by: UUID | None = None
    notification_id: str | None = None
    created_at: datetime
    responded_at: datetime | None = None


class TripBase(BaseModel):
    """Base trip fields."""

    name: str
    country_code: str  # 2-letter ISO code, looked up to UUID on backend
    cover_image_url: str | None = None
    date_start: date | None = None
    date_end: date | None = None


class TripCreate(TripBase):
    """Request to create a trip."""

    tagged_user_ids: list[UUID] | None = None


class TripUpdate(BaseModel):
    """Request to update a trip."""

    name: str | None = None
    cover_image_url: str | None = None
    date_start: date | None = None
    date_end: date | None = None


class Trip(BaseModel):
    """Trip response model."""

    id: UUID
    user_id: UUID
    country_id: UUID
    country_code: str  # ISO 3166-1 alpha-2 code
    name: str
    cover_image_url: str | None = None
    date_range: str | None = None  # PostgreSQL daterange as string
    created_at: datetime
    deleted_at: datetime | None = None


class TripWithTags(Trip):
    """Trip with nested tags."""

    tags: list[TripTag] = []


class TripTagAction(BaseModel):
    """Response for approve/decline actions."""

    status: TripTagStatus
    responded_at: datetime
