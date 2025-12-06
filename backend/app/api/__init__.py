"""API route handlers."""

from fastapi import APIRouter

from app.api import countries, entries, lists, media, places, profile, public, trips

router = APIRouter()

# Public routes MUST come first to avoid auth middleware blocking unauthenticated
# requests to /lists/{slug} and /trips/{slug} before they reach the public handlers.
router.include_router(public.router, tags=["public"])
router.include_router(countries.router, prefix="/countries", tags=["countries"])
router.include_router(profile.router, prefix="/profile", tags=["profile"])
router.include_router(trips.router, prefix="/trips", tags=["trips"])
router.include_router(entries.router, tags=["entries"])
router.include_router(places.router, prefix="/places", tags=["places"])
router.include_router(media.router, prefix="/media/files", tags=["media"])
router.include_router(lists.router, tags=["lists"])
