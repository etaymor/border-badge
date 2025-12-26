"""Activity feed schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FeedItem(BaseModel):
    """Activity feed item."""

    id: UUID
    user_id: UUID
    username: str
    avatar_url: str | None = None
    activity_type: str = Field(
        description="Type of activity: trip_created, country_visited, entry_added"
    )
    trip_id: UUID | None = None
    trip_name: str | None = None
    country_id: str | None = None
    country_name: str | None = None
    country_code: str | None = None
    entry_id: UUID | None = None
    entry_type: str | None = None
    media_count: int = Field(default=0, description="Number of media files attached")
    created_at: datetime


class PaginatedFeed(BaseModel):
    """Paginated activity feed response."""

    items: list[FeedItem]
    total: int = Field(description="Total number of feed items")
    limit: int
    offset: int
    has_more: bool = Field(description="Whether there are more items to fetch")
