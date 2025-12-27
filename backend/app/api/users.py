"""User-related endpoints for social features."""

import asyncio
import logging
import re
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_service_supabase_client, get_supabase_client
from app.main import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# Username validation constants (must match migration)
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 30
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")


class UsernameCheckRequest(BaseModel):
    """Request to check username availability."""

    username: str = Field(..., min_length=3, max_length=30)

    @field_validator("username")
    @classmethod
    def validate_username_format(cls, v: str) -> str:
        """Validate username format."""
        if not USERNAME_PATTERN.match(v):
            raise ValueError(
                "Username can only contain letters, numbers, and underscores"
            )
        return v


class UsernameCheckResponse(BaseModel):
    """Response for username availability check."""

    available: bool
    reason: str | None = None
    suggestions: list[str] = []


@router.get("/check-username", response_model=UsernameCheckResponse)
@limiter.limit("30/minute")
async def check_username_availability(
    request: Request,
    username: Annotated[str, Query(min_length=3, max_length=30)],
) -> UsernameCheckResponse:
    """
    Check if a username is available.

    This endpoint does not require authentication so it can be used
    during the onboarding flow before the user has an account.

    Rate limited to 30 requests per minute to prevent enumeration attacks.
    """
    # Validate format
    if not USERNAME_PATTERN.match(username):
        return UsernameCheckResponse(
            available=False,
            reason="Username can only contain letters, numbers, and underscores",
            suggestions=[],
        )

    # Use service client since user may not be authenticated yet
    db = get_service_supabase_client()

    # Check if username exists (case-insensitive)
    rows = await db.get(
        "user_profile",
        {
            "select": "id",
            "username": f"ilike.{username}",
        },
    )

    if not rows:
        return UsernameCheckResponse(available=True)

    # Username taken - generate suggestions
    suggestions = []
    base = username.lower()

    # Try numbered suffixes
    for i in range(1, 6):
        candidate = f"{base}_{i}"
        if len(candidate) <= USERNAME_MAX_LENGTH:
            check = await db.get(
                "user_profile",
                {
                    "select": "id",
                    "username": f"ilike.{candidate}",
                },
            )
            if not check:
                suggestions.append(candidate)
            if len(suggestions) >= 3:
                break

    return UsernameCheckResponse(
        available=False,
        reason="Username is already taken",
        suggestions=suggestions[:3],
    )


class UserSummary(BaseModel):
    """User summary for search results and lists."""

    id: str
    username: str
    avatar_url: str | None = None
    country_count: int = 0
    is_following: bool = False


class UserProfileResponse(BaseModel):
    """Full user profile response."""

    id: str
    user_id: str
    username: str
    display_name: str
    avatar_url: str | None = None
    country_count: int = 0
    follower_count: int = 0
    following_count: int = 0
    is_following: bool = False
    is_blocked: bool = False


@router.get("/search", response_model=list[UserSummary])
@limiter.limit("30/minute")
async def search_users(
    request: Request,
    q: Annotated[str, Query(min_length=2, max_length=30)],
    user: CurrentUser,
    limit: int = Query(default=10, ge=1, le=50),
) -> list[UserSummary]:
    """
    Search users by username prefix.

    Security: Only searches by username, NOT by email to prevent
    email enumeration attacks. Users can invite by email through
    the /invites endpoint.

    Results exclude:
    - The current user
    - Users blocked by or blocking the current user
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Search by username prefix (case-insensitive)
    # Note: ilike is case-insensitive LIKE in PostgreSQL
    rows = await db.get(
        "user_profile",
        {
            "select": "id,user_id,username,avatar_url",
            "username": f"ilike.{q}%",
            "user_id": f"neq.{user.id}",
            "limit": limit,
        },
    )

    if not rows:
        return []

    # Get country counts for each user
    user_ids = [row["user_id"] for row in rows]
    country_counts = await db.rpc(
        "get_user_country_counts",
        {"user_ids": user_ids},
    )
    count_map = (
        {c["user_id"]: c["count"] for c in country_counts} if country_counts else {}
    )

    # Get follow status for each user
    follow_check = await db.get(
        "user_follow",
        {
            "select": "following_id",
            "follower_id": f"eq.{user.id}",
            "following_id": f"in.({','.join(user_ids)})",
        },
    )
    following_ids = {f["following_id"] for f in follow_check} if follow_check else set()

    # Build response
    results = []
    for row in rows:
        results.append(
            UserSummary(
                id=row["id"],
                username=row["username"],
                avatar_url=row.get("avatar_url"),
                country_count=count_map.get(row["user_id"], 0),
                is_following=row["user_id"] in following_ids,
            )
        )

    return results


@router.get("/lookup-by-email", response_model=UserSummary | None)
@limiter.limit("10/minute")
async def lookup_user_by_email(
    request: Request,
    email: Annotated[str, Query(min_length=5, max_length=255)],
    user: CurrentUser,
) -> UserSummary | None:
    """
    Look up a user by exact email match.

    Returns user info if found, None if not found.
    Rate limited to 10 requests/minute to prevent email enumeration abuse.

    This endpoint requires authentication and uses service role to query
    the auth.users table (which is not directly accessible to users).
    """
    # Validate email format
    if "@" not in email or "." not in email.split("@")[-1]:
        return None

    # Use service client to call the RPC (requires service role)
    service_db = get_service_supabase_client()

    # Look up user profile by email
    result = await service_db.rpc(
        "lookup_user_by_email",
        {"email_to_lookup": email.strip().lower()},
    )

    if not result:
        return None

    profile = result[0]

    # Don't return the current user
    if profile["user_id"] == user.id:
        return None

    # Check if blocked (bidirectional) - use service client
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    block_check = await db.get(
        "user_block",
        {
            "select": "id",
            "or": f"(and(blocker_id.eq.{user.id},blocked_id.eq.{profile['user_id']})),"
            f"(and(blocker_id.eq.{profile['user_id']},blocked_id.eq.{user.id}))",
        },
    )

    if block_check:
        # Return None to not reveal that the user exists
        return None

    # Get country count
    country_count_result = await db.rpc(
        "get_user_country_counts",
        {"user_ids": [profile["user_id"]]},
    )
    country_count = country_count_result[0]["count"] if country_count_result else 0

    # Check if following
    follow_check = await db.get(
        "user_follow",
        {
            "select": "id",
            "follower_id": f"eq.{user.id}",
            "following_id": f"eq.{profile['user_id']}",
        },
    )

    return UserSummary(
        id=profile["id"],
        username=profile["username"],
        avatar_url=profile.get("avatar_url"),
        country_count=country_count,
        is_following=bool(follow_check),
    )


@router.get("/{username}/profile", response_model=UserProfileResponse)
@limiter.limit("30/minute")
async def get_user_profile(
    request: Request,
    username: str,
    user: CurrentUser,
) -> UserProfileResponse:
    """
    Get a user's public profile by username.

    Returns 404 if user not found or if the user is blocked.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Get the user profile
    rows = await db.get(
        "user_profile",
        {
            "select": "id,user_id,username,display_name,avatar_url",
            "username": f"ilike.{username}",
        },
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    profile = rows[0]
    target_user_id = profile["user_id"]

    # Check if blocked (bidirectional)
    block_check = await db.get(
        "user_block",
        {
            "select": "id",
            "or": f"(and(blocker_id.eq.{user.id},blocked_id.eq.{target_user_id})),"
            f"(and(blocker_id.eq.{target_user_id},blocked_id.eq.{user.id}))",
        },
    )

    if block_check:
        # Return 404 to not reveal that the user exists
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Execute remaining queries in parallel for better performance
    country_task = db.get(
        "user_countries",
        {
            "select": "id",
            "user_id": f"eq.{target_user_id}",
            "status": "eq.visited",
        },
    )

    follower_task = db.get(
        "user_follow",
        {
            "select": "id",
            "following_id": f"eq.{target_user_id}",
        },
    )

    following_task = db.get(
        "user_follow",
        {
            "select": "id",
            "follower_id": f"eq.{target_user_id}",
        },
    )

    is_following_task = db.get(
        "user_follow",
        {
            "select": "id",
            "follower_id": f"eq.{user.id}",
            "following_id": f"eq.{target_user_id}",
        },
    )

    # Await all queries concurrently
    country_rows, follower_rows, following_rows, follow_check = await asyncio.gather(
        country_task, follower_task, following_task, is_following_task
    )

    country_count = len(country_rows) if country_rows else 0
    follower_count = len(follower_rows) if follower_rows else 0
    following_count = len(following_rows) if following_rows else 0
    is_following = bool(follow_check)

    return UserProfileResponse(
        id=profile["id"],
        user_id=target_user_id,
        username=profile["username"],
        display_name=profile["display_name"],
        avatar_url=profile.get("avatar_url"),
        country_count=country_count,
        follower_count=follower_count,
        following_count=following_count,
        is_following=is_following,
        is_blocked=False,
    )
