"""Invite system schemas."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr


class InviteRequest(BaseModel):
    """Request to send an invite."""

    email: EmailStr
    invite_type: Literal["follow", "trip_tag"] = "follow"
    trip_id: UUID | None = None


class InviteResponse(BaseModel):
    """Response after sending an invite."""

    status: str
    email: str


class PendingInvite(BaseModel):
    """Pending invite record."""

    id: UUID
    inviter_id: UUID
    email: str
    invite_type: str
    status: str
    created_at: datetime
    inviter_username: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PendingInviteSummary(BaseModel):
    """Summary of a pending invite for display."""

    id: str
    email: str
    invite_type: str
    status: str
    created_at: str
