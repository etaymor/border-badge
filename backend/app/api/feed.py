"""Activity feed endpoints."""

import logging

from fastapi import APIRouter, Request

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.feed import PaginatedFeed

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=PaginatedFeed)
@limiter.limit("60/minute")
async def get_activity_feed(
    request: Request,
    user: CurrentUser,
    limit: int = 20,
    offset: int = 0,
) -> PaginatedFeed:
    """
    Get activity feed for users you follow.

    Returns recent activities from followed users, ordered by creation time.
    Activities include:
    - trip_created: User created a new trip
    - country_visited: User visited a new country
    - entry_added: User added an entry to a trip

    Computed on-demand with efficient queries (no materialized views).
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Query activity feed from following users
    # Combines trips, user_countries, and entries for comprehensive feed
    query = """
    WITH following_users AS (
        SELECT following_id
        FROM user_follow
        WHERE follower_id = $1
    ),
    trip_activities AS (
        SELECT
            t.id,
            t.user_id,
            up.username,
            up.avatar_url,
            'trip_created' as activity_type,
            t.id as trip_id,
            t.name as trip_name,
            c.id as country_id,
            c.name as country_name,
            c.country_code,
            NULL::uuid as entry_id,
            NULL::text as entry_type,
            0 as media_count,
            t.created_at
        FROM trip t
        JOIN user_profile up ON up.user_id = t.user_id
        JOIN country c ON c.id = t.country_id
        WHERE t.user_id IN (SELECT following_id FROM following_users)
            AND t.deleted_at IS NULL
    ),
    country_activities AS (
        SELECT
            uc.id,
            uc.user_id,
            up.username,
            up.avatar_url,
            'country_visited' as activity_type,
            NULL::uuid as trip_id,
            NULL::text as trip_name,
            c.id as country_id,
            c.name as country_name,
            c.country_code,
            NULL::uuid as entry_id,
            NULL::text as entry_type,
            0 as media_count,
            uc.created_at
        FROM user_countries uc
        JOIN user_profile up ON up.user_id = uc.user_id
        JOIN country c ON c.id = uc.country_id
        WHERE uc.user_id IN (SELECT following_id FROM following_users)
            AND uc.status = 'visited'
    ),
    entry_activities AS (
        SELECT
            e.id,
            t.user_id,
            up.username,
            up.avatar_url,
            'entry_added' as activity_type,
            t.id as trip_id,
            t.name as trip_name,
            c.id as country_id,
            c.name as country_name,
            c.country_code,
            e.id as entry_id,
            e.entry_type,
            COUNT(DISTINCT m.id) as media_count,
            e.created_at
        FROM entry e
        JOIN trip t ON t.id = e.trip_id
        JOIN user_profile up ON up.user_id = t.user_id
        JOIN country c ON c.id = t.country_id
        LEFT JOIN media_files m ON m.entry_id = e.id
        WHERE t.user_id IN (SELECT following_id FROM following_users)
            AND e.deleted_at IS NULL
            AND t.deleted_at IS NULL
        GROUP BY e.id, t.id, t.user_id, up.username, up.avatar_url,
                 t.name, c.id, c.name, c.country_code, e.entry_type, e.created_at
    ),
    combined_feed AS (
        SELECT * FROM trip_activities
        UNION ALL
        SELECT * FROM country_activities
        UNION ALL
        SELECT * FROM entry_activities
    ),
    paginated_feed AS (
        SELECT *
        FROM combined_feed
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
    ),
    total_count AS (
        SELECT COUNT(*) as total
        FROM combined_feed
    )
    SELECT
        pf.*,
        tc.total
    FROM paginated_feed pf
    CROSS JOIN total_count tc;
    """

    results = await db.execute(query, user.id, limit, offset)

    if not results:
        return PaginatedFeed(
            items=[],
            total=0,
            limit=limit,
            offset=offset,
            has_more=False,
        )

    # Extract total from first row
    total = results[0].get("total", 0) if results else 0

    return PaginatedFeed(
        items=results,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(results)) < total,
    )
