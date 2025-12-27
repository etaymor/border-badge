"""Cleanup test data."""

import logging

import httpx

from app.db.session import SupabaseClient

from .auth import delete_user

logger = logging.getLogger(__name__)


async def cleanup_test_users(
    db: SupabaseClient,
    http_client: httpx.AsyncClient,
    supabase_url: str,
    service_role_key: str,
) -> None:
    """Delete all test user data."""
    logger.info("Fetching test users...")
    test_profiles = await db.get(
        "user_profile", {"is_test": "eq.true", "select": "user_id,username"}
    )

    if not test_profiles:
        logger.info("No test users found")
        return

    test_user_ids = [p["user_id"] for p in test_profiles]
    logger.info(f"Found {len(test_user_ids)} test users to clean up")

    for profile in test_profiles:
        logger.info(f"  - @{profile['username']}")

    # Delete in FK order
    logger.info("Deleting trip_tags...")
    for user_id in test_user_ids:
        await db.delete("trip_tags", {"tagged_user_id": f"eq.{user_id}"})
        trips = await db.get("trip", {"user_id": f"eq.{user_id}", "select": "id"})
        for trip in trips:
            await db.delete("trip_tags", {"trip_id": f"eq.{trip['id']}"})

    logger.info("Deleting entries and trips...")
    for user_id in test_user_ids:
        trips = await db.get("trip", {"user_id": f"eq.{user_id}", "select": "id"})
        for trip in trips:
            await db.delete("entry", {"trip_id": f"eq.{trip['id']}"})
        await db.delete("trip", {"user_id": f"eq.{user_id}"})

    logger.info("Deleting user_countries...")
    for user_id in test_user_ids:
        await db.delete("user_countries", {"user_id": f"eq.{user_id}"})

    logger.info("Deleting follows...")
    for user_id in test_user_ids:
        await db.delete("user_follow", {"follower_id": f"eq.{user_id}"})
        await db.delete("user_follow", {"following_id": f"eq.{user_id}"})

    logger.info("Deleting pending_invite...")
    for user_id in test_user_ids:
        await db.delete("pending_invite", {"inviter_id": f"eq.{user_id}"})

    logger.info("Deleting auth users...")
    for user_id in test_user_ids:
        await delete_user(http_client, supabase_url, service_role_key, user_id)

    logger.info("Cleanup complete!")
