"""Invite system schemas."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr


class InviteRequest(BaseModel):
    """Request to send an invite."""

    email: EmailStr
    invite_type: Literal["follow", "trip_tag"] = "follow"
    trip_id: UUID | None = None


class InviteResponse(BaseModel):
    """Response after sending an invite."""

    status: str
    email: str


class PendingInviteSummary(BaseModel):
    """Summary of a pending invite for display."""

    id: str
    email: str
    invite_type: str
    status: str
    created_at: str
