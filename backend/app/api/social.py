"""Aggregate social endpoints (feed + stats + notifications)."""

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.feed import _build_cursor, _build_feed_items, _parse_cursor
from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.feed import FeedResponse
from app.schemas.follows import FollowStats
from app.schemas.social import SocialHomeResponse
from app.schemas.stats import FriendsRankingResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_follow_stats(
    follower_count: int | None, following_count: int | None
) -> FollowStats:
    """Construct FollowStats with safe defaults."""
    return FollowStats(
        follower_count=follower_count or 0,
        following_count=following_count or 0,
    )


def _build_ranking(result: list[dict] | None) -> FriendsRankingResponse:
    """Normalize friends ranking RPC output."""
    if not result:
        return FriendsRankingResponse(
            rank=1,
            total_friends=0,
            my_countries=0,
            leader_username=None,
            leader_countries=None,
        )

    row = result[0]
    return FriendsRankingResponse(
        rank=row.get("rank", 1),
        total_friends=row.get("total_friends", 0),
        my_countries=row.get("my_countries", 0),
        leader_username=row.get("leader_username"),
        leader_countries=row.get("leader_countries"),
    )


def _build_feed_response(rows: list[dict], limit: int) -> FeedResponse:
    """Convert raw feed rows into FeedResponse with pagination metadata."""
    if not rows:
        return FeedResponse(items=[], next_cursor=None, has_more=False)

    has_more = len(rows) > limit
    items_data = rows[:limit]
    items = _build_feed_items(items_data)
    next_cursor = None
    if has_more and items_data:
        next_cursor = _build_cursor(items_data[-1])

    return FeedResponse(items=items, next_cursor=next_cursor, has_more=has_more)


@router.get("/home", response_model=SocialHomeResponse)
@limiter.limit("30/minute")
async def get_social_home(
    request: Request,
    user: CurrentUser,
    before: str | None = Query(
        default=None, description="Cursor for pagination (timestamp|id)"
    ),
    limit: int = Query(default=20, ge=1, le=100),
) -> SocialHomeResponse:
    """Return the aggregated data required for the Friends home screen."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    before_time, _ = _parse_cursor(before)
    before_iso: str | None = (
        before_time.isoformat() if isinstance(before_time, datetime) else None
    )

    # Execute Supabase calls concurrently to minimize total latency.
    # Note: stats RPC consolidates 3 count queries into 1 HTTP call.
    feed_task = db.rpc(
        "get_activity_feed",
        {
            "p_user_id": str(user.id),
            "p_before": before_iso,
            "p_limit": limit,
        },
    )

    stats_task = db.rpc("get_social_home_stats", {"p_user_id": str(user.id)})

    ranking_task = db.rpc("get_friends_ranking", {"p_user_id": str(user.id)})

    try:
        (
            feed_rows,
            stats,
            ranking_rows,
        ) = await asyncio.gather(
            feed_task,
            stats_task,
            ranking_task,
        )
    except HTTPException:
        # Propagate HTTP errors (handled by get_supabase_client helpers)
        raise
    except Exception as exc:  # pragma: no cover - defensive catch-all
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to load social home data",
        ) from exc

    # Extract counts from consolidated stats RPC response
    stats_data = stats or {}
    follower_count = stats_data.get("follower_count", 0)
    following_count = stats_data.get("following_count", 0)
    pending_tag_count = stats_data.get("pending_tag_count", 0)

    feed_response = _build_feed_response(feed_rows or [], limit)
    follow_stats = _build_follow_stats(follower_count, following_count)
    ranking = _build_ranking(ranking_rows)

    return SocialHomeResponse(
        feed=feed_response,
        follow_stats=follow_stats,
        friends_ranking=ranking,
        pending_tag_count=pending_tag_count,
    )
