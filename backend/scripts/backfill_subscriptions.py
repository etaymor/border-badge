#!/usr/bin/env python3
"""One-time backfill: sync subscription status from RevenueCat to user_profile.

Queries RevenueCat API for each user and updates the DB with the correct
subscription status. Needed because migration 0050's session_user guard
silently blocked all webhook and verify RPC calls.

Usage:
    cd backend
    poetry run python scripts/backfill_subscriptions.py --dry-run   # preview
    poetry run python scripts/backfill_subscriptions.py              # apply
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx

# Add backend root to sys.path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import get_settings  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# RevenueCat rate limit: 10 req/s. Stay well under.
RC_DELAY_SECONDS = 0.18


async def fetch_free_users(settings) -> list[dict]:
    """Fetch user_profile rows with subscription_status='free'."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        url = f"{settings.supabase_url}/rest/v1/user_profile"
        headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        }
        params = {
            "select": "user_id,subscription_status,revenuecat_customer_id",
            "subscription_status": "eq.free",
        }
        response = await client.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()


async def query_revenuecat(
    client: httpx.AsyncClient, api_key: str, user_id: str
) -> dict | None:
    """Query RevenueCat subscriber API. Returns subscriber data or None."""
    url = f"https://api.revenuecat.com/v1/subscribers/{user_id}"
    headers = {"Authorization": f"Bearer {api_key}"}

    for attempt in range(3):
        try:
            response = await client.get(url, headers=headers, timeout=10.0)
            if response.status_code == 404:
                return None
            if response.status_code == 429:
                wait = 2 ** (attempt + 1)
                logger.warning(f"  Rate limited, waiting {wait}s...")
                await asyncio.sleep(wait)
                continue
            response.raise_for_status()
            return response.json()
        except httpx.RequestError as e:
            if attempt == 2:
                logger.error(f"  Request failed after 3 attempts: {e}")
                return None
            await asyncio.sleep(1)

    return None


def parse_entitlement(data: dict) -> tuple[str, str | None, str | None]:
    """Parse 'Full Access' entitlement from RevenueCat response.

    Returns (status, plan, expires_at_iso).
    Mirrors logic from subscriptions.py verify endpoint.
    """
    entitlements = data.get("subscriber", {}).get("entitlements", {})
    full_access = entitlements.get("Full Access", {})

    if not full_access.get("expires_date"):
        return ("free", None, None)

    expires_at = datetime.fromisoformat(
        full_access["expires_date"].replace("Z", "+00:00")
    )
    is_active = expires_at > datetime.now(UTC)

    if not is_active:
        return ("free", None, expires_at.isoformat())

    # Determine status (trial vs premium)
    period_type = full_access.get("period_type", "").lower()
    status = "trial" if "trial" in period_type else "premium"

    # Extract plan from product_id
    product_id = full_access.get("product_identifier", "").lower()
    plan = None
    if "annual" in product_id or "yearly" in product_id:
        plan = "annual"
    elif "monthly" in product_id:
        plan = "monthly"
    elif "weekly" in product_id:
        plan = "weekly"

    return (status, plan, expires_at.isoformat())


async def update_user(
    settings, user_id: str, status: str, plan: str | None, expires_at: str | None
) -> bool:
    """Update user_profile via update_subscription_if_newer RPC."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        url = f"{settings.supabase_url}/rest/v1/rpc/update_subscription_if_newer"
        headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        }
        now = datetime.now(UTC)
        data = {
            "p_user_id": str(user_id),
            "p_status": status,
            "p_plan": plan,
            "p_expires_at": expires_at,
            "p_revenuecat_id": user_id,
            "p_event_timestamp_ms": int(now.timestamp() * 1000),
            "p_event_id": f"backfill-{user_id}-{now.isoformat()}",
        }
        response = await client.post(url, headers=headers, json=data)
        response.raise_for_status()
        result = response.json()
        return result.get("updated", False)


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill subscription status from RevenueCat"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without writing to DB"
    )
    args = parser.parse_args()

    settings = get_settings()
    if not settings.revenuecat_api_key:
        logger.error("REVENUECAT_API_KEY not set in .env")
        sys.exit(1)
    if not settings.supabase_service_role_key:
        logger.error("SUPABASE_SERVICE_ROLE_KEY not set in .env")
        sys.exit(1)

    logger.info("Fetching users with subscription_status='free'...")
    users = await fetch_free_users(settings)
    logger.info(f"Found {len(users)} free users to check")

    if not users:
        logger.info("No users to process. Done.")
        return

    stats = {
        "total": len(users),
        "updated_premium": 0,
        "updated_trial": 0,
        "no_subscription": 0,
        "already_expired": 0,
        "errors": 0,
    }

    async with httpx.AsyncClient() as rc_client:
        for i, user in enumerate(users, 1):
            user_id = user["user_id"]
            logger.info(f"[{i}/{len(users)}] Checking {user_id}...")

            await asyncio.sleep(RC_DELAY_SECONDS)

            rc_data = await query_revenuecat(
                rc_client, settings.revenuecat_api_key, user_id
            )

            if rc_data is None:
                logger.info("  No RevenueCat subscriber found")
                stats["no_subscription"] += 1
                continue

            status, plan, expires_at = parse_entitlement(rc_data)

            if status == "free":
                if expires_at:
                    logger.info(f"  Subscription expired ({expires_at})")
                    stats["already_expired"] += 1
                else:
                    logger.info("  No active entitlement")
                    stats["no_subscription"] += 1
                continue

            if args.dry_run:
                logger.info(
                    f"  [DRY RUN] Would update: {status}, plan={plan}, "
                    f"expires={expires_at}"
                )
            else:
                try:
                    await update_user(settings, user_id, status, plan, expires_at)
                    logger.info(
                        f"  Updated: {status}, plan={plan}, expires={expires_at}"
                    )
                except Exception as e:
                    logger.error(f"  Failed to update: {e}")
                    stats["errors"] += 1
                    continue

            if status == "premium":
                stats["updated_premium"] += 1
            elif status == "trial":
                stats["updated_trial"] += 1

    mode = "[DRY RUN] " if args.dry_run else ""
    logger.info("")
    logger.info(f"{mode}Backfill Summary:")
    logger.info(f"  Total users checked:    {stats['total']}")
    logger.info(f"  Updated to premium:     {stats['updated_premium']}")
    logger.info(f"  Updated to trial:       {stats['updated_trial']}")
    logger.info(f"  No RC subscription:     {stats['no_subscription']}")
    logger.info(f"  Already expired:        {stats['already_expired']}")
    logger.info(f"  Errors:                 {stats['errors']}")


if __name__ == "__main__":
    asyncio.run(main())
