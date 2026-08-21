"""Pydantic schemas for subscription management."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

SubscriptionStatus = Literal["free", "trial", "premium"]
SubscriptionPlan = Literal["weekly", "monthly", "annual"]


class SubscriptionInfo(BaseModel):
    """Current user's subscription status."""

    status: SubscriptionStatus
    plan: SubscriptionPlan | None = None
    expires_at: datetime | None = None


class UsageLimits(BaseModel):
    """Usage counts and limits for gated features."""

    share_extension_count: int
    share_extension_limit: int
    share_extension_period_start: datetime | None = None
    photo_import_count: int
    photo_import_limit: int
    photo_import_trip_id: UUID | None = None
    entries_per_trip_limit: int


class IncrementUsageRequest(BaseModel):
    """Request to increment a usage counter."""

    feature: Literal["share_extension", "photo_import"]
    trip_id: UUID | None = None
    """Trip the increment is for (photo_import only).

    Recorded server-side alongside the counter so the free-tier exemption that
    lets a user finish the import they already paid for survives a reinstall or
    a device change (R17). Ignored for other features.
    """


class IncrementUsageResponse(BaseModel):
    """Response from usage increment."""

    status: str
    new_count: int


class CanAddEntryResponse(BaseModel):
    """Response for entry limit check."""

    allowed: bool
    count: int
    limit: int
    remaining: int


class VerifySubscriptionResponse(BaseModel):
    """Response from subscription verification."""

    status: str
    subscription_status: SubscriptionStatus | None = None
