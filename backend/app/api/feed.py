"""Activity feed endpoints."""

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query, Request

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.feed import (
    ActivityType,
    FeedItem,
    FeedItemCountry,
    FeedItemEntry,
    FeedItemUser,
    FeedResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_feed_items(rows: list[dict]) -> list[FeedItem]:
    """Transform raw database rows to FeedItem models."""
    items: list[FeedItem] = []
    for row in rows:
        # Build user info
        feed_user = FeedItemUser(
            user_id=row["user_id"],
            username=row["username"],
            avatar_url=row.get("avatar_url"),
        )

        # Build country info (for country_visited activities)
        feed_country = None
        if row.get("country_id"):
            feed_country = FeedItemCountry(
                country_id=row["country_id"],
                country_name=row["country_name"],
                country_code=row["country_code"],
            )

        # Build entry info (for entry_added activities)
        feed_entry = None
        if row.get("entry_id"):
            feed_entry = FeedItemEntry(
                entry_id=row["entry_id"],
                entry_name=row["entry_name"],
                entry_type=row["entry_type"],
                location_name=row.get("location_name"),
                image_url=row.get("entry_image_url"),
            )

        items.append(
            FeedItem(
                activity_type=ActivityType(row["activity_type"]),
                created_at=row["created_at"],
                user=feed_user,
                country=feed_country,
                entry=feed_entry,
            )
        )
    return items


@router.get("/user/{user_id}", response_model=FeedResponse)
@limiter.limit("60/minute")
async def get_user_feed(
    request: Request,
    user_id: UUID,
    user: CurrentUser,
    before: datetime | None = Query(default=None, description="Cursor for pagination"),
    limit: int = Query(default=20, ge=1, le=100),
) -> FeedResponse:
    """
    Get the activity feed for a specific user.

    Returns the target user's activities (countries visited, entries added).
    Only accessible if the viewer follows the target user (or is the user).
    Respects block relationships.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    result = await db.rpc(
        "get_user_activity_feed",
        {
            "p_viewer_id": str(user.id),
            "p_target_user_id": str(user_id),
            "p_before": before.isoformat() if before else None,
            "p_limit": limit,
        },
    )

    if not result:
        return FeedResponse(items=[], next_cursor=None, has_more=False)

    has_more = len(result) > limit
    items_data = result[:limit]

    items = _build_feed_items(items_data)

    next_cursor = None
    if items and has_more:
        next_cursor = items[-1].created_at.isoformat()

    return FeedResponse(
        items=items,
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.get("", response_model=FeedResponse)
@limiter.limit("60/minute")
async def get_feed(
    request: Request,
    user: CurrentUser,
    before: datetime | None = Query(default=None, description="Cursor for pagination"),
    limit: int = Query(default=20, ge=1, le=100),
) -> FeedResponse:
    """
    Get the activity feed for the current user.

    Returns activities from users the current user follows:
    - Countries they've marked as visited
    - Entries they've added to trips

    Excludes activities from blocked users (bidirectionally).
    Uses cursor-based pagination via the 'before' parameter.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Call the database function
    result = await db.rpc(
        "get_activity_feed",
        {
            "p_user_id": str(user.id),
            "p_before": before.isoformat() if before else None,
            "p_limit": limit,
        },
    )

    if not result:
        return FeedResponse(items=[], next_cursor=None, has_more=False)

    has_more = len(result) > limit
    items_data = result[:limit]

    items = _build_feed_items(items_data)

    next_cursor = None
    if items and has_more:
        next_cursor = items[-1].created_at.isoformat()

    return FeedResponse(
        items=items,
        next_cursor=next_cursor,
        has_more=has_more,
    )
