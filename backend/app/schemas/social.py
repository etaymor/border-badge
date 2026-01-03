"""Schemas for aggregated social responses."""

from pydantic import BaseModel

from app.api.follows import FollowStats
from app.api.stats import FriendsRankingResponse
from app.schemas.feed import FeedResponse


class SocialHomeResponse(BaseModel):
    """Aggregated payload for the Friends home screen."""

    feed: FeedResponse
    follow_stats: FollowStats
    friends_ranking: FriendsRankingResponse
    pending_tag_count: int
