"""Feed-related Pydantic schemas."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class ActivityType(str, Enum):
    """Types of activities in the feed."""

    COUNTRY_VISITED = "country_visited"
    ENTRY_ADDED = "entry_added"


class FeedItemUser(BaseModel):
    """User information for feed items."""

    user_id: str
    username: str
    avatar_url: str | None = None


class FeedItemCountry(BaseModel):
    """Country information for feed items."""

    country_id: str
    country_name: str
    country_code: str


class FeedItemEntry(BaseModel):
    """Entry information for feed items."""

    entry_id: str
    entry_name: str
    entry_type: str
    location_name: str | None = None
    image_url: str | None = None


class FeedItem(BaseModel):
    """A single item in the activity feed."""

    activity_type: ActivityType
    created_at: datetime
    user: FeedItemUser
    country: FeedItemCountry | None = None
    entry: FeedItemEntry | None = None


class FeedResponse(BaseModel):
    """Response for the feed endpoint with pagination."""

    items: list[FeedItem]
    next_cursor: str | None = None
    has_more: bool = False
