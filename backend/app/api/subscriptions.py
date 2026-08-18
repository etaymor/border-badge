"""Subscription management API endpoints."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

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

# How much matching work one charged photo import buys, in clusters (F2).
#
# The R17 exemption — "the trip you already paid for stays completable" — used
# to be an unbounded replay key: a free user who spent their import on trip A
# could pass trip A forever, bounded only by the per-minute cost budgets. The
# charge now records a finite cluster allowance that every later request for
# that trip draws down.
#
# 500 is chosen against the shape of a real import rather than a round number:
# a large trip is 50-100 clusters (a very large multi-city one, 200-300), so
# this leaves roughly 2-5x headroom for retrying failed clusters and for
# re-running the import after adding more photos to the same trip -- the whole
# point of R17 -- while capping a free account's lifetime metered exposure at
# 500 Nearby Search lookups instead of the previous "unbounded". Keep it in
# sync with the literal in migration 0058 (asserted by the tests).
PHOTO_IMPORT_CLUSTER_ALLOWANCE = 500

# Columns that describe a caller's photo-import entitlement. Kept next to the
# limits so the endpoint that enforces them (POST /photos/suggest-places) reads
# the same shape this module writes.
PHOTO_IMPORT_PROFILE_COLUMNS = (
    "subscription_status,usage_photo_import_count,"
    "usage_photo_import_trip_id,usage_photo_import_cluster_allowance"
)

# The pre-0058 shape of the same read. A backend that ships ahead of its
# migration must degrade to the columns that already exist rather than 400 on
# every request -- see `read_photo_import_entitlement`.
LEGACY_PHOTO_IMPORT_PROFILE_COLUMNS = "subscription_status,usage_photo_import_count"

USAGE_COLUMNS = (
    "usage_share_extension_count,usage_photo_import_count,"
    "usage_share_extension_period_start,usage_photo_import_trip_id"
)
LEGACY_USAGE_COLUMNS = (
    "usage_share_extension_count,usage_photo_import_count,"
    "usage_share_extension_period_start"
)

# PostgREST surfaces an unknown column as a 400 carrying PostgreSQL's 42703
# ("column ... does not exist"); `SupabaseClient` keeps only the message, so the
# code is matched on either. An unknown FUNCTION (or an unknown argument set for
# a known one) is PGRST202.
_MISSING_COLUMN_HINTS = ("42703", "does not exist")
_MISSING_FUNCTION_HINTS = ("pgrst202", "could not find the function")


def _error_text(error: BaseException) -> str:
    detail = getattr(error, "detail", None)
    return str(detail if detail is not None else error).lower()


def is_missing_column_error(error: BaseException, *columns: str) -> bool:
    """Whether `error` is PostgREST rejecting a select for an unknown column."""
    if getattr(error, "status_code", None) not in (400, 404):
        return False
    text = _error_text(error)
    if not any(hint in text for hint in _MISSING_COLUMN_HINTS):
        return False
    return any(column.lower() in text for column in columns)


def is_missing_function_error(error: BaseException) -> bool:
    """Whether `error` is PostgREST failing to resolve an RPC signature."""
    if getattr(error, "status_code", None) not in (400, 404):
        return False
    text = _error_text(error)
    return any(hint in text for hint in _MISSING_FUNCTION_HINTS)


@dataclass(frozen=True)
class PhotoImportEntitlement:
    """A caller's right to run a photo import, as the server knows it.

    The consumed trip is recorded server-side alongside the counter (U16/KTD23)
    so the exemption that lets a user finish the import they already paid for
    has the same lifetime as the charge: it survives reinstall, a device change,
    and any client-side marker being cleared.
    """

    subscription_status: str
    photo_import_count: int
    consumed_trip_id: str | None
    cluster_allowance: int = 0
    # True when the profile row was read WITHOUT the U16 columns because
    # migration 0058 has not been applied yet. The gate then degrades open --
    # see `allows`.
    columns_degraded: bool = False

    @property
    def is_premium(self) -> bool:
        return self.subscription_status in ("premium", "trial")

    @property
    def limit(self) -> int:
        return FREE_LIMITS["photo_import"]

    def allows(self, trip_id: str | None) -> bool:
        """Whether this caller may run matching for `trip_id`."""
        if self.is_premium:
            return True
        if self.columns_degraded:
            # A backend running ahead of migration 0058 cannot see the recorded
            # trip, so it cannot tell "spent their import" from "still finishing
            # the import they spent". Enforcing on the counter alone would 402
            # every free user mid-import; the safe degradation is the behaviour
            # that shipped before the counter was enforced at all. The server
            # side charge is skipped in the same state, so the counter is not
            # advanced behind the user's back either.
            return True
        if self.photo_import_count < self.limit:
            return True
        # R17: the already-counted trip stays completable, on any device...
        if trip_id is None or self.consumed_trip_id is None:
            return False
        if str(trip_id).lower() != str(self.consumed_trip_id).lower():
            return False
        # ...but only for as much work as that one charge bought (F2).
        return self.cluster_allowance > 0


async def read_photo_import_entitlement(
    db: Any, user_id: str
) -> PhotoImportEntitlement:
    """Read a user's photo-import entitlement from their profile row.

    A missing profile row is treated as a brand-new free user (count 0), which
    matches how entry-limit enforcement reads a missing profile. Database
    failures are NOT swallowed here — the caller decides how to fail.

    The U16 columns are read tolerantly: if migration 0058 has not been applied,
    PostgREST 400s the select for an unknown column and this falls back to the
    pre-U16 column set with the entitlement marked degraded. A lagging migration
    must not turn every caller's request -- premium included -- into a 503.
    """
    degraded = False
    try:
        result = await db.get(
            "user_profile",
            params={
                "select": PHOTO_IMPORT_PROFILE_COLUMNS,
                "user_id": f"eq.{user_id}",
            },
        )
    except Exception as e:
        if not is_missing_column_error(
            e,
            "usage_photo_import_trip_id",
            "usage_photo_import_cluster_allowance",
        ):
            raise
        logger.error(
            "Photo import entitlement columns are missing (migration 0058 has "
            "not been applied). Falling back to the pre-U16 column set and "
            "leaving the free-tier gate unenforced until it is."
        )
        degraded = True
        result = await db.get(
            "user_profile",
            params={
                "select": LEGACY_PHOTO_IMPORT_PROFILE_COLUMNS,
                "user_id": f"eq.{user_id}",
            },
        )

    profile = result[0] if result else {}
    return PhotoImportEntitlement(
        subscription_status=profile.get("subscription_status") or "free",
        photo_import_count=profile.get("usage_photo_import_count") or 0,
        consumed_trip_id=None
        if degraded
        else profile.get("usage_photo_import_trip_id"),
        cluster_allowance=(
            0 if degraded else profile.get("usage_photo_import_cluster_allowance") or 0
        ),
        columns_degraded=degraded,
    )


async def _call_increment_rpc(db: Any, rpc_name: str, rpc_args: dict[str, Any]) -> Any:
    """Call an increment RPC, retrying without the trip arg if it has no such
    overload.

    Migration 0058 is what teaches `increment_photo_import_usage` about
    `p_trip_id`. Until it is applied PostgREST cannot resolve the two-argument
    call and answers PGRST202, which would turn every client-side usage report
    into a 502. Falling back to the argument set that does exist keeps the
    pre-0058 behaviour intact for exactly as long as the migration lags.
    """
    try:
        return await db.rpc(rpc_name, rpc_args)
    except Exception as e:
        if "p_trip_id" not in rpc_args or not is_missing_function_error(e):
            raise
        logger.error(
            "%s has no trip-aware overload (migration 0058 has not been "
            "applied); retrying without p_trip_id",
            rpc_name,
        )
        fallback = {
            key: value
            for key, value in rpc_args.items()
            if key not in ("p_trip_id", "p_clusters")
        }
        return await db.rpc(rpc_name, fallback)


async def charge_photo_import_usage(
    db: Any, user_id: str, trip_id: str | None, cluster_count: int
) -> int | None:
    """Spend one photo import server-side for work that was actually performed.

    This is the authoritative charge (F1). The counter used to be written only
    by the mobile client volunteering a call to `POST /usage/increment`, so
    blocking that one request left the count at 0 forever and the gate above it
    enforced a number the client controlled.

    The RPC is first-trip-wins and does not re-charge the trip it already
    recorded, so the client's own mirror call remains safe to make.

    Returns:
        The new count, or None when the trip-aware RPC does not exist yet
        (migration 0058 not applied) -- in which case nothing is charged, so a
        lagging migration cannot strand a free user mid-import.
    """
    try:
        result = await db.rpc(
            "increment_photo_import_usage",
            {
                "p_user_id": user_id,
                "p_trip_id": trip_id,
                "p_clusters": max(0, cluster_count),
            },
        )
    except Exception as e:
        if not is_missing_function_error(e):
            raise
        logger.error(
            "increment_photo_import_usage(p_user_id, p_trip_id, p_clusters) is "
            "missing (migration 0058 has not been applied). The photo import "
            "was NOT charged server-side."
        )
        return None
    return result if isinstance(result, int) else None


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

    # Column-tolerant for the same reason as `read_photo_import_entitlement`:
    # this query backs the app-wide usage/paywall state, so a backend that ships
    # ahead of migration 0058 must lose the trip id, not the endpoint.
    try:
        result = await db.get(
            "user_profile",
            params={"select": USAGE_COLUMNS, "user_id": f"eq.{user.id}"},
        )
        usage_columns_degraded = False
    except Exception as e:
        if not is_missing_column_error(e, "usage_photo_import_trip_id"):
            raise
        logger.error(
            "usage_photo_import_trip_id is missing (migration 0058 has not been "
            "applied). Serving usage limits without the consumed trip id."
        )
        usage_columns_degraded = True
        result = await db.get(
            "user_profile",
            params={"select": LEGACY_USAGE_COLUMNS, "user_id": f"eq.{user.id}"},
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
        # R17: the trip the consumed import was spent on. The client needs it at
        # every gate that guards entry to matching so a user who has used their
        # free import can still finish that one trip.
        photo_import_trip_id=(
            None
            if usage_columns_degraded
            else profile.get("usage_photo_import_trip_id")
        ),
        entries_per_trip_limit=FREE_LIMITS["entries_per_trip"],
    )


@router.post("/usage/increment", response_model=IncrementUsageResponse)
@limiter.limit("30/minute")
async def increment_usage(
    body: IncrementUsageRequest,
    request: Request,
    user: CurrentUser,
) -> IncrementUsageResponse:
    """Increment usage counter for a feature.

    For `photo_import` this is an idempotent MIRROR of the server-side charge
    that `POST /photos/suggest-places` now makes for itself (F1): the RPC is
    first-trip-wins and does not re-charge the trip it already recorded, so a
    client that also reports its usage costs nothing extra. Blocking this call
    no longer buys the caller anything.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # SECURITY: Use separate functions instead of dynamic column name
    rpc_name = ""
    rpc_args: dict[str, Any] = {"p_user_id": user.id}
    if body.feature == "share_extension":
        rpc_name = "increment_share_extension_usage"
    elif body.feature == "photo_import":
        rpc_name = "increment_photo_import_usage"
        # Record WHICH trip consumed the import. The RPC keeps the first trip
        # it is told about and does not re-charge for that same trip, so a
        # re-entry after reinstall neither costs a second import nor loses the
        # R17 exemption.
        rpc_args["p_trip_id"] = str(body.trip_id) if body.trip_id else None
    else:
        raise HTTPException(status_code=400, detail="Invalid feature")

    try:
        result = await _call_increment_rpc(db, rpc_name, rpc_args)
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
            # Catch DB errors (Supabase PostgREST and network errors surface
            # as HTTPException from SupabaseClient) so that a successful
            # RevenueCat verification still returns to the client.
            logger.error(
                f"Failed to update subscription in DB: user_id={user.id}, "
                f"event_id={event_id}, error={e.detail}. "
                "RevenueCat verification passed but DB is out of sync."
            )
            return VerifySubscriptionResponse(
                status="verified_db_sync_failed",
                subscription_status=new_status,
            )
        except Exception:
            logger.exception(
                f"Unexpected error in subscription verification: "
                f"user_id={user.id}, event_id={event_id}"
            )
            raise

        return VerifySubscriptionResponse(
            status="verified", subscription_status=new_status
        )

    except httpx.RequestError as e:
        logger.error(f"RevenueCat API request error: {e}")
        raise HTTPException(
            status_code=502, detail="Failed to connect to RevenueCat"
        ) from None
