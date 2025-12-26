"""Schemas for follow system endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FollowStats(BaseModel):
    """User follow statistics."""

    following_count: int = Field(
        default=0, description="Number of users this user follows"
    )
    follower_count: int = Field(
        default=0, description="Number of users following this user"
    )


class FollowUser(BaseModel):
    """User information in follow lists."""

    id: UUID
    username: str
    avatar_url: str | None = None
    country_count: int = Field(
        default=0, description="Number of countries visited by this user"
    )
    is_following: bool = Field(
        default=False, description="Whether current user follows this user"
    )
    created_at: datetime = Field(description="When the follow relationship was created")


class FollowResponse(BaseModel):
    """Response after following/unfollowing a user."""

    status: str = Field(description="Status message (e.g., 'following', 'unfollowed')")
    message: str | None = Field(default=None, description="Optional message")


class PaginatedFollowList(BaseModel):
    """Paginated list of users (following or followers)."""

    users: list[FollowUser]
    total: int
    limit: int
    offset: int
    has_more: bool
