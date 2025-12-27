"""Statistics endpoints for social features."""

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter

logger = logging.getLogger(__name__)

router = APIRouter()


class FriendsRankingResponse(BaseModel):
    """Response for friends ranking endpoint."""

    rank: int
    total_friends: int
    my_countries: int
    leader_username: str | None = None
    leader_countries: int | None = None


@router.get("/friends-ranking", response_model=FriendsRankingResponse)
@limiter.limit("30/minute")
async def get_friends_ranking(
    request: Request,
    user: CurrentUser,
) -> FriendsRankingResponse:
    """
    Get the current user's rank among people they follow.

    Computed on-demand. Limited to first 1000 follows for performance.
    Returns:
    - rank: User's position (1 = best traveler among friends)
    - total_friends: Number of people being followed
    - my_countries: User's visited country count
    - leader_username: Friend with most countries
    - leader_countries: Leader's country count
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Call the database function
    result = await db.rpc(
        "get_friends_ranking",
        {"p_user_id": str(user.id)},
    )

    if not result or len(result) == 0:
        return FriendsRankingResponse(
            rank=1,
            total_friends=0,
            my_countries=0,
            leader_username=None,
            leader_countries=None,
        )

    row = result[0]
    return FriendsRankingResponse(
        rank=row["rank"],
        total_friends=row["total_friends"],
        my_countries=row["my_countries"],
        leader_username=row.get("leader_username"),
        leader_countries=row.get("leader_countries"),
    )
