"""Backfill social feed events and inbox rows."""

import asyncio
import logging

from app.db.session import get_service_supabase_client

logger = logging.getLogger(__name__)


async def backfill_social_feed() -> None:
    """Call the Supabase RPC to rebuild social feed tables."""
    logger.info("Starting social feed backfill...")
    db = get_service_supabase_client()
    await db.rpc("backfill_social_feed")
    logger.info("Social feed backfill complete.")


def main() -> None:
    asyncio.run(backfill_social_feed())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
