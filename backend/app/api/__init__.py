"""API route handlers."""

from fastapi import APIRouter

from app.api import (
    ad_events,
    admin,
    blocks,
    blog,
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
    photos,
    places,
    profile,
    public,
    social,
    stats,
    subscriptions,
    trip_tags,
    trips,
    users,
    webhooks,
    welcome,
)
from app.core.config import get_settings

router = APIRouter()

# Get settings at module load time for conditional router registration
_settings = get_settings()

# Public routes first so unauthenticated landing/list/trip pages resolve before
# authenticated API routers.
router.include_router(public.router, tags=["public"])
# Blog sits with the other public HTML pages. Every path is under a literal
# /blog segment, so it cannot collide with an authenticated router regardless of
# order, but grouping it here keeps the "public pages first" invariant legible.
router.include_router(blog.router, tags=["blog"])
router.include_router(outbound.router, tags=["outbound"])
router.include_router(countries.router, prefix="/countries", tags=["countries"])
router.include_router(profile.router, prefix="/profile", tags=["profile"])
router.include_router(trips.router, prefix="/trips", tags=["trips"])
router.include_router(entries.router, tags=["entries"])
router.include_router(places.router, prefix="/places", tags=["places"])
router.include_router(media.router, prefix="/media/files", tags=["media"])
router.include_router(lists.router, tags=["lists"])
router.include_router(
    classification.router, prefix="/classify", tags=["classification"]
)
router.include_router(ingest.router, tags=["ingest"])
router.include_router(admin.router, tags=["admin"])
router.include_router(welcome.router, tags=["welcome"])
router.include_router(photos.router, tags=["photos"])
router.include_router(
    subscriptions.router, prefix="/subscriptions", tags=["subscriptions"]
)
router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
router.include_router(ad_events.router, tags=["ad-events"])

# Social routes are registered ONLY when ENABLE_SOCIAL_FEATURES is explicitly
# enabled. There is deliberately no ENV=development fallback: a deployed
# environment that leaves ENV at its "development" default would otherwise
# silently expose every social route with the flag off. Local
# testing must set ENABLE_SOCIAL_FEATURES=true in backend/.env.
if _settings.enable_social_features:
    router.include_router(trip_tags.router, prefix="/trip-tags", tags=["trip_tags"])
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
