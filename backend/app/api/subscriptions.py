"""Subscription management API endpoints."""

import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.schemas.subscription import (
    CanAddEntryResponse,
    IncrementUsageRequest,
    IncrementUsageResponse,
    SubscriptionInfo,
    UsageLimits,
    VerifySubscriptionResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)

settings = get_settings()

# Free tier limits (must match mobile constants)
FREE_LIMITS = {
    "share_extension": 5,
    "photo_import": 1,
    "entries_per_trip": 10,
}


@router.get("/status", response_model=SubscriptionInfo)
async def get_subscription_status(
    request: Request,
    user: CurrentUser,
) -> SubscriptionInfo:
    """Get current user's subscription status."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    result = await db.get(
        "user_profile",
        params={
            "select": "subscription_status,subscription_plan,subscription_expires_at",
            "id": f"eq.{user.id}",
        },
    )

    if not result:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = result[0]
    return SubscriptionInfo(
        status=profile.get("subscription_status") or "free",
        plan=profile.get("subscription_plan"),
        expires_at=profile.get("subscription_expires_at"),
    )


@router.get("/usage", response_model=UsageLimits)
async def get_usage_limits(
    request: Request,
    user: CurrentUser,
) -> UsageLimits:
    """Get current user's usage counts and limits."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    result = await db.get(
        "user_profile",
        params={
            "select": "usage_share_extension_count,usage_photo_import_count",
            "id": f"eq.{user.id}",
        },
    )

    if not result:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = result[0]
    return UsageLimits(
        share_extension_count=profile.get("usage_share_extension_count") or 0,
        share_extension_limit=FREE_LIMITS["share_extension"],
        photo_import_count=profile.get("usage_photo_import_count") or 0,
        photo_import_limit=FREE_LIMITS["photo_import"],
        entries_per_trip_limit=FREE_LIMITS["entries_per_trip"],
    )


@router.post("/usage/increment", response_model=IncrementUsageResponse)
async def increment_usage(
    body: IncrementUsageRequest,
    request: Request,
    user: CurrentUser,
) -> IncrementUsageResponse:
    """Increment usage counter for a feature."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # SECURITY: Use separate functions instead of dynamic column name
    if body.feature == "share_extension":
        result = await db.rpc(
            "increment_share_extension_usage",
            {"p_user_id": user.id},
        )
    elif body.feature == "photo_import":
        result = await db.rpc(
            "increment_photo_import_usage",
            {"p_user_id": user.id},
        )
    else:
        raise HTTPException(status_code=400, detail="Invalid feature")

    return IncrementUsageResponse(status="incremented", new_count=result or 0)


@router.get("/can-add-entry/{trip_id}", response_model=CanAddEntryResponse)
async def can_add_entry(
    trip_id: str,
    request: Request,
    user: CurrentUser,
) -> CanAddEntryResponse:
    """
    Check if user can add another entry to a trip (UX optimization only).

    Note: This is for client-side UX hints. The actual enforcement
    MUST happen in the entry creation endpoint to prevent bypass.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Get subscription status
    profile_result = await db.get(
        "user_profile",
        params={
            "select": "subscription_status",
            "id": f"eq.{user.id}",
        },
    )

    if not profile_result:
        raise HTTPException(status_code=404, detail="Profile not found")

    status = profile_result[0].get("subscription_status") or "free"
    if status in ("premium", "trial"):
        return CanAddEntryResponse(
            allowed=True,
            count=0,
            limit=FREE_LIMITS["entries_per_trip"],
            remaining=FREE_LIMITS["entries_per_trip"],
        )

    # Count existing entries (non-deleted)
    entries_result = await db.get(
        "entry",
        params={
            "select": "id",
            "trip_id": f"eq.{trip_id}",
            "deleted_at": "is.null",
        },
    )

    count = len(entries_result)
    limit = FREE_LIMITS["entries_per_trip"]
    allowed = count < limit

    return CanAddEntryResponse(
        allowed=allowed,
        count=count,
        limit=limit,
        remaining=max(0, limit - count),
    )


@router.post("/verify", response_model=VerifySubscriptionResponse)
async def verify_subscription(
    request: Request,
    user: CurrentUser,
) -> VerifySubscriptionResponse:
    """
    Verify subscription with RevenueCat API directly.

    Fallback for missed webhooks - queries RevenueCat API to get current
    subscription status and updates the database if needed.
    """
    if not settings.revenuecat_api_key:
        raise HTTPException(
            status_code=501, detail="RevenueCat verification not configured"
        )

    db = get_supabase_client(user_token=None)  # Service role for update

    # Get user's RevenueCat customer ID
    profile_result = await db.get(
        "user_profile",
        params={
            "select": "revenuecat_customer_id",
            "id": f"eq.{user.id}",
        },
    )

    if not profile_result:
        raise HTTPException(status_code=404, detail="Profile not found")

    customer_id = profile_result[0].get("revenuecat_customer_id") or user.id

    # Query RevenueCat API directly
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://api.revenuecat.com/v1/subscribers/{customer_id}",
                headers={"Authorization": f"Bearer {settings.revenuecat_api_key}"},
                timeout=10.0,
            )

        if response.status_code != 200:
            logger.error(
                f"RevenueCat API error: {response.status_code} {response.text}"
            )
            raise HTTPException(
                status_code=502, detail="Failed to verify with RevenueCat"
            )

        data = response.json()
        entitlements = data.get("subscriber", {}).get("entitlements", {})
        # Match entitlement ID from RevenueCat dashboard
        full_access = entitlements.get("Full Access", {})

        # Determine subscription status
        new_status: str | None = None
        if full_access.get("expires_date"):
            expires_at = datetime.fromisoformat(
                full_access["expires_date"].replace("Z", "+00:00")
            )
            is_active = expires_at > datetime.now(UTC)

            if is_active:
                # Check if trial
                if "trial" in full_access.get("period_type", "").lower():
                    new_status = "trial"
                else:
                    new_status = "premium"

                # Update database
                await db.patch(
                    "user_profile",
                    data={
                        "subscription_status": new_status,
                        "subscription_expires_at": expires_at.isoformat(),
                        "subscription_last_verified_at": datetime.now(UTC).isoformat(),
                    },
                    params={"id": f"eq.{user.id}"},
                )
            else:
                new_status = "free"
                await db.patch(
                    "user_profile",
                    data={
                        "subscription_status": "free",
                        "subscription_last_verified_at": datetime.now(UTC).isoformat(),
                    },
                    params={"id": f"eq.{user.id}"},
                )

        return VerifySubscriptionResponse(
            status="verified", subscription_status=new_status
        )

    except httpx.RequestError as e:
        logger.error(f"RevenueCat API request error: {e}")
        raise HTTPException(
            status_code=502, detail="Failed to connect to RevenueCat"
        ) from None
