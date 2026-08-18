"""Schemas for statistics endpoints."""

from pydantic import BaseModel


class FriendsRankingResponse(BaseModel):
    """Response for friends ranking endpoint."""

    rank: int
    total_friends: int
    my_countries: int
    leader_username: str | None = None
    leader_countries: int | None = None
