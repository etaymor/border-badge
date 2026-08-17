"""Push notification registration endpoints.

Push tokens are keyed on the token itself (plan KTD11 / migration 0091):
one user holds many device tokens; a device token belongs to at most one
user. Registration transfers token ownership in one transaction;
unregistration removes a single device's token.
"""

import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_service_supabase_client, get_supabase_client
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
    Register this device's push token for the calling user.

    Upserts ON CONFLICT (token): if another user currently holds this device
    token (shared device, account switch), the DO UPDATE overwrites user_id --
    a one-transaction ownership transfer, so the previous owner stops
    receiving pushes on this device. A user's other tokens are untouched
    (multi-device).

    Security:
    - Runs under the service role deliberately: the RLS UPDATE policy only
      allows user_id = auth.uid(), so a JWT-scoped upsert could never claim
      a token still owned by another user. user_id is bound to the verified
      JWT identity, never taken from the request body.
    - Tokens are protected by Supabase encryption at rest and never exposed
      in API responses.
    """
    db = get_service_supabase_client()

    await db.upsert(
        "push_token",
        [
            {
                "user_id": str(user.id),
                "token": data.token,
                "platform": data.platform,
                "updated_at": datetime.now(UTC).isoformat(),
            }
        ],
        on_conflict="token",
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
    token: str | None = None,
) -> RegisterTokenResponse:
    """Remove push registration for the calling user (opt out / sign-out).

    With ?token=..., deletes only that device's registration -- the user's
    other devices keep receiving pushes. Without it (legacy clients from the
    one-token-per-user era), deletes all of the user's tokens.

    JWT-scoped on purpose: RLS restricts the delete to the caller's own
    rows, so a user can never unregister someone else's claim to a token.
    """
    jwt = get_token_from_request(request)
    db = get_supabase_client(user_token=jwt)

    params = {"user_id": f"eq.{user.id}"}
    if token:
        params["token"] = f"eq.{token}"

    await db.delete("push_token", params)

    logger.info(
        "Push token unregistered",
        extra={"user_id": str(user.id), "single_device": token is not None},
    )

    return RegisterTokenResponse(status="unregistered")
