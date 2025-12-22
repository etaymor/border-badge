"""Social media ingest endpoints."""

import logging

from fastapi import APIRouter, HTTPException, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.core.urls import safe_google_photo_url
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.entries import Entry, EntryWithPlace, Place
from app.schemas.social_ingest import (
    SaveToTripRequest,
    SocialIngestRequest,
    SocialIngestResponse,
)
from app.services.oembed_adapters import fetch_oembed
from app.services.place_extractor import extract_place
from app.services.url_resolver import canonicalize_url, detect_provider

logger = logging.getLogger(__name__)


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
    status_code=status.HTTP_200_OK,
)
@limiter.limit("30/minute")
async def ingest_social_url(
    request: Request,
    data: SocialIngestRequest,
    user: CurrentUser,
) -> SocialIngestResponse:
    """Ingest a social media URL and extract metadata.

    Receives a TikTok or Instagram URL, canonicalizes it, fetches oEmbed
    metadata (using cache if available), and attempts to extract a place.

    Returns the metadata directly without persisting to saved_source.
    The client should pass this data to /ingest/save-to-trip when saving.
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

    # Step 2: Fetch oEmbed metadata (uses oembed_cache for deduplication)
    oembed = await fetch_oembed(canonical_url, provider)

    thumbnail_url = oembed.thumbnail_url if oembed else None
    author_handle = oembed.author_name if oembed else None
    title = oembed.title if oembed else None

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

    logger.info(
        "ingest_social_completed",
        extra={
            "event": "ingest_complete",
            "provider": provider.value,
            "user_id": str(user.id),
            "has_thumbnail": bool(thumbnail_url),
            "has_place": bool(detected_place),
            "place_confidence": detected_place.confidence if detected_place else None,
        },
    )

    return SocialIngestResponse(
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
    """Save social ingest data to a trip as an entry.

    Takes ingest data (provider, canonical_url, metadata) and confirmed place data,
    creates an entry in the specified trip with source attribution in metadata.
    """
    db = _get_user_scoped_client(request)

    # Verify trip exists and user owns it
    trips = await db.get(
        "trip",
        {
            "id": f"eq.{data.trip_id}",
            "user_id": f"eq.{user.id}",
            "select": "id",
        },
    )

    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
        )

    # Check for duplicate place in same trip (by google_place_id)
    if data.place and data.place.google_place_id:
        existing_entries = await db.get(
            "entry",
            {
                "trip_id": f"eq.{data.trip_id}",
                "deleted_at": "is.null",
                "select": "id, place!inner(google_place_id)",
            },
        )
        for entry in existing_entries:
            place = entry.get("place")
            if place and place.get("google_place_id") == data.place.google_place_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This place has already been saved to this trip",
                )

    # Build place data for atomic operation
    place_data = None
    if data.place:
        extra_data = {
            "city": data.place.city,
            "country": data.place.country,
            "country_code": data.place.country_code,
            "confidence": data.place.confidence,
            "source": data.provider.value,
            "source_url": data.canonical_url,
        }

        photo_url = safe_google_photo_url(data.place.google_photo_url)
        if photo_url:
            extra_data["google_photo_url"] = photo_url

        place_data = {
            "google_place_id": data.place.google_place_id,
            "place_name": data.place.name,
            "lat": data.place.latitude,
            "lng": data.place.longitude,
            "address": data.place.address,
            "extra_data": extra_data,
        }

    # Determine entry title
    entry_title = data.place.name if data.place else data.title or "Saved from social"

    # Build entry data for atomic operation
    entry_data = {
        "type": data.entry_type,
        "title": entry_title,
        "notes": data.notes,
        "link": data.canonical_url,
        "metadata": {
            "source_type": "social_ingest",
            "provider": data.provider.value,
            "author_handle": data.author_handle,
            "thumbnail_url": data.thumbnail_url,
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
            "has_place": bool(place),
        },
    )

    return EntryWithPlace(**entry.model_dump(), place=place)
