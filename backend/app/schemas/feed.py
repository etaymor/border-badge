"""Feed-related Pydantic schemas."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class ActivityType(str, Enum):
    """Types of activities in the feed.

    Kept in sync with the ``social_activity_event`` type CHECK constraint
    (migration 0088). ``trip_updated`` is schema-prepared for U5's coalesced
    trip events; renderers must default-skip unknown types.
    """

    COUNTRY_VISITED = "country_visited"
    ENTRY_ADDED = "entry_added"
    TRIP_UPDATED = "trip_updated"


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

    activity_id: str
    activity_type: ActivityType
    created_at: datetime
    user: FeedItemUser
    country: FeedItemCountry | None = None
    entry: FeedItemEntry | None = None


class FeedResponse(BaseModel):
    """Response for the feed endpoint with pagination.

    ``next_cursor`` is a compound keyset cursor of the form
    ``"<created_at ISO>|<activity_id UUID>"`` shared by the home feed and the
    profile feed (identical tuple semantics).
    """

    items: list[FeedItem]
    next_cursor: str | None = None
    has_more: bool = False
