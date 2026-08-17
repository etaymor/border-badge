"""Email invite system endpoints."""

import asyncio
import hashlib
import logging
from datetime import UTC, datetime
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request, is_duplicate_key_error
from app.core.config import get_settings
from app.core.db_utils import get_rpc_first_row
from app.core.edge_functions import send_invite_email, send_push_notification
from app.core.invite_signer import generate_invite_code, verify_invite_code
from app.core.notifications import get_user_push_tokens, profile_display_name
from app.core.security import CurrentUser
from app.db.session import get_service_supabase_client, get_supabase_client
from app.main import limiter
from app.schemas.invites import (
    InviteRedeemRequest,
    InviteRedeemResponse,
    InviteRequest,
    InviteResponse,
    InviterSummary,
    PendingInviteSummary,
)
from app.schemas.trips import TripTagStatus

logger = logging.getLogger(__name__)

router = APIRouter()


def build_invite_url(invite_code: str | None, ref: str | None = None) -> str | None:
    """Public landing-page URL for an invite code.

    This link is the invite's primary delivery path: the app hands it to the
    native share sheet, and the optional Resend email carries the same URL.
    A missing email provider therefore never silently drops the invite.

    ``ref`` carries the inviter's username so the landing page logs share
    attribution alongside the code's deterministic attribution.
    """
    if not invite_code:
        return None
    base_url = get_settings().base_url.rstrip("/")
    params = {"code": invite_code}
    if ref:
        params["ref"] = ref
    return f"{base_url}/invite?{urlencode(params)}"


@router.post("", status_code=201)
@limiter.limit("10/hour")
async def send_invite(
    request: Request,
    invite: InviteRequest,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
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

    # Three independent reads, run concurrently:
    # - Does a user already exist with this email? Use service role: the
    #   auth.users table requires admin access for email lookups, and the
    #   'check_email_exists' RPC is SECURITY DEFINER and validates input.
    # - Inviter's display name/username: the name personalizes the email and
    #   the username rides on the invite URL as ?ref= attribution.
    # - Is there already a pending invite for this email from this user?
    service_db = get_service_supabase_client()
    existing_user_result, inviter_profile, existing_invite = await asyncio.gather(
        service_db.rpc(
            "check_email_exists",
            {"email_to_check": email_lower},
        ),
        db.get(
            "user_profile",
            {
                "select": "display_name,username",
                "user_id": f"eq.{user.id}",
            },
        ),
        db.get(
            "pending_invite",
            {
                "select": "id,status,invite_code",
                "inviter_id": f"eq.{user.id}",
                "email": f"eq.{email_lower}",
                "status": "eq.pending",
            },
        ),
    )

    existing_user = get_rpc_first_row(existing_user_result)
    if existing_user and existing_user.get("exists"):
        # Generic message to prevent email enumeration attacks
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to send invite. Please try a different email or search by username.",
        )

    inviter_name = "Someone"
    inviter_username: str | None = None
    if inviter_profile:
        inviter_username = inviter_profile[0].get("username")
        inviter_name = profile_display_name(inviter_profile[0])

    if existing_invite:
        # Surface the existing link so the user can re-share it.
        return InviteResponse(
            status="already_pending",
            email=email_lower,
            invite_url=build_invite_url(
                existing_invite[0].get("invite_code"), ref=inviter_username
            ),
        )

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

    async def send_email_notification() -> None:
        try:
            await send_invite_email(
                email=email_lower,
                inviter_name=inviter_name,
                invite_code=invite_code,
                invite_type=invite.invite_type,
            )
        except Exception as e:
            logger.warning(f"Failed to send invite email: {e}")

    background_tasks.add_task(send_email_notification)

    logger.info(
        "Invite created",
        extra={
            "inviter_id": str(user.id),
            "email_hash": hashlib.sha256(email_lower.encode()).hexdigest()[:8],
            "invite_type": invite.invite_type,
        },
    )

    return InviteResponse(
        status="sent",
        email=email_lower,
        invite_url=build_invite_url(invite_code, ref=inviter_username),
    )


@router.post("/redeem", response_model=InviteRedeemResponse)
@limiter.limit("30/minute")
async def redeem_invite(
    request: Request,
    payload: InviteRedeemRequest,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> InviteRedeemResponse:
    """
    Redeem an invite code after signup: deterministic invite attribution.

    The signed code identifies exactly one invite row, so attribution works
    even when the account's email does not match the invited address --
    notably Apple private-relay signups, which defeat the email-match
    fallback that runs inside the signup trigger
    (process_pending_invites_for_user).

    Semantics:
    - Creates the inviter -> redeemer follow (the mobile app then prompts the
      redeemer to follow back) and, for trip_tag invites, a *pending* trip tag
      (consent workflow: the tag needs the redeemer's approval).
    - Marks the invite accepted exactly once; a retry after success is a
      no-op that still returns the inviter. Expired or invalid codes redeem
      nothing and are never marked accepted.
    - Email-match at signup remains the fallback path, and deliberately
      auto-connects *all* users who invited that email. This
      endpoint is narrower: it redeems only the invite whose link the
      recipient actually followed.
    - Invites are email-keyed and survive the invited account's deletion; a
      re-signup of that email is a fresh consent decision. Redemption
      attributes the inviter but assumes nothing from any deleted account's
      history.

    Uses the service-role client: the invite row belongs to the inviter, so
    the redeemer's JWT cannot read or update it under RLS.
    """
    verified = verify_invite_code(payload.code)
    if not verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite code is invalid or has expired",
        )

    db = get_service_supabase_client()

    invites = await db.get(
        "pending_invite",
        {
            "select": "id,inviter_id,invite_type,trip_id,status",
            "invite_code": f"eq.{payload.code}",
            "limit": 1,
        },
    )
    if not invites:
        # Cancelled by the inviter, or the inviter's account (and the row,
        # by FK cascade) is gone: the invite no longer stands.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found",
        )

    invite = invites[0]
    inviter_id = str(invite["inviter_id"])

    # Defense in depth: the row's inviter must match the code's signature.
    if inviter_id != str(verified["inviter_id"]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found",
        )

    if inviter_id == str(user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot redeem your own invite",
        )

    profiles = await db.get(
        "user_profile",
        {
            "select": "user_id,username,display_name,avatar_url",
            "user_id": f"eq.{inviter_id}",
            "limit": 1,
        },
    )
    if not profiles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found",
        )
    profile = profiles[0]
    inviter = InviterSummary(
        user_id=inviter_id,
        username=profile.get("username"),
        display_name=profile.get("display_name"),
        avatar_url=profile.get("avatar_url"),
    )
    invite_type = invite.get("invite_type") or "follow"

    if invite.get("status") != "pending":
        # Already redeemed (this user's retry, or the email-match fallback got
        # there first). No new side effects.
        return InviteRedeemResponse(
            status="already_redeemed",
            invite_type=invite_type,
            inviter=inviter,
        )

    # For trip_tag invites, create the *pending* tag (consent workflow) if the
    # trip is still alive. A dead trip cannot deliver the invite's promise, so
    # the invite is left unconsumed (mirrors the signup-trigger semantics).
    mark_accepted = True
    if invite_type == "trip_tag":
        trip_id = invite.get("trip_id")
        trips = (
            await db.get(
                "trip",
                {
                    "select": "id,user_id",
                    "id": f"eq.{trip_id}",
                    "deleted_at": "is.null",
                    "limit": 1,
                },
            )
            if trip_id
            else []
        )
        if trips:
            try:
                await db.post(
                    "trip_tags",
                    {
                        "trip_id": str(trip_id),
                        "tagged_user_id": str(user.id),
                        "initiated_by": str(trips[0]["user_id"]),
                        "status": TripTagStatus.PENDING.value,
                    },
                )
            except Exception as e:
                if not is_duplicate_key_error(e):
                    raise
        else:
            mark_accepted = False

    # The follow half of the invite: inviter follows the redeemer. The
    # prevent_follow_when_blocked trigger still enforces blocks atomically.
    try:
        await db.post(
            "user_follow",
            {
                "follower_id": inviter_id,
                "following_id": str(user.id),
            },
        )
    except Exception as e:
        error_msg = str(e).lower()
        if is_duplicate_key_error(error_msg):
            pass  # already following -- fine
        elif "cannot follow" in error_msg or "blocked" in error_msg:
            # A blocked pair redeems nothing and the invite stays unmarked.
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot redeem this invite",
            ) from None
        else:
            raise

    if mark_accepted:
        # Conditional update guarantees accepted-exactly-once: a concurrent
        # redemption or the signup trigger may have won the race, in which
        # case zero rows update and that is fine -- our follow exists.
        await db.patch(
            "pending_invite",
            data={
                "status": "accepted",
                "accepted_at": datetime.now(UTC).isoformat(),
            },
            params={
                "id": f"eq.{invite['id']}",
                "status": "eq.pending",
            },
        )

    # Close the feedback loop: tell the inviter their invite converted.
    async def notify_inviter() -> None:
        try:
            admin_db = get_service_supabase_client()

            tokens = await get_user_push_tokens(admin_db, inviter_id)
            if not tokens:
                return

            redeemer_profile = await admin_db.get(
                "user_profile",
                {
                    "select": "username,display_name",
                    "user_id": f"eq.{user.id}",
                },
            )
            redeemer_name = "Someone"
            redeemer_username = ""
            if redeemer_profile:
                redeemer_name = profile_display_name(redeemer_profile[0])
                redeemer_username = redeemer_profile[0].get("username") or ""

            await send_push_notification(
                tokens=tokens,
                title="Invite Accepted",
                body=f"{redeemer_name} accepted your invite",
                data={
                    "screen": "UserProfile",
                    "userId": str(user.id),
                    "username": redeemer_username,
                },
            )
        except Exception as e:
            logger.warning(
                f"Failed to send invite-accepted notification: {e}", exc_info=True
            )

    background_tasks.add_task(notify_inviter)

    return InviteRedeemResponse(
        status="redeemed",
        invite_type=invite_type,
        inviter=inviter,
    )


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
