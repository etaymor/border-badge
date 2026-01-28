"""Webhook endpoints for external service callbacks."""

import logging
import secrets
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from app.core.config import get_settings
from app.db.session import get_supabase_client

router = APIRouter()
logger = logging.getLogger(__name__)

settings = get_settings()


@router.post("/revenuecat")
async def revenuecat_webhook(
    request: Request,
    authorization: str = Header(...),
) -> dict[str, Any]:
    """
    Handle RevenueCat subscription events.

    RevenueCat sends webhooks for subscription lifecycle events:
    - INITIAL_PURCHASE: First subscription purchase
    - RENEWAL: Subscription renewed
    - PRODUCT_CHANGE: User changed subscription tier
    - CANCELLATION: User cancelled (still active until period end)
    - UNCANCELLATION: User re-enabled auto-renew
    - EXPIRATION: Subscription expired
    - BILLING_ISSUE: Payment failed (grace period active)

    Security: Uses timing-safe comparison to prevent timing attacks.
    Idempotency: Uses event timestamp ordering to handle out-of-order delivery.
    """
    # Validate webhook authentication
    expected = settings.revenuecat_webhook_auth_header
    if not expected:
        logger.error("REVENUECAT_WEBHOOK_AUTH_HEADER not configured")
        raise HTTPException(status_code=500, detail="Webhook not configured")

    # SECURITY: Timing-safe comparison prevents timing attacks
    if not secrets.compare_digest(
        expected.encode("utf-8"), authorization.encode("utf-8")
    ):
        logger.warning("RevenueCat webhook: Invalid authorization header")
        raise HTTPException(status_code=401, detail="Invalid authorization")

    payload = await request.json()
    event = payload.get("event", {})
    event_type = event.get("type")
    app_user_id = event.get("app_user_id")
    event_id = event.get("id")

    logger.info(
        f"RevenueCat webhook: {event_type} for user {app_user_id}, event_id={event_id}"
    )

    if not app_user_id:
        return {"status": "ignored", "reason": "no_user_id"}

    # Map event types to subscription status
    status_map = {
        "INITIAL_PURCHASE": "premium",
        "RENEWAL": "premium",
        "PRODUCT_CHANGE": "premium",
        "UNCANCELLATION": "premium",
        "CANCELLATION": "premium",  # Still active until period end
        "EXPIRATION": "free",
        "BILLING_ISSUE": "premium",  # Grace period
    }

    new_status = status_map.get(event_type)
    if not new_status:
        logger.info(f"RevenueCat webhook: Ignoring unhandled event type {event_type}")
        return {"status": "ignored", "reason": f"unhandled_event_{event_type}"}

    # Check if this is a trial
    period_type = event.get("period_type")
    if period_type == "TRIAL":
        new_status = "trial"

    # Extract plan from product_id
    product_id = event.get("product_id", "")
    subscription_plan: str | None = None
    if "Annual" in product_id or "annual" in product_id or "yearly" in product_id:
        subscription_plan = "annual"
    elif "Monthly" in product_id or "monthly" in product_id:
        subscription_plan = "monthly"
    elif "Weekly" in product_id or "weekly" in product_id:
        subscription_plan = "weekly"

    # Get expiration date
    expiration_ms = event.get("expiration_at_ms")
    expires_at: str | None = None
    if expiration_ms:
        expires_at = datetime.fromtimestamp(expiration_ms / 1000, tz=UTC).isoformat()

    # Get event timestamp for ordering
    event_timestamp_ms = event.get("event_timestamp_ms", 0)

    # Update user profile with advisory lock for concurrency safety
    # None for user_token means use service role (bypasses RLS)
    supabase = get_supabase_client(user_token=None)

    # Use RPC with advisory lock for atomic update with ordering
    result = await supabase.rpc(
        "update_subscription_if_newer",
        {
            "p_user_id": app_user_id,
            "p_status": new_status,
            "p_plan": subscription_plan,
            "p_expires_at": expires_at,
            "p_revenuecat_id": event.get("original_app_user_id"),
            "p_event_timestamp_ms": event_timestamp_ms,
            "p_event_id": event_id,
        },
    )

    if result and result.get("updated"):
        logger.info(f"Updated subscription for {app_user_id}: {new_status}")
        return {"status": "success"}
    elif result and result.get("skipped"):
        logger.info(f"Skipped older event for {app_user_id}")
        return {"status": "skipped", "reason": "older_event"}
    else:
        logger.warning(f"User not found for RevenueCat event: {app_user_id}")
        return {"status": "user_not_found"}
