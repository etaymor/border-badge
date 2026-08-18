"""Invite system schemas."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class InviteRequest(BaseModel):
    """Request to send an invite."""

    email: EmailStr
    invite_type: Literal["follow", "trip_tag"] = "follow"
    trip_id: UUID | None = None


class InviteResponse(BaseModel):
    """Response after sending an invite.

    invite_url is the public landing-page link for the invite code. It is the
    primary delivery path (native share sheet); email delivery is best-effort.
    """

    status: str
    email: str
    invite_url: str | None = None


class InviterSummary(BaseModel):
    """The inviter, as shown in the invitee's follow-back prompt."""

    user_id: str
    username: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None


class InviteRedeemRequest(BaseModel):
    """Request to redeem an invite code after signup."""

    code: str = Field(min_length=1, max_length=512)


class InviteRedeemResponse(BaseModel):
    """Response after redeeming an invite code."""

    status: Literal["redeemed", "already_redeemed"]
    invite_type: str
    inviter: InviterSummary | None = None


class PendingInviteSummary(BaseModel):
    """Summary of a pending invite for display."""

    id: str
    email: str
    invite_type: str
    status: str
    created_at: str
