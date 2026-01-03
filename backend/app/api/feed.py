"""Activity feed endpoints."""

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request

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


def _parse_cursor(cursor: str | None) -> tuple[datetime | None, str | None]:
    """Parse compound cursor into (created_at, item_id).

    Cursor format: "2024-01-01T00:00:00|uuid" or just "2024-01-01T00:00:00" for backward compat.

    Note on backward compatibility: Old timestamp-only cursors may cause duplicate items
    if multiple items share the same timestamp. New compound cursors (timestamp|id) avoid
    this by using secondary sort on item_id. Clients should update to use new cursor format.
    """
    if not cursor:
        return None, None

    # Validate max length to prevent DoS via maliciously long cursors
    # Max: ISO timestamp (26 chars) + "|" (1 char) + UUID (36 chars) = 63 chars
    # Allow 70 chars for some buffer (timezone offset variations, etc.)
    if len(cursor) > 70:
        raise HTTPException(status_code=400, detail="Invalid cursor format")

    try:
        parts = cursor.split("|", 1)
        before_time = datetime.fromisoformat(parts[0])
        # Extract item_id if present. Convert empty/whitespace to None for robustness.
        # Backward compatibility: old timestamp-only cursors have no "|" delimiter,
        # so they return None for before_id and pagination falls back to timestamp-only.
        before_id = (parts[1].strip() or None) if len(parts) > 1 else None
        return before_time, before_id
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid cursor format") from e


def _build_cursor(row: dict) -> str:
    """Build compound cursor from the last item."""
    created_at = row["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    item_id = row.get("item_id")
    if item_id:
        return f"{created_at.isoformat()}|{item_id}"
    # Backward compatibility: when there's no item_id, return timestamp-only cursor
    return created_at.isoformat()


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
    user_id: str,
    user: CurrentUser,
    before: str | None = Query(
        default=None, description="Cursor for pagination (timestamp|id)"
    ),
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

    # Parse compound cursor
    before_time, _ = _parse_cursor(before)

    result = await db.rpc(
        "get_user_activity_feed",
        {
            "p_viewer_id": str(user.id),
            "p_target_user_id": str(user_id),
            "p_before": before_time.isoformat() if before_time else None,
            "p_limit": limit,
        },
    )

    if not result:
        logger.debug(f"Empty user feed for viewer={user.id}, target={user_id}")
        return FeedResponse(items=[], next_cursor=None, has_more=False)

    has_more = len(result) > limit
    items_data = result[:limit]

    items = _build_feed_items(items_data)

    next_cursor = None
    if items_data and has_more:
        next_cursor = _build_cursor(items_data[-1])

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
    before: str | None = Query(
        default=None, description="Cursor for pagination (timestamp|id)"
    ),
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

    # Parse compound cursor
    before_time, _ = _parse_cursor(before)

    # Call the database function
    logger.debug(f"Fetching feed for user={user.id}, limit={limit}, before={before}")
    result = await db.rpc(
        "get_activity_feed",
        {
            "p_user_id": str(user.id),
            "p_before": before_time.isoformat() if before_time else None,
            "p_limit": limit,
        },
    )
    logger.debug(
        f"Feed RPC returned {len(result) if result else 0} items for user={user.id}"
    )

    if not result:
        logger.debug(f"Empty feed for user={user.id}")
        return FeedResponse(items=[], next_cursor=None, has_more=False)

    has_more = len(result) > limit
    items_data = result[:limit]

    items = _build_feed_items(items_data)

    next_cursor = None
    if items_data and has_more:
        next_cursor = _build_cursor(items_data[-1])

    return FeedResponse(
        items=items,
        next_cursor=next_cursor,
        has_more=has_more,
    )
