"""Schemas for trip and trip_tags endpoints."""

from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, field_validator

from app.core.validators import validate_image_url


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
    country_code: str | None = None  # 2-letter ISO code, nullable for system trips
    cover_image_url: str | None = None
    date_start: date | None = None
    date_end: date | None = None

    @field_validator("cover_image_url")
    @classmethod
    def validate_cover_image_url(cls, v: str | None) -> str | None:
        """Validate cover image URL uses https protocol."""
        return validate_image_url(v)


class TripCreate(BaseModel):
    """Request to create a trip."""

    name: str
    country_code: str  # Required for user-created trips
    cover_image_url: str | None = None
    date_start: date | None = None
    date_end: date | None = None
    tagged_user_ids: list[UUID] | None = None

    @field_validator("cover_image_url")
    @classmethod
    def validate_cover_image_url(cls, v: str | None) -> str | None:
        """Validate cover image URL uses https protocol."""
        return validate_image_url(v)


class TripUpdate(BaseModel):
    """Request to update a trip."""

    name: str | None = None
    country_code: str | None = None  # 2-letter ISO code; rejected for system trips
    cover_image_url: str | None = None
    date_start: date | None = None
    date_end: date | None = None

    @field_validator("cover_image_url")
    @classmethod
    def validate_cover_image_url(cls, v: str | None) -> str | None:
        """Validate cover image URL uses https protocol."""
        return validate_image_url(v)


class Trip(BaseModel):
    """Trip response model."""

    id: UUID
    user_id: UUID
    country_id: UUID | None = None  # Nullable for system trips
    country_code: str | None = (
        None  # ISO 3166-1 alpha-2 code, nullable for system trips
    )
    name: str
    cover_image_url: str | None = None
    date_range: str | None = None  # PostgreSQL daterange as string
    is_system: bool = False  # True for uncategorized/system trips
    created_at: datetime
    deleted_at: datetime | None = None


class UncategorizedTrip(Trip):
    """Uncategorized trip with entry count."""

    entry_count: int = 0


class TripWithTags(Trip):
    """Trip with nested tags."""

    tags: list[TripTag] = []


class TripTagAction(BaseModel):
    """Response for approve/decline actions."""

    status: TripTagStatus
    responded_at: datetime
