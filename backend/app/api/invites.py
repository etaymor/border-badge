"""Email invite system endpoints."""

import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.edge_functions import send_invite_email
from app.core.invite_signer import generate_invite_code
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.invites import (
    InviteRequest,
    InviteResponse,
    PendingInviteSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", status_code=201)
@limiter.limit("10/hour")
async def send_invite(
    request: Request,
    invite: InviteRequest,
    user: CurrentUser,
) -> InviteResponse:
    """
    Send an email invite to a non-user.

    Security:
    - Rate limited to 10/hour per user to prevent spam
    - Invite codes are HMAC-signed
    - Codes expire after 30 days

    The invite will be stored in pending_invite table and an email
    will be sent via Supabase Edge Function (when configured).
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    email_lower = invite.email.lower()

    # Check if user already exists with this email
    # Note: We search by email in auth.users which requires service role
    service_db = get_supabase_client()
    existing_user = await service_db.rpc(
        "check_email_exists",
        {"email_to_check": email_lower},
    )

    if existing_user and existing_user.get("exists"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists. Search by username instead.",
        )

    # Check if we already have a pending invite for this email from this user
    existing_invite = await db.get(
        "pending_invite",
        {
            "select": "id,status",
            "inviter_id": f"eq.{user.id}",
            "email": f"eq.{email_lower}",
            "status": "eq.pending",
        },
    )

    if existing_invite:
        return InviteResponse(status="already_pending", email=email_lower)

    # Generate secure invite code
    invite_code = generate_invite_code(user.id, email_lower)

    # Create pending_invite record
    await db.post(
        "pending_invite",
        {
            "inviter_id": str(user.id),
            "email": email_lower,
            "invite_type": invite.invite_type,
            "trip_id": str(invite.trip_id) if invite.trip_id else None,
            "invite_code": invite_code,
            "status": "pending",
        },
    )

    # Get inviter's display name for the email
    async def send_email_notification() -> None:
        try:
            inviter_profile = await service_db.get(
                "user_profile",
                {
                    "select": "display_name,username",
                    "user_id": f"eq.{user.id}",
                },
            )
            inviter_name = "Someone"
            if inviter_profile:
                inviter_name = (
                    inviter_profile[0].get("display_name")
                    or inviter_profile[0].get("username")
                    or "Someone"
                )

            await send_invite_email(
                email=email_lower,
                inviter_name=inviter_name,
                invite_code=invite_code,
                invite_type=invite.invite_type,
            )
        except Exception as e:
            logger.warning(f"Failed to send invite email: {e}")

    asyncio.create_task(send_email_notification())

    logger.info(
        "Invite created",
        extra={
            "inviter_id": str(user.id),
            "email_hash": email_lower[:3] + "***",  # Don't log full email
            "invite_type": invite.invite_type,
        },
    )

    return InviteResponse(status="sent", email=email_lower)


@router.get("/pending", response_model=list[PendingInviteSummary])
@limiter.limit("30/minute")
async def get_pending_invites(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[PendingInviteSummary]:
    """Get list of pending invites sent by the current user."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    invites = await db.get(
        "pending_invite",
        {
            "select": "id,email,invite_type,status,created_at",
            "inviter_id": f"eq.{user.id}",
            "order": "created_at.desc",
            "limit": limit,
            "offset": offset,
        },
    )

    if not invites:
        return []

    return [
        PendingInviteSummary(
            id=inv["id"],
            email=inv["email"],
            invite_type=inv["invite_type"],
            status=inv["status"],
            created_at=inv["created_at"],
        )
        for inv in invites
    ]


@router.get("/trip/{trip_id}", response_model=list[PendingInviteSummary])
@limiter.limit("30/minute")
async def get_trip_pending_invites(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> list[PendingInviteSummary]:
    """Get list of pending trip_tag invites for a specific trip."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    invites = await db.get(
        "pending_invite",
        {
            "select": "id,email,invite_type,status,created_at",
            "inviter_id": f"eq.{user.id}",
            "trip_id": f"eq.{trip_id}",
            "invite_type": "eq.trip_tag",
            "status": "eq.pending",
            "order": "created_at.desc",
        },
    )

    if not invites:
        return []

    return [
        PendingInviteSummary(
            id=inv["id"],
            email=inv["email"],
            invite_type=inv["invite_type"],
            status=inv["status"],
            created_at=inv["created_at"],
        )
        for inv in invites
    ]


@router.delete("/{invite_id}")
@limiter.limit("30/minute")
async def cancel_invite(
    request: Request,
    invite_id: UUID,
    user: CurrentUser,
) -> dict:
    """Cancel a pending invite."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Verify the invite belongs to the user
    invite = await db.get(
        "pending_invite",
        {
            "select": "id",
            "id": f"eq.{invite_id}",
            "inviter_id": f"eq.{user.id}",
        },
    )

    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found",
        )

    # Delete the invite
    await db.delete(
        "pending_invite",
        {
            "id": f"eq.{invite_id}",
            "inviter_id": f"eq.{user.id}",
        },
    )

    return {"status": "cancelled", "invite_id": str(invite_id)}
