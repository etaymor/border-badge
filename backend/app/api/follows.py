"""Follow system endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.follows import (
    FollowResponse,
    FollowStats,
    FollowUser,
    PaginatedFollowList,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def is_blocked(db, user_a_id: UUID, user_b_id: UUID) -> bool:
    """
    Check if a bidirectional block exists between two users.

    Returns True if EITHER user has blocked the other.
    """
    result = await db.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM user_block
            WHERE (blocker_id = $1 AND blocked_id = $2)
               OR (blocker_id = $2 AND blocked_id = $1)
        ) as blocked
        """,
        user_a_id,
        user_b_id,
    )
    return result[0]["blocked"] if result else False


@router.post("/{user_id}", response_model=FollowResponse, status_code=201)
@limiter.limit("60/minute")
async def follow_user(
    request: Request,
    user_id: UUID,
    user: CurrentUser,
) -> FollowResponse:
    """
    Follow a user. Idempotent - returns 200 if already following.

    Security:
    - Prevents self-follows (400)
    - Prevents following blocked users (403, silent)
    - Returns 200 if already following (idempotent)
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Prevent self-follow
    if user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot follow yourself",
        )

    # Check for blocks (bidirectional)
    if await is_blocked(db, user.id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot follow this user",  # Don't leak that you're blocked
        )

    # Check if already following
    existing = await db.get(
        "user_follow",
        {
            "follower_id": f"eq.{user.id}",
            "following_id": f"eq.{user_id}",
        },
    )

    if existing:
        return FollowResponse(
            status="already_following",
            message="Already following this user",
        )

    # Create follow relationship
    await db.post(
        "user_follow",
        {
            "follower_id": str(user.id),
            "following_id": str(user_id),
        },
    )

    # TODO Phase 1.10: Send push notification to followed user

    return FollowResponse(status="following")


@router.delete("/{user_id}", response_model=FollowResponse)
@limiter.limit("60/minute")
async def unfollow_user(
    request: Request,
    user_id: UUID,
    user: CurrentUser,
) -> FollowResponse:
    """
    Unfollow a user.

    Idempotent - returns 200 even if not currently following.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Delete follow relationship (idempotent)
    await db.execute(
        """
        DELETE FROM user_follow
        WHERE follower_id = $1 AND following_id = $2
        """,
        user.id,
        user_id,
    )

    return FollowResponse(status="unfollowed")


@router.get("/following", response_model=PaginatedFollowList)
@limiter.limit("30/minute")
async def get_following(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> PaginatedFollowList:
    """
    Get list of users that the current user is following.

    Returns paginated list with country counts and mutual follow status.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Query for following list with user details
    query = """
    WITH following_list AS (
        SELECT
            uf.following_id as user_id,
            uf.created_at as follow_created_at
        FROM user_follow uf
        WHERE uf.follower_id = $1
        ORDER BY uf.created_at DESC
        LIMIT $2 OFFSET $3
    )
    SELECT
        up.id,
        up.username,
        up.avatar_url,
        fl.follow_created_at as created_at,
        COUNT(DISTINCT uc.country_id) as country_count,
        EXISTS (
            SELECT 1 FROM user_follow
            WHERE follower_id = fl.user_id AND following_id = $1
        ) as is_following  -- Are they following me back?
    FROM following_list fl
    JOIN user_profile up ON up.user_id = fl.user_id
    LEFT JOIN user_countries uc ON uc.user_id = fl.user_id AND uc.status = 'visited'
    WHERE NOT is_blocked_bidirectional(fl.user_id)
    GROUP BY up.id, up.username, up.avatar_url, fl.follow_created_at
    ORDER BY fl.follow_created_at DESC;
    """

    users = await db.execute(query, user.id, limit + 1, offset)

    # Check if there are more results
    has_more = len(users) > limit if users else False
    results = users[:limit] if users else []

    # Get total count
    count_result = await db.execute(
        """
        SELECT COUNT(*) as total
        FROM user_follow uf
        WHERE uf.follower_id = $1
        """,
        user.id,
    )
    total = count_result[0]["total"] if count_result else 0

    return PaginatedFollowList(
        users=[FollowUser(**u) for u in results],
        total=total,
        limit=limit,
        offset=offset,
        has_more=has_more,
    )


@router.get("/followers", response_model=PaginatedFollowList)
@limiter.limit("30/minute")
async def get_followers(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> PaginatedFollowList:
    """
    Get list of users following the current user.

    Returns paginated list with country counts and follow-back status.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Query for followers list with user details
    query = """
    WITH followers_list AS (
        SELECT
            uf.follower_id as user_id,
            uf.created_at as follow_created_at
        FROM user_follow uf
        WHERE uf.following_id = $1
        ORDER BY uf.created_at DESC
        LIMIT $2 OFFSET $3
    )
    SELECT
        up.id,
        up.username,
        up.avatar_url,
        fl.follow_created_at as created_at,
        COUNT(DISTINCT uc.country_id) as country_count,
        EXISTS (
            SELECT 1 FROM user_follow
            WHERE follower_id = $1 AND following_id = fl.user_id
        ) as is_following  -- Am I following them back?
    FROM followers_list fl
    JOIN user_profile up ON up.user_id = fl.user_id
    LEFT JOIN user_countries uc ON uc.user_id = fl.user_id AND uc.status = 'visited'
    WHERE NOT is_blocked_bidirectional(fl.user_id)
    GROUP BY up.id, up.username, up.avatar_url, fl.follow_created_at
    ORDER BY fl.follow_created_at DESC;
    """

    users = await db.execute(query, user.id, limit + 1, offset)

    # Check if there are more results
    has_more = len(users) > limit if users else False
    results = users[:limit] if users else []

    # Get total count
    count_result = await db.execute(
        """
        SELECT COUNT(*) as total
        FROM user_follow uf
        WHERE uf.following_id = $1
        """,
        user.id,
    )
    total = count_result[0]["total"] if count_result else 0

    return PaginatedFollowList(
        users=[FollowUser(**u) for u in results],
        total=total,
        limit=limit,
        offset=offset,
        has_more=has_more,
    )


@router.get("/stats", response_model=FollowStats)
@limiter.limit("30/minute")
async def get_follow_stats(
    request: Request,
    user: CurrentUser,
) -> FollowStats:
    """
    Get follow statistics for the current user.

    Returns counts of following and followers.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    query = """
    SELECT
        (SELECT COUNT(*) FROM user_follow WHERE follower_id = $1) as following_count,
        (SELECT COUNT(*) FROM user_follow WHERE following_id = $1) as follower_count
    """

    result = await db.execute(query, user.id)

    if not result:
        return FollowStats(following_count=0, follower_count=0)

    return FollowStats(**result[0])
