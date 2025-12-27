#!/usr/bin/env python3
"""
Seed test users with social content for demos.

Usage:
    poetry run python scripts/seed_test_users.py
    poetry run python scripts/seed_test_users.py --real-user-id UUID
    poetry run python scripts/seed_test_users.py --cleanup-only
"""

import argparse
import asyncio
import logging
import random
import sys
from pathlib import Path

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from seed.auth import create_user  # noqa: E402
from seed.cleanup import cleanup_test_users  # noqa: E402
from seed.database import (  # noqa: E402
    create_follow,
    create_trip_tag,
    seed_trips_for_user,
    update_profile,
)
from seed.personas import PERSONAS, TEST_PASSWORD  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import (  # noqa: E402
    close_http_client,
    get_http_client,
    get_service_supabase_client,
)

logger = logging.getLogger(__name__)


async def seed_all(real_user_id: str | None = None) -> None:
    """Main seeding function."""
    settings = get_settings()
    http_client = get_http_client()
    db = get_service_supabase_client()

    logger.info("=" * 50)
    logger.info("Seeding test users...")
    logger.info("=" * 50)

    # Cleanup first
    logger.info("\n[1/5] Cleanup...")
    await cleanup_test_users(
        db, http_client, settings.supabase_url, settings.supabase_service_role_key
    )

    # Create users
    logger.info("\n[2/5] Creating users...")
    test_user_ids: list[str] = []
    for persona in PERSONAS:
        email = f"{persona['username']}+test@example.com"
        logger.info(f"  Creating @{persona['username']}...")

        user_id = await create_user(
            http_client,
            settings.supabase_url,
            settings.supabase_service_role_key,
            email=email,
            password=TEST_PASSWORD,
            username=persona["username"],
        )
        test_user_ids.append(user_id)

        # Wait for trigger
        await asyncio.sleep(0.3)

        # Update profile
        await update_profile(
            db,
            user_id,
            {
                "home_country_code": persona["home_country_code"],
                "travel_motives": persona["travel_motives"],
                "persona_tags": persona["persona_tags"],
            },
        )

    logger.info(f"  Created {len(test_user_ids)} users")

    # Create trips
    logger.info("\n[3/5] Creating trips...")
    user_trips: dict[str, list[str]] = {}
    for idx, persona in enumerate(PERSONAS):
        user_id = test_user_ids[idx]
        trip_ids = await seed_trips_for_user(db, user_id, persona["trips"])
        user_trips[user_id] = trip_ids
        logger.info(f"  @{persona['username']}: {len(trip_ids)} trips")

    # Create follows between test users
    logger.info("\n[4/5] Creating social network...")
    # First 4 users follow each other
    for i in range(min(4, len(test_user_ids))):
        for j in range(min(4, len(test_user_ids))):
            if i != j:
                await create_follow(db, test_user_ids[i], test_user_ids[j])

    # Others follow some of the first 4
    for i in range(4, len(test_user_ids)):
        for j in random.sample(range(4), min(2, 4)):
            await create_follow(db, test_user_ids[i], test_user_ids[j])
            await create_follow(db, test_user_ids[j], test_user_ids[i])

    # Tag some users on trips
    for i, user_id in enumerate(test_user_ids[:3]):
        trips = user_trips.get(user_id, [])
        if trips:
            other = test_user_ids[(i + 1) % len(test_user_ids)]
            await create_trip_tag(db, trips[0], other, "approved", user_id)

    logger.info("  Follow network created")

    # Real user integration
    if real_user_id:
        logger.info("\n[5/5] Setting up real user relationships...")
        # Real user follows test users
        for test_id in test_user_ids[:4]:
            await create_follow(db, real_user_id, test_id)
        # Test users follow real user
        for test_id in test_user_ids[:5]:
            await create_follow(db, test_id, real_user_id)
        # Tag real user on trips
        for test_id in test_user_ids[:2]:
            trips = user_trips.get(test_id, [])
            if trips:
                await create_trip_tag(db, trips[0], real_user_id, "pending", test_id)
        logger.info("  Real user connected")
    else:
        logger.info("\n[5/5] Skipping real user (use --real-user-id)")

    # Summary
    logger.info("\n" + "=" * 50)
    logger.info("Done! Test users:")
    for persona in PERSONAS:
        logger.info(
            f"  @{persona['username']} ({persona['username']}+test@example.com)"
        )
    logger.info(f"\nPassword: {TEST_PASSWORD}")
    if real_user_id:
        logger.info("\nReal user follows 4, followed by 5, tagged on 2 trips")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed test users")
    parser.add_argument("--real-user-id", help="UUID of real user")
    parser.add_argument("--cleanup-only", action="store_true", help="Only cleanup")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
    )

    try:
        if args.cleanup_only:
            settings = get_settings()
            http_client = get_http_client()
            db = get_service_supabase_client()
            await cleanup_test_users(
                db,
                http_client,
                settings.supabase_url,
                settings.supabase_service_role_key,
            )
        else:
            await seed_all(args.real_user_id)
    finally:
        await close_http_client()


if __name__ == "__main__":
    asyncio.run(main())
