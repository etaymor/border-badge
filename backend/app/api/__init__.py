"""API route handlers."""

import logging
import os

from fastapi import APIRouter

from app.api import (
    admin,
    blocks,
    classification,
    countries,
    entries,
    feed,
    follows,
    ingest,
    invites,
    lists,
    media,
    notifications,
    outbound,
    places,
    profile,
    public,
    social,
    stats,
    trip_tags,
    trips,
    users,
)
from app.core.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Get settings at module load time for conditional router registration
_settings = get_settings()
_is_pytest_context = bool(os.environ.get("PYTEST_CURRENT_TEST"))

# Public routes first so unauthenticated landing/list/trip pages resolve before
# authenticated API routers.
router.include_router(public.router, tags=["public"])
router.include_router(outbound.router, tags=["outbound"])
router.include_router(countries.router, prefix="/countries", tags=["countries"])
router.include_router(profile.router, prefix="/profile", tags=["profile"])
router.include_router(trips.router, prefix="/trips", tags=["trips"])
router.include_router(trip_tags.router, prefix="/trip-tags", tags=["trip_tags"])
router.include_router(entries.router, tags=["entries"])
router.include_router(places.router, prefix="/places", tags=["places"])
router.include_router(media.router, prefix="/media/files", tags=["media"])
router.include_router(lists.router, tags=["lists"])
router.include_router(
    classification.router, prefix="/classify", tags=["classification"]
)
router.include_router(ingest.router, tags=["ingest"])
router.include_router(admin.router, tags=["admin"])

# In development we automatically enable social routes even if the flag is disabled
# to prevent confusing 404s during local testing.
_social_routes_enabled = _settings.enable_social_features
if (
    not _social_routes_enabled
    and _settings.env == "development"
    and not _is_pytest_context
):
    logger.warning(
        "ENABLE_SOCIAL_FEATURES is false but development environment detected. "
        "Automatically registering social routes for local testing."
    )
    _social_routes_enabled = True


# Social routes are registered when the flag (or dev fallback) enables them.
if _social_routes_enabled:
    router.include_router(stats.router, prefix="/stats", tags=["stats"])
    router.include_router(users.router, prefix="/users", tags=["users"])
    router.include_router(follows.router, prefix="/follows", tags=["follows"])
    router.include_router(feed.router, prefix="/feed", tags=["feed"])
    router.include_router(social.router, prefix="/social", tags=["social"])
    router.include_router(blocks.router, prefix="/blocks", tags=["blocks"])
    router.include_router(invites.router, prefix="/invites", tags=["invites"])
    router.include_router(
        notifications.router, prefix="/notifications", tags=["notifications"]
    )
