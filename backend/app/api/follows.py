"""Follow system endpoints."""

import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.edge_functions import send_push_notification
from app.core.security import CurrentUser
from app.db.postgrest import in_list
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.follows import FollowResponse, FollowStats, UserSummary

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{user_id}", status_code=201)
@limiter.limit("60/minute")
async def follow_user(
    request: Request,
    user_id: UUID,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> FollowResponse:
    """
    Follow a user.

    Idempotent - returns 200 if already following.

    Security:
    - Prevents self-follows (400)
    - Prevents following blocked users (403)
    - Returns 200 if already following (idempotent)
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Prevent self-follow
    if str(user_id) == str(user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot follow yourself",
        )

    # Check for blocks (bidirectional)
    # Use separate queries to avoid string interpolation in 'or' filter (safer pattern)
    block_check_1 = await db.get(
        "user_block",
        {
            "select": "id",
            "blocker_id": f"eq.{user.id}",
            "blocked_id": f"eq.{user_id}",
        },
    )
    block_check_2 = await db.get(
        "user_block",
        {
            "select": "id",
            "blocker_id": f"eq.{user_id}",
            "blocked_id": f"eq.{user.id}",
        },
    )

    if block_check_1 or block_check_2:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot follow this user",
        )

    # Check if target user exists
    target_user = await db.get(
        "user_profile",
        {
            "select": "id",
            "user_id": f"eq.{user_id}",
        },
    )

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Create follow relationship - catch constraint violation to handle race condition
    # This avoids TOCTOU race where check-then-insert could have another insert in between
    try:
        await db.post(
            "user_follow",
            {
                "follower_id": str(user.id),
                "following_id": str(user_id),
            },
        )
    except Exception as e:
        # Handle duplicate key constraint violation (already following)
        if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
            return FollowResponse(status="already_following", following_id=str(user_id))
        raise

    # Send push notification to the followed user (fire and forget)
    # Note: Unlike invites where we prefetch data, here we query in the background task
    # because we need both follower and followed user data. This trades memory for
    # slightly slower notifications but keeps the main request path fast.
    # Failed notifications are logged but not retried. For production at scale,
    # consider implementing a job queue (e.g., Supabase pg_cron, Celery, or a
    # dedicated notification service) for reliable delivery with retries.
    async def notify_new_follower() -> None:
        try:
            # Use service role client to get push token
            admin_db = get_supabase_client()

            # Get follower's username
            follower_profile = await admin_db.get(
                "user_profile",
                {
                    "select": "username,display_name",
                    "user_id": f"eq.{user.id}",
                },
            )
            if not follower_profile:
                return

            follower_name = (
                follower_profile[0].get("display_name")
                or follower_profile[0].get("username")
                or "Someone"
            )

            # Get followed user's push token
            followed_profile = await admin_db.get(
                "user_profile",
                {
                    "select": "push_token",
                    "user_id": f"eq.{user_id}",
                },
            )
            if not followed_profile or not followed_profile[0].get("push_token"):
                return

            push_token = followed_profile[0]["push_token"]

            await send_push_notification(
                tokens=[push_token],
                title="New Follower",
                body=f"{follower_name} started following you",
                data={
                    "screen": "UserProfile",
                    "userId": str(user.id),
                    "username": follower_profile[0].get("username", ""),
                },
            )
        except Exception as e:
            logger.warning(f"Failed to send follow notification: {e}", exc_info=True)

    background_tasks.add_task(notify_new_follower)

    return FollowResponse(status="following", following_id=str(user_id))


@router.delete("/{user_id}")
@limiter.limit("60/minute")
async def unfollow_user(
    request: Request,
    user_id: UUID,
    user: CurrentUser,
) -> FollowResponse:
    """Unfollow a user."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Delete the follow relationship (idempotent)
    await db.delete(
        "user_follow",
        {
            "follower_id": f"eq.{user.id}",
            "following_id": f"eq.{user_id}",
        },
    )

    return FollowResponse(status="unfollowed", following_id=str(user_id))


@router.get("/stats", response_model=FollowStats)
@limiter.limit("30/minute")
async def get_follow_stats(
    request: Request,
    user: CurrentUser,
) -> FollowStats:
    """Get the current user's follow statistics."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Get counts using Supabase count feature (O(1) memory, uses Content-Range header)
    follower_count, following_count = await asyncio.gather(
        db.count(
            "user_follow",
            {"following_id": f"eq.{user.id}"},
        ),
        db.count(
            "user_follow",
            {"follower_id": f"eq.{user.id}"},
        ),
    )

    return FollowStats(
        follower_count=follower_count,
        following_count=following_count,
    )


@router.get("/following", response_model=list[UserSummary])
@limiter.limit("30/minute")
async def get_following(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[UserSummary]:
    """Get list of users the current user is following."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Get follow relationships
    follows = await db.get(
        "user_follow",
        {
            "select": "following_id,created_at",
            "follower_id": f"eq.{user.id}",
            # Secondary sort ensures deterministic pagination when created_at ties
            "order": "created_at.desc,following_id.desc",
            "limit": limit,
            "offset": offset,
        },
    )

    if not follows:
        return []

    # Get user profiles
    # Note: following_ids come from database query results, so they're already validated UUIDs
    following_ids = [f["following_id"] for f in follows]
    profiles = await db.get(
        "user_profile",
        {
            "select": "id,user_id,username,display_name,avatar_url",
            "user_id": in_list(following_ids),
        },
    )

    if not profiles:
        return []

    # Get country counts
    country_counts = await db.rpc(
        "get_user_country_counts",
        {"user_ids": following_ids},
    )
    count_map = (
        {c["user_id"]: c["count"] for c in country_counts} if country_counts else {}
    )

    # IMPORTANT: Preserve the follow ordering. PostgREST `in.(...)` does not guarantee order.
    profile_map = {p["user_id"]: p for p in profiles}
    results: list[UserSummary] = []
    for user_id in following_ids:
        profile = profile_map.get(user_id)
        if not profile:
            continue
        results.append(
            UserSummary(
                id=profile["id"],
                user_id=profile["user_id"],
                username=profile["username"],
                display_name=profile["display_name"],
                avatar_url=profile.get("avatar_url"),
                country_count=count_map.get(profile["user_id"], 0),
            )
        )
    return results


@router.get("/followers", response_model=list[UserSummary])
@limiter.limit("30/minute")
async def get_followers(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[UserSummary]:
    """Get list of users following the current user."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Get follow relationships
    follows = await db.get(
        "user_follow",
        {
            "select": "follower_id,created_at",
            "following_id": f"eq.{user.id}",
            # Secondary sort ensures deterministic pagination when created_at ties
            "order": "created_at.desc,follower_id.desc",
            "limit": limit,
            "offset": offset,
        },
    )

    if not follows:
        return []

    # Get user profiles
    # Note: follower_ids come from database query results, so they're already validated UUIDs
    follower_ids = [f["follower_id"] for f in follows]
    profiles = await db.get(
        "user_profile",
        {
            "select": "id,user_id,username,display_name,avatar_url",
            "user_id": in_list(follower_ids),
        },
    )

    if not profiles:
        return []

    # Get country counts
    country_counts = await db.rpc(
        "get_user_country_counts",
        {"user_ids": follower_ids},
    )
    count_map = (
        {c["user_id"]: c["count"] for c in country_counts} if country_counts else {}
    )

    # IMPORTANT: Preserve the follow ordering. PostgREST `in.(...)` does not guarantee order.
    profile_map = {p["user_id"]: p for p in profiles}
    results: list[UserSummary] = []
    for user_id in follower_ids:
        profile = profile_map.get(user_id)
        if not profile:
            continue
        results.append(
            UserSummary(
                id=profile["id"],
                user_id=profile["user_id"],
                username=profile["username"],
                display_name=profile["display_name"],
                avatar_url=profile.get("avatar_url"),
                country_count=count_map.get(profile["user_id"], 0),
            )
        )
    return results
