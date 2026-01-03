"""Schemas for follow-related endpoints."""

from pydantic import BaseModel


class FollowStats(BaseModel):
    """Follow statistics for a user."""

    follower_count: int
    following_count: int


class FollowResponse(BaseModel):
    """Response after follow/unfollow action."""

    status: str
    following_id: str


class UserSummary(BaseModel):
    """User summary for follower/following lists."""

    id: str
    user_id: str
    username: str
    display_name: str
    avatar_url: str | None = None
    country_count: int = 0
