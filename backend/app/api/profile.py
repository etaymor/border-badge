"""User profile endpoints."""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, status

from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.session import get_http_client, get_supabase_client
from app.main import limiter
from app.schemas.profile import Profile, ProfileUpdate

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
    - Delete all user data (trips, entries, media, etc.) via database CASCADE constraints

    Rate limited to 5 requests per hour for security.
    """
    settings = get_settings()

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
