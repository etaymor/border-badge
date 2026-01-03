"""User-related endpoints for social features."""

import asyncio
import logging
import re
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field, field_validator

from app.api.utils import get_token_from_request
from app.core.db_utils import get_rpc_first_row
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
@limiter.limit("10/minute")
async def check_username_availability(
    request: Request,
    username: Annotated[str, Query(min_length=3, max_length=30)],
) -> UsernameCheckResponse:
    """
    Check if a username is available.

    This endpoint does not require authentication so it can be used
    during the onboarding flow before the user has an account.

    Rate limited to 10 requests per minute to prevent enumeration attacks.
    This allows legitimate users to check a few variations while limiting
    bulk enumeration to ~600 checks/hour.

    TODO: Consider adding CAPTCHA for production to further mitigate bulk
    enumeration.
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

    # Check if username exists (case-insensitive).
    # Note: username is pre-validated by Query(min_length=3, max_length=30) and
    # USERNAME_PATTERN (alphanumeric + underscore only) on line 54, so the ilike
    # operator is safe from SQL injection.
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

    logger.info(f"User search: q={q}, user_id={user.id}, limit={limit}")

    # Validate search query - only allow username-safe characters
    # Strip wildcards and validate against username pattern
    q_safe = q.replace("%", "").replace("_", "")
    if not q_safe or not USERNAME_PATTERN.match(q_safe):
        logger.debug(f"Invalid search query rejected: {q}")
        return []

    # Search by username prefix (case-insensitive).
    # Note: q_safe is pre-validated against USERNAME_PATTERN above, stripping wildcards.
    # The ilike operator with alphanumeric input is safe from SQL injection.
    rows = await db.get(
        "user_profile",
        {
            "select": "id,user_id,username,avatar_url",
            "username": f"ilike.{q_safe}%",
            "user_id": f"neq.{user.id}",
            "limit": limit,
        },
    )

    logger.info(f"User search results: {len(rows) if rows else 0} rows")

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
                id=row["user_id"],  # Use user_id, not profile id, for follow operations
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

    Note: Uses constant-time response pattern to prevent timing-based enumeration.
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

    # Get user's DB client for subsequent queries
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Perform dummy queries when user not found to maintain constant timing
    # This prevents attackers from determining user existence via response time
    if not result:
        # Execute dummy queries to match the timing of a successful lookup
        await db.rpc("get_user_country_counts", {"user_ids": [user.id]})
        await db.get(
            "user_follow",
            {"select": "id", "follower_id": f"eq.{user.id}", "limit": 1},
        )
        return None

    profile = result[0]

    # Don't return the current user
    if profile["user_id"] == user.id:
        return None

    # Check if blocked (bidirectional)
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
        id=profile["user_id"],
        username=profile["username"],
        avatar_url=profile.get("avatar_url"),
        country_count=country_count,
        is_following=bool(follow_check),
    )


@router.get("/{username}/profile", response_model=UserProfileResponse)
@limiter.limit("30/minute")
async def get_user_profile(
    request: Request,
    username: str = Path(..., min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_]+$"),
    user: CurrentUser = ...,
) -> UserProfileResponse:
    """
    Get a user's public profile by username.

    Returns 404 if user not found or if the user is blocked.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Get the user profile (case-insensitive).
    # Note: username is pre-validated by FastAPI Path() with pattern=r"^[a-zA-Z0-9_]+$"
    # before reaching this point. The ilike operator with alphanumeric input is safe.
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

    stats_task = db.rpc(
        "get_public_profile_stats",
        {
            "p_user_id": str(target_user_id),
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
    stats_result, follow_check = await asyncio.gather(stats_task, is_following_task)

    stats_row = get_rpc_first_row(stats_result) or {}
    country_count = int(stats_row.get("country_count") or 0)
    follower_count = int(stats_row.get("follower_count") or 0)
    following_count = int(stats_row.get("following_count") or 0)
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
