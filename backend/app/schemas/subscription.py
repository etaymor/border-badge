"""Pydantic schemas for subscription management."""

from datetime import datetime
from typing import Literal

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
    photo_import_count: int
    photo_import_limit: int
    entries_per_trip_limit: int


class IncrementUsageRequest(BaseModel):
    """Request to increment a usage counter."""

    feature: Literal["share_extension", "photo_import"]


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
