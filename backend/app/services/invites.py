"""Shared invite-code resolution.

The public landing page (``app/api/public.py``) and the redemption endpoint
(``app/api/invites.py``) both resolve a signed invite code to its
``pending_invite`` row and the inviter's profile. They keep deliberately
different error policies -- the landing page silently degrades to a generic
install page while redemption raises 400/404 -- so this helper does only the
shared resolution and leaves policy and response shaping to the callers.
"""

from dataclasses import dataclass
from typing import Any

from app.core.invite_signer import verify_invite_code
from app.db.session import SupabaseClient


@dataclass(frozen=True)
class ResolvedInvite:
    """A validly signed invite code resolved against the database."""

    verified: dict[str, Any]
    """Payload recovered from the signed code (includes ``inviter_id``)."""

    invite: dict[str, Any] | None
    """The ``pending_invite`` row, or ``None`` when no row matches the code
    (cancelled-by-deletion, or the inviter's account -- and the row, by FK
    cascade -- is gone)."""

    inviter_profile: dict[str, Any] | None
    """The inviter's ``user_profile`` row, or ``None`` when missing."""

    @property
    def status(self) -> str | None:
        return self.invite.get("status") if self.invite else None

    @property
    def invite_type(self) -> str:
        if self.invite:
            return self.invite.get("invite_type") or "follow"
        return "follow"

    @property
    def inviter_id(self) -> str | None:
        return str(self.invite["inviter_id"]) if self.invite else None


async def resolve_invite_with_inviter(
    db: SupabaseClient,
    code: str | None,
    *,
    include_trip: bool = False,
) -> ResolvedInvite | None:
    """Resolve ``code`` to its invite row and inviter profile.

    Returns ``None`` when the code is absent, unsigned, tampered, or expired.
    Otherwise returns a :class:`ResolvedInvite`; callers decide how to treat a
    missing row, a missing profile, or a non-pending status.

    ``include_trip`` adds ``trip_id`` to the invite row's selected columns
    (redemption needs it to deliver trip_tag invites).
    """
    verified = verify_invite_code(code) if code else None
    if not verified:
        return None

    select = "id,inviter_id,invite_type,status"
    if include_trip:
        select = "id,inviter_id,invite_type,trip_id,status"
    invites = await db.get(
        "pending_invite",
        {
            "select": select,
            "invite_code": f"eq.{code}",
            "limit": 1,
        },
    )
    if not invites:
        return ResolvedInvite(verified=verified, invite=None, inviter_profile=None)

    invite = invites[0]
    profiles = await db.get(
        "user_profile",
        {
            "select": "user_id,username,display_name,avatar_url",
            "user_id": f"eq.{invite['inviter_id']}",
            "limit": 1,
        },
    )
    return ResolvedInvite(
        verified=verified,
        invite=invite,
        inviter_profile=profiles[0] if profiles else None,
    )
