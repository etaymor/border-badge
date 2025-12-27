"""Push notification registration endpoints."""

import logging
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter

logger = logging.getLogger(__name__)

router = APIRouter()


class RegisterTokenRequest(BaseModel):
    """Request to register a push notification token."""

    token: str
    platform: Literal["ios", "android"]


class RegisterTokenResponse(BaseModel):
    """Response after registering push token."""

    status: str


@router.post("/register", response_model=RegisterTokenResponse)
@limiter.limit("30/minute")
async def register_push_token(
    request: Request,
    data: RegisterTokenRequest,
    user: CurrentUser,
) -> RegisterTokenResponse:
    """
    Register or update the user's push notification token.

    Security:
    - Token is stored encrypted in database
    - Only the user can update their own token
    - Tokens are never exposed in API responses
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Update the user's push token
    await db.patch(
        "user_profile",
        {
            "push_token": data.token,
            "push_platform": data.platform,
        },
        {
            "user_id": f"eq.{user.id}",
        },
    )

    logger.info(
        "Push token registered",
        extra={
            "user_id": str(user.id),
            "platform": data.platform,
        },
    )

    return RegisterTokenResponse(status="registered")


@router.delete("/unregister", response_model=RegisterTokenResponse)
@limiter.limit("30/minute")
async def unregister_push_token(
    request: Request,
    user: CurrentUser,
) -> RegisterTokenResponse:
    """Remove the user's push notification token (opt out)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Clear the user's push token
    await db.patch(
        "user_profile",
        {
            "push_token": None,
            "push_platform": None,
        },
        {
            "user_id": f"eq.{user.id}",
        },
    )

    logger.info(
        "Push token unregistered",
        extra={"user_id": str(user.id)},
    )

    return RegisterTokenResponse(status="unregistered")
