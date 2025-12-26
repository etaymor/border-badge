"""User profile endpoints."""

import logging

from fastapi import APIRouter, HTTPException, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
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
    """
    Update the current user's profile preferences.

    Handles race conditions for username uniqueness with suggestions.
    """
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

    try:
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

    except HTTPException as e:
        # Check if it's a username uniqueness violation (HTTP 409)
        # Supabase returns 409 for unique constraint violations
        if (
            e.status_code == status.HTTP_409_CONFLICT
            and "username" in update_data
            and "unique" in str(e.detail).lower()
        ):
            # Username was taken between check and claim (race condition)
            suggestions_result = await db.execute(
                "SELECT generate_username_suggestions($1, 3) as suggestions",
                update_data["username"],
            )
            suggestions = (
                suggestions_result[0]["suggestions"]
                if suggestions_result and suggestions_result[0]["suggestions"]
                else []
            )

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "USERNAME_TAKEN",
                    "message": f"Username '{update_data['username']}' is already taken",
                    "suggestions": suggestions,
                },
            ) from e
        # Re-raise other HTTP exceptions
        raise
