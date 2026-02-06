"""Social media ingest endpoints."""

import base64
import binascii
import hashlib
import logging
import time
from typing import Literal
from urllib.parse import urlparse, urlunparse
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from app.api.countries import get_country_name_by_code
from app.api.utils import get_token_from_request
from app.core.posthog import capture_event
from app.core.security import CurrentUser
from app.core.urls import safe_google_photo_url
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.entries import Entry, EntryWithPlace, Place
from app.schemas.social_ingest import (
    DetectedCountry,
    DetectedPlace,
    SavePlaceResult,
    SavePlacesRequest,
    SavePlacesResponse,
    SaveToTripRequest,
    SocialIngestRequest,
    SocialIngestResponse,
    SocialProvider,
    SuggestedTrip,
)
from app.services.extraction_orchestrator import ExtractionOrchestrator
from app.services.google_photo_downloader import (
    create_media_record_for_google_photo,
    download_and_store_google_photo,
)
from app.services.oembed_adapters import fetch_oembed
from app.services.place_extractor import (
    clean_instagram_profile_name,
    extract_location_hints,
    extract_place_from_profile,
)
from app.services.url_resolver import (
    canonicalize_url,
    detect_provider,
    is_instagram_carousel,
    is_instagram_profile,
    is_tiktok_photo,
)

logger = logging.getLogger(__name__)


def _sanitize_url_for_logging(url: str, max_length: int = 200) -> str:
    """Sanitize a URL for logging by removing query parameters and fragments.

    Query parameters and fragments may contain auth tokens, session IDs, or PII.

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
        # If parsing fails, remove both query params AND fragments
        # Split on '?' first, then on '#' to remove both
        base_url = url.split("?")[0].split("#")[0]
        return base_url[:max_length]


def _decode_video_frames(frames: list[str]) -> list[bytes]:
    """Decode base64-encoded video frames from the client."""
    decoded: list[bytes] = []
    for i, frame_b64 in enumerate(frames):
        try:
            payload = frame_b64
            if payload.startswith("data:"):
                payload = payload.split(",", 1)[-1]
            decoded.append(base64.b64decode(payload, validate=True))
        except (binascii.Error, ValueError) as e:
            logger.info(
                "ingest_video_frame_invalid",
                extra={"frame_index": i, "error": str(e)[:120]},
            )
            continue
    return decoded


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

    # Step 3: Extract place(s) from content
    # Profile URLs use a different extraction path that uses the profile name directly
    extraction_method_used: Literal["llm", "regex", "video", "none"] = "none"
    extraction_source: Literal["caption", "video_frames", "carousel", "screenshot"] = (
        "caption"
    )
    detected_places: list[DetectedPlace] = []
    detected_place: DetectedPlace | None = None
    context_location: str | None = None
    extraction_latency_ms: int = 0
    extraction_error: str | None = None

    # Detect TikTok photo slideshows or Instagram carousels early
    # These use multimodal extraction instead of video extraction
    is_photo_slideshow = is_tiktok_photo(canonical_url) or (
        provider == SocialProvider.INSTAGRAM
        and is_instagram_carousel(canonical_url)
        and not is_profile
    )

    if is_profile and oembed:
        # For profiles, use the profile name (business name) as the search query
        extraction_start = time.monotonic()
        profile_name = clean_instagram_profile_name(oembed.title or "")
        # Bio may contain location hints (address, city)
        bio = oembed.raw.get("og:description") if oembed.raw else None
        profile_place = await extract_place_from_profile(profile_name, bio)
        if profile_place:
            detected_places = [profile_place]
            detected_place = profile_place
            extraction_method_used = "regex"  # Profile uses direct search
        extraction_latency_ms = int((time.monotonic() - extraction_start) * 1000)
    else:
        # Prefer client-provided video frames when available
        frames_bytes = (
            _decode_video_frames(data.video_frames) if data.video_frames else []
        )
        if frames_bytes:
            logger.info(
                "ingest_video_frames_received",
                extra={
                    "frames_count": len(frames_bytes),
                    "provider": provider.value,
                    "user_id": str(user.id),
                },
            )
            orchestrator = ExtractionOrchestrator(enable_video_fallback=False)
            extraction_start = time.monotonic()
            extraction_result = await orchestrator.extract_from_frames(
                canonical_url,
                oembed,
                data.caption,
                frames_bytes,
                use_cache=not data.skip_cache,
            )
            detected_places = extraction_result.places
            detected_place = detected_places[0] if detected_places else None
            context_location = extraction_result.context_location
            extraction_method_used = extraction_result.method
            extraction_source = extraction_result.source
            extraction_latency_ms = int((time.monotonic() - extraction_start) * 1000)
        else:
            # Use ExtractionOrchestrator for cascading extraction:
            # 1. Check cache
            # 2. Try caption extraction (LLM + regex fallback)
            # 3. If caption fails or signals skip_to_video, try video frame extraction
            # 4. Cache results
            #
            # Note: TikTok photo slideshows (/photo/ URLs) don't support video extraction
            # via yt-dlp, so we disable video fallback for those URLs.
            orchestrator = ExtractionOrchestrator(
                enable_video_fallback=not is_photo_slideshow,
                total_timeout=20.0 if is_photo_slideshow else 15.0,
            )

            extraction_result = await orchestrator.extract(
                canonical_url,
                oembed,
                data.caption,
                use_cache=not data.skip_cache,  # Honor skip_cache for cache invalidation
                is_video_url=not is_photo_slideshow,
                extraction_method=data.extraction_method,
                is_photo_slideshow=is_photo_slideshow,
            )

            detected_places = extraction_result.places
            detected_place = detected_places[0] if detected_places else None
            context_location = extraction_result.context_location
            extraction_method_used = extraction_result.method
            extraction_source = extraction_result.source
            extraction_latency_ms = extraction_result.latency_ms

    logger.info(
        f"INGEST place extraction result: "
        f"detected={len(detected_places)} places, "
        f"first={detected_place.name if detected_place else None}, "
        f"confidence={detected_place.confidence if detected_place else None}, "
        f"source={'profile' if is_profile else 'post'}, "
        f"method={extraction_method_used}, latency_ms={extraction_latency_ms}"
    )

    # Track extraction outcome in PostHog for LLM accuracy analysis
    capture_event(
        "social_ingest_extraction_completed",
        distinct_id=hashlib.sha256(str(user.id).encode()).hexdigest()[:16],
        properties={
            "provider": provider.value,
            "extraction_method": extraction_method_used,
            "extraction_source": extraction_source,
            "places_detected": len(detected_places),
            "has_place": bool(detected_place),
            "confidence": detected_place.confidence if detected_place else None,
            "latency_ms": extraction_latency_ms,
            "country_code": detected_place.country_code if detected_place else None,
            "is_profile": is_profile,
        },
    )

    # Set user-facing error for photo slideshows/carousels when extraction fails
    if is_photo_slideshow and not detected_places:
        if is_tiktok_photo(canonical_url):
            extraction_error = (
                "We couldn't identify a place from this TikTok slideshow. "
                "You can still save it manually by searching for the place."
            )
        else:
            extraction_error = (
                "We couldn't identify a place from this Instagram post. "
                "You can still save it manually by searching for the place."
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

    # Step 5: Fetch suggested trips for agent-native batch save
    # Priority: country-matching trips first, then "Saved Places" system trip
    suggested_trips: list[SuggestedTrip] = []
    try:
        db = _get_user_scoped_client(request)
        trips_result = await db.get(
            "trip",
            {
                "select": "id,name,is_system,country:country_id(code)",
                "deleted_at": "is.null",
                "order": "created_at.desc",
            },
        )

        if trips_result:
            target_country_code = (
                detected_country.country_code if detected_country else None
            )
            country_trips = []
            saved_places_trip = None

            for trip_data in trips_result:
                # Extract country_code from joined country relation
                trip_country_code = None
                if trip_data.get("country") and trip_data["country"].get("code"):
                    trip_country_code = trip_data["country"]["code"]

                trip = SuggestedTrip(
                    id=trip_data["id"],
                    name=trip_data["name"],
                    country_code=trip_country_code,
                    is_system=trip_data.get("is_system", False),
                )
                # Prioritize country-matching trips
                if target_country_code and trip.country_code == target_country_code:
                    country_trips.append(trip)
                # Track "Saved Places" system trip as fallback
                elif trip.is_system and trip.name == "Saved Places":
                    saved_places_trip = trip

            # Return country trips first, then "Saved Places"
            suggested_trips = country_trips[:3]  # Top 3 country trips
            if saved_places_trip and saved_places_trip not in suggested_trips:
                suggested_trips.append(saved_places_trip)
    except Exception as e:
        # Don't fail the request if trip fetch fails
        logger.warning(f"Failed to fetch suggested trips: {e}")

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
            "suggested_trips_count": len(suggested_trips),
        },
    )

    return SocialIngestResponse(
        provider=provider,
        canonical_url=canonical_url,
        thumbnail_url=thumbnail_url,
        author_handle=author_handle,
        title=title,
        detected_places=detected_places,
        detected_place=detected_place,  # Backward compat
        detected_country=detected_country,
        extraction_method_used=extraction_method_used,  # type: ignore[arg-type]
        extraction_source=extraction_source,
        extraction_latency_ms=extraction_latency_ms,
        context_location=context_location,
        suggested_trips=suggested_trips,
        extraction_error=extraction_error,
    )


async def _download_google_photo_background(
    photo_url: str,
    user_id: str,
    entry_id: str,
    trip_id: str,
) -> None:
    """Background task to download and store a Google photo.

    This runs after the response is sent to the client.
    """
    thumbnail_path = await download_and_store_google_photo(photo_url, user_id, entry_id)

    if thumbnail_path:
        await create_media_record_for_google_photo(
            user_id, entry_id, trip_id, thumbnail_path
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
    background_tasks: BackgroundTasks,
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

    # Extract and validate Google photo URL BEFORE the RPC call
    # We store the validated URL now and use it for the background task later
    validated_google_photo_url: str | None = None
    if data.place and data.place.google_photo_url:
        validated_google_photo_url = safe_google_photo_url(data.place.google_photo_url)
        if not validated_google_photo_url:
            logger.warning(
                "google_photo_url_rejected",
                extra={
                    "event": "invalid_google_photo_url",
                    "user_id": str(user.id),
                    "trip_id": str(data.trip_id),
                    "url_prefix": data.place.google_photo_url[:100]
                    if data.place.google_photo_url
                    else None,
                },
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

        if validated_google_photo_url:
            extra_data["google_photo_url"] = validated_google_photo_url

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

    # Download and store Google photo if available (background task)
    # This creates a permanent copy in Supabase storage since Google URLs expire
    # We use the validated URL from earlier, not the RPC result, to avoid coupling
    if validated_google_photo_url:
        background_tasks.add_task(
            _download_google_photo_background,
            validated_google_photo_url,
            str(user.id),
            str(entry.id),
            str(data.trip_id),
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


@router.post(
    "/ingest/save-places",
    response_model=SavePlacesResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
async def save_places(
    request: Request,
    data: SavePlacesRequest,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> SavePlacesResponse:
    """Save multiple places from a social media post to a trip.

    Batch operation that creates entries for all selected places atomically.
    Skips duplicates (based on google_place_id) rather than erroring.

    Args:
        request: FastAPI request object
        data: Request containing trip_id, places array, and ingest metadata
        user: Authenticated user
        background_tasks: FastAPI background tasks

    Returns:
        SavePlacesResponse with counts of saved/skipped places and entry IDs
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

    saved_entry_ids: list[str] = []
    skipped_place_names: list[str] = []
    results: list[SavePlaceResult] = []

    for place in data.places:
        # Validate Google photo URL if provided
        validated_google_photo_url: str | None = None
        if place.google_photo_url:
            validated_google_photo_url = safe_google_photo_url(place.google_photo_url)

        # Build place data for atomic operation
        place_data = None
        if place.google_place_id:
            extra_data = {
                "city": place.city,
                "country": place.country,
                "country_code": place.country_code,
                "confidence": 1.0,  # User confirmed
                "source": data.provider.value,
                "source_url": data.canonical_url,
            }
            if validated_google_photo_url:
                extra_data["google_photo_url"] = validated_google_photo_url

            place_data = {
                "google_place_id": place.google_place_id,
                "place_name": place.name,
                "lat": place.latitude,
                "lng": place.longitude,
                "address": place.address,
                "extra_data": extra_data,
            }

        # Build entry data
        entry_data = {
            "type": place.entry_type,
            "title": place.name,
            "notes": data.notes,
            "link": data.canonical_url,
            "metadata": {
                "source_type": "social_ingest",
                "provider": data.provider.value,
                "author_handle": data.author_handle,
                "thumbnail_url": data.thumbnail_url,
            },
        }

        try:
            result = await db.rpc(
                "atomic_create_entry_with_place",
                {
                    "p_trip_id": str(data.trip_id),
                    "p_entry_data": entry_data,
                    "p_place_data": place_data,
                },
            )

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

            if result and len(result) > 0:
                entry_row = result[0].get("entry_row")
                if entry_row and entry_row.get("id"):
                    entry_id = entry_row["id"]
                    saved_entry_ids.append(entry_id)
                    results.append(
                        SavePlaceResult(
                            place_name=place.name,
                            status="saved",
                            entry_id=UUID(entry_id),
                        )
                    )

                    # Download Google photo in background
                    if validated_google_photo_url:
                        background_tasks.add_task(
                            _download_google_photo_background,
                            validated_google_photo_url,
                            str(user.id),
                            entry_id,
                            str(data.trip_id),
                        )

        except HTTPException as e:
            detail = str(e.detail).lower() if e.detail else ""
            if "unique" in detail or "duplicate" in detail:
                # Skip duplicates silently
                skipped_place_names.append(place.name)
                results.append(
                    SavePlaceResult(
                        place_name=place.name,
                        status="duplicate",
                        error_message="Place already exists in this trip",
                    )
                )
                continue
            raise
        except Exception as e:
            error_msg = str(e)[:200]
            logger.error(
                "batch_save_entry_failed",
                extra={
                    "event": "batch_save_error",
                    "place_name": place.name[:50],
                    "error": error_msg,
                },
            )
            skipped_place_names.append(place.name)
            results.append(
                SavePlaceResult(
                    place_name=place.name,
                    status="error",
                    error_message=error_msg,
                )
            )
            continue

    # Increment share extension usage once for the batch
    if saved_entry_ids:
        try:
            await db.rpc("increment_share_extension_usage", {"p_user_id": user.id})
        except Exception as e:
            logger.warning(
                "share_extension_usage_increment_failed",
                extra={
                    "event": "usage_increment_error",
                    "user_id": str(user.id),
                    "error": str(e)[:200],
                },
            )

    logger.info(
        "save_places_completed",
        extra={
            "event": "save_places",
            "user_id": str(user.id),
            "trip_id": str(data.trip_id),
            "saved_count": len(saved_entry_ids),
            "skipped_count": len(skipped_place_names),
        },
    )

    return SavePlacesResponse(
        saved_count=len(saved_entry_ids),
        skipped_count=len(skipped_place_names),
        saved_entry_ids=[UUID(eid) for eid in saved_entry_ids],
        skipped_place_names=skipped_place_names,
        results=results,
    )
