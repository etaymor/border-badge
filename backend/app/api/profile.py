"""User profile endpoints."""

from fastapi import APIRouter, HTTPException, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.profile import Profile, ProfileUpdate

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
    print(f"DEBUG update_profile: user.id={user.id}, token exists={token is not None}")
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
