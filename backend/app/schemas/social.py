"""Schemas for aggregated social responses."""

from pydantic import BaseModel

from app.schemas.feed import FeedResponse
from app.schemas.follows import FollowStats
from app.schemas.stats import FriendsRankingResponse


class SocialHomeResponse(BaseModel):
    """Aggregated payload for the Friends home screen."""

    feed: FeedResponse
    follow_stats: FollowStats
    friends_ranking: FriendsRankingResponse
    pending_tag_count: int
