"""Social media ingest endpoints."""

import asyncio
import html
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.entries import Entry, EntryWithPlace, Place
from app.schemas.social_ingest import (
    SavedSource,
    SaveToTripRequest,
    SocialIngestRequest,
    SocialIngestResponse,
)
from app.services.oembed_adapters import fetch_oembed
from app.services.place_extractor import extract_place
from app.services.url_resolver import canonicalize_url, detect_provider

logger = logging.getLogger(__name__)


def sanitize_caption(caption: str | None) -> str | None:
    """Sanitize user-provided caption to prevent XSS in web contexts.

    HTML-escapes special characters that could be used for XSS attacks
    if the caption is ever rendered in a web view.
    """
    if caption is None:
        return None
    return html.escape(caption, quote=True)


router = APIRouter()


def _get_user_scoped_client(request: Request):
    """Return a Supabase client scoped to the requesting user.

    Raises:
        HTTPException: If the Authorization header/token is missing.
    """
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization token",
        )
    return get_supabase_client(user_token=token)


@router.post(
    "/ingest/social",
    response_model=SocialIngestResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
async def ingest_social_url(
    request: Request,
    data: SocialIngestRequest,
    user: CurrentUser,
) -> SocialIngestResponse:
    """Ingest a social media URL and extract metadata.

    Receives a TikTok or Instagram URL, canonicalizes it, fetches oEmbed
    metadata, attempts to extract a place, and stores the saved source.

    The detected place is returned for user confirmation - it is NOT
    automatically saved to a trip.
    """
    # Step 1: Canonicalize URL and detect provider
    canonical_url, provider = await canonicalize_url(data.url)

    if not provider:
        # Try detecting from canonical URL first, then original URL
        provider = detect_provider(canonical_url) or detect_provider(data.url)

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL is not from a supported provider (TikTok or Instagram)",
        )

    logger.info(
        "ingest_social_started",
        extra={
            "event": "ingest_start",
            "provider": provider.value,
            "user_id": str(user.id),
            "original_url": data.url[:200],
            "canonical_url": canonical_url[:200],
        },
    )

    # Step 2: Fetch oEmbed metadata
    oembed = await fetch_oembed(canonical_url, provider)

    thumbnail_url = oembed.thumbnail_url if oembed else None
    author_handle = oembed.author_name if oembed else None
    title = oembed.title if oembed else None
    oembed_data = oembed.raw if oembed else None

    # Log oEmbed result without sensitive content (truncate title/caption for privacy)
    logger.info(
        f"INGEST oEmbed result: title_len={len(title) if title else 0}, "
        f"author={author_handle!r}, has_thumbnail={bool(thumbnail_url)}, "
        f"caption_len={len(data.caption) if data.caption else 0}"
    )

    # Step 3: Extract place from content
    detected_place = await extract_place(oembed, data.caption)

    logger.info(
        f"INGEST place extraction result: "
        f"detected={detected_place.name if detected_place else None}, "
        f"confidence={detected_place.confidence if detected_place else None}"
    )

    # Step 4: Persist saved source
    db = _get_user_scoped_client(request)

    # Sanitize user-provided caption to prevent XSS if rendered in web views
    sanitized_caption = sanitize_caption(data.caption)

    saved_source_data = {
        "user_id": str(user.id),
        "provider": provider.value,
        "original_url": data.url,
        "canonical_url": canonical_url,
        "thumbnail_url": thumbnail_url,
        "author_handle": author_handle,
        "caption": sanitized_caption,
        "title": title,
        "oembed_data": oembed_data,
    }

    rows = await db.post("saved_source", saved_source_data)

    if not rows:
        logger.error(
            "ingest_social_save_failed",
            extra={
                "event": "ingest_error",
                "error": "failed_to_save",
                "user_id": str(user.id),
                "canonical_url": canonical_url[:200],
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save social source",
        )

    saved_source = SavedSource(**rows[0])

    logger.info(
        "ingest_social_completed",
        extra={
            "event": "ingest_complete",
            "provider": provider.value,
            "user_id": str(user.id),
            "saved_source_id": str(saved_source.id),
            "has_thumbnail": bool(thumbnail_url),
            "has_place": bool(detected_place),
            "place_confidence": detected_place.confidence if detected_place else None,
        },
    )

    return SocialIngestResponse(
        saved_source_id=saved_source.id,
        provider=provider,
        canonical_url=canonical_url,
        thumbnail_url=thumbnail_url,
        author_handle=author_handle,
        title=title,
        detected_place=detected_place,
    )


@router.post(
    "/ingest/save-to-trip",
    response_model=EntryWithPlace,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
async def save_to_trip(
    request: Request,
    data: SaveToTripRequest,
    user: CurrentUser,
) -> EntryWithPlace:
    """Save a social source to a trip as an entry.

    Takes a saved_source_id and confirmed place data, creates an entry
    in the specified trip, and links the saved source to the entry.
    """
    db = _get_user_scoped_client(request)

    # Verify saved source and trip in parallel to reduce latency
    source_task = db.get(
        "saved_source",
        {
            "id": f"eq.{data.saved_source_id}",
            "user_id": f"eq.{user.id}",
            "select": "*",
        },
    )
    trip_task = db.get(
        "trip",
        {
            "id": f"eq.{data.trip_id}",
            "user_id": f"eq.{user.id}",
            "select": "id",
        },
    )

    sources, trips = await asyncio.gather(source_task, trip_task)

    if not sources:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved source not found",
        )

    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
        )

    source = sources[0]

    # Build place data for atomic operation
    place_data = None
    if data.place:
        place_data = {
            "google_place_id": data.place.google_place_id,
            "place_name": data.place.name,
            "lat": data.place.latitude,
            "lng": data.place.longitude,
            "address": data.place.address,
            "extra_data": {
                "city": data.place.city,
                "country": data.place.country,
                "country_code": data.place.country_code,
                "confidence": data.place.confidence,
                "source": source["provider"],
                "source_url": source["canonical_url"],
            },
        }

    # Determine entry title
    entry_title = (
        data.place.name if data.place else source.get("title") or "Saved from social"
    )

    # Build entry data for atomic operation
    entry_data = {
        "type": data.entry_type,
        "title": entry_title,
        "notes": data.notes,
        "link": source["canonical_url"],
        "metadata": {
            "source_type": "social_ingest",
            "provider": source["provider"],
            "author_handle": source.get("author_handle"),
            "thumbnail_url": source.get("thumbnail_url"),
        },
    }

    # Use atomic RPC function to create entry + place in a single transaction.
    # This ensures no orphaned entries if place creation fails.
    result = await db.rpc(
        "atomic_create_entry_with_place",
        {
            "p_trip_id": str(data.trip_id),
            "p_entry_data": entry_data,
            "p_place_data": place_data,
            "p_saved_source_id": str(data.saved_source_id),
        },
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create entry",
        )

    entry_row = result[0].get("entry_row") if result else None
    place_row = result[0].get("place_row") if result else None

    if not entry_row:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create entry",
        )

    entry = Entry(**entry_row)
    place = Place(**place_row) if place_row else None

    logger.info(
        "save_to_trip_completed",
        extra={
            "event": "save_to_trip",
            "user_id": str(user.id),
            "trip_id": str(data.trip_id),
            "entry_id": str(entry.id),
            "saved_source_id": str(data.saved_source_id),
            "has_place": bool(place),
        },
    )

    return EntryWithPlace(**entry.model_dump(), place=place)


@router.get("/ingest/saved-sources", response_model=list[SavedSource])
async def list_saved_sources(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    unlinked_only: bool = False,
) -> list[SavedSource]:
    """List user's saved social sources.

    Args:
        limit: Maximum number of results (default 50, max 100)
        offset: Pagination offset
        unlinked_only: If true, only return sources not yet saved to an entry
    """
    db = _get_user_scoped_client(request)

    params: dict = {
        "user_id": f"eq.{user.id}",
        "select": "*",
        "order": "created_at.desc",
        "limit": limit,
        "offset": offset,
    }

    if unlinked_only:
        params["entry_id"] = "is.null"

    rows = await db.get("saved_source", params)

    return [SavedSource(**row) for row in rows]


@router.delete(
    "/ingest/saved-sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT
)
@limiter.limit("30/minute")
async def delete_saved_source(
    request: Request,
    source_id: UUID,
    user: CurrentUser,
) -> None:
    """Delete a saved social source.

    Only deletes the saved source record, not any associated entry.
    """
    db = _get_user_scoped_client(request)

    rows = await db.delete(
        "saved_source",
        {
            "id": f"eq.{source_id}",
            "user_id": f"eq.{user.id}",
        },
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved source not found",
        )
