"""User profile endpoints."""

import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException, Request, status

from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.session import get_http_client, get_supabase_client
from app.main import limiter
from app.schemas.profile import Profile, ProfileUpdate
from app.services.quiz_storage import (
    QuizStorageDeletionError,
    delete_quiz_storage_objects,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=Profile)
@limiter.limit("30/minute")
async def get_profile(
    request: Request,
    user: CurrentUser,
) -> Profile:
    """Get the current user's profile."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    rows = await db.get(
        "user_profile",
        {
            "user_id": f"eq.{user.id}",
            "select": "*",
        },
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found",
        )

    return Profile(**rows[0])


@router.patch("", response_model=Profile)
@limiter.limit("20/minute")
async def update_profile(
    request: Request,
    data: ProfileUpdate,
    user: CurrentUser,
) -> Profile:
    """Update the current user's profile preferences."""
    token = get_token_from_request(request)
    logger.debug(
        "update_profile: user.id=%s, token exists=%s", user.id, token is not None
    )
    db = get_supabase_client(user_token=token)

    # Convert to dict, excluding unset fields for partial updates
    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    rows = await db.patch(
        "user_profile",
        update_data,
        {"user_id": f"eq.{user.id}"},
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found",
        )

    return Profile(**rows[0])


@router.delete("")
@limiter.limit("5/hour")
async def delete_account(
    request: Request,
    user: CurrentUser,
) -> dict[str, str]:
    """
    Permanently delete the current user's account and all associated data.

    This operation is irreversible and will:
    - Delete the user's authentication record from Supabase Auth
    - Cascade delete all database records via ON DELETE CASCADE constraints:
      - user_profile, user_countries, trips, entries, places, lists, list_entries
      - trip_tags, media_files (database records), outbound_links, social_ingest_jobs

    Note: Media files in Supabase Storage buckets are NOT automatically deleted.
    Supabase Storage cleanup requires a separate process (e.g., scheduled job or
    storage lifecycle policy) to remove orphaned files.

    Exception: quiz photos live under quiz-owned storage prefixes with
    no media_files rows, so nothing else can ever collect them. Every owned
    quiz's prefix -- drafts included -- is emptied and verified BEFORE the
    auth-admin delete; a storage failure aborts the whole account deletion
    loudly, because the account (and its retry surfaces) must outlive any
    undeleted photo (R15).

    Rate limited to 5 requests per hour for security.
    """
    settings = get_settings()

    # Quiz tables are backend-only (no RLS user policies): service role.
    quiz_db = get_supabase_client()
    owned_quizzes = await quiz_db.get(
        "quiz", {"owner_id": f"eq.{user.id}", "select": "id,state"}
    )
    for quiz in owned_quizzes:
        if quiz.get("state") == "shared":
            # Take a still-shared quiz off the public surface BEFORE its
            # photos are swept: the public page serves only state == 'shared',
            # and the auth-cascade delete below (which would end the share)
            # runs after the sweep and may fail. Conditional shared -> revoked
            # write, mirroring POST /quiz/{id}/revoke.
            now = datetime.now(UTC).isoformat()
            await quiz_db.patch(
                "quiz",
                {"state": "revoked", "revoked_at": now, "updated_at": now},
                {
                    "id": f"eq.{quiz['id']}",
                    "owner_id": f"eq.{user.id}",
                    "state": "eq.shared",
                },
            )
        try:
            await delete_quiz_storage_objects(quiz["id"])
        except QuizStorageDeletionError as exc:
            logger.error(
                "Account deletion aborted for user %s: quiz %s storage "
                "sweep failed: %s",
                user.id,
                quiz["id"],
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Failed to delete account. Please try again or " "contact support."
                ),
            ) from exc

    # Use Supabase Admin Auth API to delete the user
    # This will cascade delete all user data via RLS policies
    auth_admin_url = f"{settings.supabase_url}/auth/v1/admin/users/{user.id}"

    try:
        client = get_http_client()
        response = await client.delete(
            auth_admin_url,
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
        )
        response.raise_for_status()

        logger.info("Account deleted for user %s", user.id)
        return {"message": "Account deleted successfully"}

    except httpx.HTTPStatusError as e:
        logger.error(
            "Failed to delete account for user %s: %s",
            user.id,
            e.response.text[:500],
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete account. Please try again or contact support.",
        ) from e
    except httpx.RequestError as e:
        logger.error("Network error deleting account for user %s: %s", user.id, str(e))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable. Please try again.",
        ) from e
