"""API route handlers."""

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
    stats,
    trips,
    users,
)

router = APIRouter()

# Public routes first so unauthenticated landing/list/trip pages resolve before
# authenticated API routers.
router.include_router(public.router, tags=["public"])
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
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(follows.router, prefix="/follows", tags=["follows"])
router.include_router(feed.router, prefix="/feed", tags=["feed"])
router.include_router(stats.router, prefix="/stats", tags=["stats"])
router.include_router(blocks.router, prefix="/blocks", tags=["blocks"])
router.include_router(invites.router, prefix="/invites", tags=["invites"])
router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
