"""API route handlers."""

from fastapi import APIRouter

from app.api import countries, entries, lists, media, places, trips

router = APIRouter()

router.include_router(countries.router, prefix="/countries", tags=["countries"])
router.include_router(trips.router, prefix="/trips", tags=["trips"])
router.include_router(entries.router, tags=["entries"])
router.include_router(places.router, prefix="/places", tags=["places"])
router.include_router(media.router, prefix="/media/files", tags=["media"])
router.include_router(lists.router, tags=["lists"])
