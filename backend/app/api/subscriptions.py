"""Subscription management API endpoints."""

import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
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
# IMPORTANT: These values must stay in sync across all codebases!
# - TypeScript: mobile/src/stores/subscriptionStore.ts (FREE_LIMITS)
# - Swift: mobile/plugins/share-extension/Utilities/AppGroupStorage.swift (freeShareExtensionLimit)
# - CI Test: backend/tests/test_limits_consistency.py
FREE_LIMITS = {
    "share_extension": 5,
    "photo_import": 1,
    "entries_per_trip": 10,
}


@router.get("/status", response_model=SubscriptionInfo)
@limiter.limit("60/minute")
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
            "user_id": f"eq.{user.id}",
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
@limiter.limit("60/minute")
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
            "select": "usage_share_extension_count,usage_photo_import_count,usage_share_extension_period_start",
            "user_id": f"eq.{user.id}",
        },
    )

    if not result:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = result[0]

    # Calculate effective share extension count (reset if new month)
    # NOTE: The client uses the returned period_start to compute its own display hint.
    # Clients may have timezone mismatches and show "available saves" incorrectly, but
    # the actual enforcement happens in increment_share_extension_usage RPC which is
    # server-authoritative. See increment_share_extension_usage for the actual reset logic.
    share_extension_count = profile.get("usage_share_extension_count") or 0
    period_start_str = profile.get("usage_share_extension_period_start")
    period_start: datetime | None = None

    if period_start_str:
        period_start = datetime.fromisoformat(period_start_str.replace("Z", "+00:00"))
        current_month_start = datetime.now(UTC).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )

        # If period is from previous month, count is effectively 0
        if period_start < current_month_start:
            share_extension_count = 0
            period_start = None  # Signal that period has reset

    return UsageLimits(
        share_extension_count=share_extension_count,
        share_extension_limit=FREE_LIMITS["share_extension"],
        share_extension_period_start=period_start,
        photo_import_count=profile.get("usage_photo_import_count") or 0,
        photo_import_limit=FREE_LIMITS["photo_import"],
        entries_per_trip_limit=FREE_LIMITS["entries_per_trip"],
    )


@router.post("/usage/increment", response_model=IncrementUsageResponse)
@limiter.limit("30/minute")
async def increment_usage(
    body: IncrementUsageRequest,
    request: Request,
    user: CurrentUser,
) -> IncrementUsageResponse:
    """Increment usage counter for a feature."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # SECURITY: Use separate functions instead of dynamic column name
    rpc_name = ""
    if body.feature == "share_extension":
        rpc_name = "increment_share_extension_usage"
    elif body.feature == "photo_import":
        rpc_name = "increment_photo_import_usage"
    else:
        raise HTTPException(status_code=400, detail="Invalid feature")

    try:
        result = await db.rpc(rpc_name, {"p_user_id": user.id})
    except Exception as e:
        logger.error(f"RPC {rpc_name} failed for user {user.id}: {e}")
        raise HTTPException(
            status_code=502, detail=f"Failed to increment {body.feature} usage"
        ) from None

    # Validate that RPC returned a numeric count
    if result is None or not isinstance(result, int):
        logger.error(
            f"RPC {rpc_name} returned invalid result for user {user.id}: {result}"
        )
        raise HTTPException(
            status_code=500, detail=f"Invalid response from {body.feature} increment"
        )

    return IncrementUsageResponse(status="incremented", new_count=result)


@router.get("/can-add-entry/{trip_id}", response_model=CanAddEntryResponse)
@limiter.limit("60/minute")
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
            "user_id": f"eq.{user.id}",
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

    if entries_result is None:
        raise HTTPException(
            status_code=503,
            detail="Unable to check entry count. Please try again.",
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
@limiter.limit("5/minute")
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
            "user_id": f"eq.{user.id}",
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
        expires_at: datetime | None = None
        plan: str | None = None

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

                # Extract plan from product_id if available
                product_id = full_access.get("product_identifier", "")
                if "annual" in product_id.lower() or "yearly" in product_id.lower():
                    plan = "annual"
                elif "monthly" in product_id.lower():
                    plan = "monthly"
                elif "weekly" in product_id.lower():
                    plan = "weekly"
            else:
                new_status = "free"
        else:
            new_status = "free"

        # Use RPC with current time as timestamp to ensure proper event ordering
        # This ensures verify calls respect concurrent webhook updates
        now = datetime.now(UTC)
        event_id = f"verify-{user.id}-{now.isoformat()}"
        try:
            await db.rpc(
                "update_subscription_if_newer",
                {
                    "p_user_id": str(user.id),
                    "p_status": new_status,
                    "p_plan": plan,
                    "p_expires_at": expires_at.isoformat() if expires_at else None,
                    "p_revenuecat_id": customer_id,
                    "p_event_timestamp_ms": int(now.timestamp() * 1000),
                    "p_event_id": event_id,
                },
            )
        except HTTPException as e:
            # Expected: Supabase/PostgREST errors (RPC failures, constraint violations)
            logger.error(
                f"Failed to update subscription in DB: user_id={user.id}, "
                f"event_id={event_id}, error={e.detail}. "
                "RevenueCat verification passed but DB is out of sync."
            )
            return VerifySubscriptionResponse(
                status="verified_db_sync_failed",
                subscription_status=new_status,
            )

        return VerifySubscriptionResponse(
            status="verified", subscription_status=new_status
        )

    except httpx.RequestError as e:
        logger.error(f"RevenueCat API request error: {e}")
        raise HTTPException(
            status_code=502, detail="Failed to connect to RevenueCat"
        ) from None
