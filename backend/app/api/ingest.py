"""Social media ingest endpoints."""

import logging
import time
from typing import Literal
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, HTTPException, Request, status

from app.api.countries import get_country_name_by_code
from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.core.urls import safe_google_photo_url
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.entries import Entry, EntryWithPlace, Place
from app.schemas.social_ingest import (
    DetectedCountry,
    DetectedPlace,
    SaveToTripRequest,
    SocialIngestRequest,
    SocialIngestResponse,
    SocialProvider,
)
from app.services.oembed_adapters import fetch_oembed
from app.services.place_extractor import (
    clean_instagram_profile_name,
    extract_location_hints,
    extract_place_from_profile,
    extract_place_with_method,
)
from app.services.url_resolver import (
    canonicalize_url,
    detect_provider,
    is_instagram_profile,
)

logger = logging.getLogger(__name__)


def _sanitize_url_for_logging(url: str, max_length: int = 200) -> str:
    """Sanitize a URL for logging by removing query parameters.

    Query parameters may contain auth tokens, session IDs, or PII.

    Args:
        url: URL to sanitize
        max_length: Maximum length of returned string

    Returns:
        Sanitized URL safe for logging
    """
    try:
        parsed = urlparse(url)
        # Reconstruct URL without query string and fragment
        sanitized = urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))
        return sanitized[:max_length]
    except Exception:
        # If parsing fails, return truncated host portion only
        return url.split("?")[0][:max_length]


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

    Supports both post URLs (e.g., instagram.com/p/ABC123) and profile URLs
    (e.g., instagram.com/commanderspalace) for business accounts.

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

    # Step 1.5: Check if this is a profile URL (needs different processing)
    is_profile = provider == SocialProvider.INSTAGRAM and is_instagram_profile(
        canonical_url
    )

    logger.info(
        "ingest_social_started",
        extra={
            "event": "ingest_start",
            "provider": provider.value,
            "user_id": str(user.id),
            "is_profile": is_profile,
            # Sanitize URLs to remove query params that may contain tokens/PII
            "original_url": _sanitize_url_for_logging(data.url),
            "canonical_url": _sanitize_url_for_logging(canonical_url),
        },
    )

    # Step 2: Fetch oEmbed metadata (uses oembed_cache for deduplication)
    # For profile URLs, this goes directly to OpenGraph since oEmbed doesn't work
    oembed = await fetch_oembed(canonical_url, provider, is_profile=is_profile)

    thumbnail_url = oembed.thumbnail_url if oembed else None
    author_handle = oembed.author_name if oembed else None
    title = oembed.title if oembed else None

    # Log oEmbed result without sensitive content (truncate title/caption for privacy)
    logger.info(
        f"INGEST oEmbed result: title_len={len(title) if title else 0}, "
        f"author={author_handle!r}, has_thumbnail={bool(thumbnail_url)}, "
        f"caption_len={len(data.caption) if data.caption else 0}, is_profile={is_profile}"
    )

    # Step 3: Extract place from content
    # Profile URLs use a different extraction path that uses the profile name directly
    extraction_start = time.monotonic()
    extraction_method_used: Literal["llm", "regex", "none"] = "none"
    detected_place: DetectedPlace | None = None

    if is_profile and oembed:
        # For profiles, use the profile name (business name) as the search query
        profile_name = clean_instagram_profile_name(oembed.title or "")
        # Bio may contain location hints (address, city)
        bio = oembed.raw.get("og:description") if oembed.raw else None
        detected_place = await extract_place_from_profile(profile_name, bio)
        # Profile extraction doesn't use LLM/regex, mark as "none" unless we found a place
        if detected_place:
            extraction_method_used = "regex"  # Profile uses direct search
    else:
        # Standard extraction from post title/caption with method tracking
        extraction_result = await extract_place_with_method(
            oembed, data.caption, data.extraction_method
        )
        detected_place = extraction_result.place
        extraction_method_used = extraction_result.method

    extraction_latency_ms = int((time.monotonic() - extraction_start) * 1000)

    logger.info(
        f"INGEST place extraction result: "
        f"detected={detected_place.name if detected_place else None}, "
        f"confidence={detected_place.confidence if detected_place else None}, "
        f"source={'profile' if is_profile else 'post'}, "
        f"method={extraction_method_used}, latency_ms={extraction_latency_ms}"
    )

    # Step 4: Extract country hint even if place detection failed
    # This allows the client to default trips to this country and bias autocomplete
    detected_country: DetectedCountry | None = None

    # If place was detected, use its country
    if detected_place and detected_place.country_code:
        detected_country = DetectedCountry(
            country_code=detected_place.country_code,
            country_name=detected_place.country or detected_place.country_code,
            latitude=detected_place.latitude,
            longitude=detected_place.longitude,
        )
    else:
        # Extract location hints from text to find country
        combined_text = " ".join(filter(None, [title, data.caption]))
        location_hints = extract_location_hints(combined_text)
        if location_hints:
            hint = location_hints[0]
            if hint.country_code:
                # Look up proper country name from database
                # Fallback to hint name (city/region) or code if not found
                country_name = await get_country_name_by_code(hint.country_code)
                if not country_name:
                    country_name = hint.name.title() if hint.name else hint.country_code
                detected_country = DetectedCountry(
                    country_code=hint.country_code,
                    country_name=country_name,
                    latitude=hint.latitude,
                    longitude=hint.longitude,
                )
                logger.info(
                    f"INGEST country hint (no place): {hint.country_code} ({country_name})"
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
            "detected_country": detected_country.country_code
            if detected_country
            else None,
        },
    )

    return SocialIngestResponse(
        provider=provider,
        canonical_url=canonical_url,
        thumbnail_url=thumbnail_url,
        author_handle=author_handle,
        title=title,
        detected_place=detected_place,
        detected_country=detected_country,
        extraction_method_used=extraction_method_used,
        extraction_latency_ms=extraction_latency_ms,
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

    # Build place data for atomic operation
    # Note: duplicate detection relies on the unique index (idx_place_unique_google_per_trip)
    # enforced atomically by the database, caught in the exception handler below
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

    # Determine entry title: prefer place name, fall back to social media title (truncated to 2200 chars)
    if data.place:
        entry_title = data.place.name
    elif data.title:
        # Truncate to 2200 chars to match schema validation and Instagram caption limit
        entry_title = data.title[:2200]
    else:
        entry_title = "Saved from social"

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
    try:
        result = await db.rpc(
            "atomic_create_entry_with_place",
            {
                "p_trip_id": str(data.trip_id),
                "p_entry_data": entry_data,
                "p_place_data": place_data,
            },
        )
    except HTTPException as e:
        # Handle unique constraint violation from concurrent inserts
        detail = str(e.detail).lower() if e.detail else ""
        if "unique" in detail or "duplicate" in detail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This place has already been saved to this trip",
            ) from None
        # Re-raise other HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(
            "rpc_atomic_create_failed",
            extra={
                "event": "rpc_error",
                "function": "atomic_create_entry_with_place",
                "trip_id": str(data.trip_id),
                "error": str(e)[:200],
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create entry - database error",
        ) from None

    # Handle RPC returning empty result (authorization failure or trip not found)
    if not result or len(result) == 0:
        logger.warning(
            "rpc_atomic_create_empty_result",
            extra={
                "event": "rpc_empty_result",
                "function": "atomic_create_entry_with_place",
                "trip_id": str(data.trip_id),
                "user_id": str(user.id),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to add entries to this trip",
        )

    entry_row = result[0].get("entry_row")
    place_row = result[0].get("place_row")

    if not entry_row:
        logger.error(
            "rpc_atomic_create_missing_entry",
            extra={
                "event": "rpc_invalid_result",
                "function": "atomic_create_entry_with_place",
                "trip_id": str(data.trip_id),
                "result_keys": list(result[0].keys()) if result else [],
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create entry - unexpected result format",
        )

    entry = Entry(**entry_row)
    place = Place(**place_row) if place_row else None

    # Increment share extension usage count (fire-and-forget, don't fail on error)
    try:
        await db.rpc("increment_share_extension_usage", {"p_user_id": user.id})
    except Exception as e:
        # Log but don't fail the request - entry was already created successfully
        logger.warning(
            "share_extension_usage_increment_failed",
            extra={
                "event": "usage_increment_error",
                "user_id": str(user.id),
                "error": str(e)[:200],
            },
        )

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
