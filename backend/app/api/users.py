"""User search and username management endpoints."""

import logging

from fastapi import APIRouter, Request

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.users import (
    UsernameCheckRequest,
    UsernameCheckResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/check-username", response_model=UsernameCheckResponse)
@limiter.limit("30/minute")
async def check_username(
    request: Request,
    data: UsernameCheckRequest,
    user: CurrentUser,
) -> UsernameCheckResponse:
    """
    Check if a username is available.

    Rate limited to prevent brute-force username enumeration.
    Returns suggestions if username is taken.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Check if username is available (case-insensitive)
    result = await db.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM user_profile
            WHERE LOWER(username) = LOWER($1)
        ) as taken
        """,
        data.username,
    )

    is_taken = result[0]["taken"] if result else False

    if is_taken:
        # Generate suggestions using database function
        suggestions_result = await db.execute(
            "SELECT generate_username_suggestions($1, 3) as suggestions",
            data.username,
        )
        suggestions = (
            suggestions_result[0]["suggestions"]
            if suggestions_result and suggestions_result[0]["suggestions"]
            else []
        )

        return UsernameCheckResponse(
            available=False,
            suggestions=suggestions,
        )

    return UsernameCheckResponse(available=True, suggestions=[])


@router.get("/search")
@limiter.limit("30/minute")
async def search_users(
    request: Request,
    q: str,
    user: CurrentUser,
):
    """
    Search users by username only (prefix match).

    Security: NO EMAIL SEARCH to prevent enumeration attacks.
    Users can invite by email through /invites endpoint.

    Returns users with enriched data (country_count, is_following).
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Minimum 2 characters for search
    if len(q) < 2:
        return []

    # Search by username prefix ONLY (case-insensitive)
    # Exclude blocked users (will add blocking in Phase 1.8)
    query = """
    WITH search_results AS (
        SELECT
            up.id,
            up.username,
            up.avatar_url,
            COUNT(DISTINCT uc.country_id) as country_count
        FROM user_profile up
        LEFT JOIN user_countries uc ON uc.user_id = up.user_id AND uc.status = 'visited'
        WHERE up.username ILIKE $1
            AND up.user_id != $2
        GROUP BY up.id, up.username, up.avatar_url
        LIMIT 10
    )
    SELECT
        sr.*,
        EXISTS (
            SELECT 1 FROM user_follow
            WHERE follower_id = $2 AND following_id = sr.id
        ) as is_following
    FROM search_results sr;
    """

    results = await db.execute(query, f"{q}%", user.id)

    return results or []
