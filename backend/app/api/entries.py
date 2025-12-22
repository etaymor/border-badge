"""Entry endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.media import build_media_url
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.entries import (
    Entry,
    EntryCreate,
    EntryMediaFile,
    EntryType,
    EntryUpdate,
    EntryWithPlace,
    Place,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/trips/{trip_id}/entries", response_model=list[EntryWithPlace])
async def list_entries(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[EntryWithPlace]:
    """List all entries for a trip with pagination."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Fetch entries with embedded places and media_files in single query
    entries = await db.get(
        "entry",
        {
            "trip_id": f"eq.{trip_id}",
            "select": "*, place(*), media_files(*)",
            "order": "date.asc.nullslast,created_at.asc",
            "limit": limit,
            "offset": offset,
        },
    )

    results = []
    for entry_row in entries:
        # Extract embedded place data
        place_data = entry_row.pop("place", None)
        # Extract embedded media_files data
        media_data = entry_row.pop("media_files", None)

        entry = Entry(**entry_row)

        # Parse place if it exists
        # PostgREST returns one-to-one relationships as a single object (not array)
        place = None
        if place_data:
            if isinstance(place_data, dict):
                place = Place(**place_data)
            elif isinstance(place_data, list) and len(place_data) > 0:
                # Handle array format just in case
                place = Place(**place_data[0])

        # Parse media_files and build URLs
        media_files = []
        if media_data and isinstance(media_data, list):
            for media in media_data:
                if media.get("status") != "uploaded":
                    logger.debug(
                        "Skipping media file %s: status=%s (expected 'uploaded')",
                        media.get("id"),
                        media.get("status"),
                    )
                    continue

                file_path = media.get("file_path")
                if not file_path:
                    logger.debug(
                        "Skipping media file %s: missing file_path",
                        media.get("id"),
                    )
                    continue

                thumbnail_path = media.get("thumbnail_path")

                media_files.append(
                    EntryMediaFile(
                        id=media["id"],
                        url=build_media_url(file_path),
                        thumbnail_url=(
                            build_media_url(thumbnail_path) if thumbnail_path else None
                        ),
                        status=media["status"],
                    )
                )

        results.append(
            EntryWithPlace(**entry.model_dump(), place=place, media_files=media_files)
        )

    return results


@router.post(
    "/trips/{trip_id}/entries",
    response_model=EntryWithPlace,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
async def create_entry(
    request: Request,
    trip_id: UUID,
    data: EntryCreate,
    user: CurrentUser,
) -> EntryWithPlace:
    """Create a new entry for a trip."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Create entry
    entry_data = {
        "trip_id": str(trip_id),
        "type": data.type.value,
        "title": data.title,
        "notes": data.notes,
        "link": data.link,
        "metadata": data.metadata,
        "date": data.date.isoformat() if data.date else None,
    }

    entry_rows = await db.post("entry", entry_data)
    if not entry_rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create entry",
        )

    entry = Entry(**entry_rows[0])
    place = None

    # Create place if provided
    if data.place:
        logger.info(
            "Creating place for entry %s: place_name=%s, google_place_id=%s",
            entry.id,
            data.place.place_name,
            data.place.google_place_id,
        )
        place_data = {
            "entry_id": str(entry.id),
            "google_place_id": data.place.google_place_id,
            "place_name": data.place.place_name,
            "lat": data.place.lat,
            "lng": data.place.lng,
            "address": data.place.address,
            "extra_data": data.place.extra_data,
        }
        place_rows = await db.post("place", place_data)
        logger.info("Place creation result for entry %s: %s", entry.id, place_rows)
        if not place_rows:
            # Rollback: delete the entry we just created
            # If cleanup fails, log the orphaned entry for manual resolution
            try:
                await db.delete("entry", {"id": f"eq.{entry.id}"})
                logger.warning(
                    "Place creation failed for entry %s, successfully rolled back",
                    entry.id,
                )
            except Exception as cleanup_error:
                logger.error(
                    "ORPHANED ENTRY: Entry %s created but place creation failed "
                    "and cleanup delete also failed: %s. Manual cleanup required.",
                    entry.id,
                    cleanup_error,
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create entry. Please contact support.",
                ) from None
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create place for entry",
            )
        place = Place(**place_rows[0])

    # Reassign pending media to this entry
    if data.pending_media_ids:
        media_ids = ",".join(str(mid) for mid in data.pending_media_ids)

        # Verify all media belongs to current user (defense in depth)
        owned_media = await db.get(
            "media_files",
            {
                "id": f"in.({media_ids})",
                "owner_id": f"eq.{user.id}",
                "select": "id",
            },
        )

        if len(owned_media) != len(data.pending_media_ids):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="One or more media files do not belong to you",
            )

        await db.patch(
            "media_files",
            {"entry_id": str(entry.id)},
            {"id": f"in.({media_ids})"},
        )

    return EntryWithPlace(**entry.model_dump(), place=place)


@router.get("/entries/{entry_id}", response_model=EntryWithPlace)
async def get_entry(
    request: Request,
    entry_id: UUID,
    user: CurrentUser,
) -> EntryWithPlace:
    """Get a single entry by ID with embedded place data."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Fetch entry with embedded place in single query
    entries = await db.get("entry", {"id": f"eq.{entry_id}", "select": "*, place(*)"})

    if not entries:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found",
        )

    entry_row = entries[0]
    place_data = entry_row.pop("place", None)
    entry = Entry(**entry_row)

    # Parse place if it exists
    # PostgREST returns one-to-one relationships as a single object (not array)
    place = None
    if place_data:
        if isinstance(place_data, dict):
            place = Place(**place_data)
        elif isinstance(place_data, list) and len(place_data) > 0:
            place = Place(**place_data[0])

    # Fallback: if embedded query returned no place, try fetching directly
    # This works around potential PostgREST embedding issues
    if place is None:
        places = await db.get("place", {"entry_id": f"eq.{entry_id}"})
        if places and len(places) > 0:
            place = Place(**places[0])

    return EntryWithPlace(**entry.model_dump(), place=place)


@router.patch("/entries/{entry_id}", response_model=EntryWithPlace)
@limiter.limit("30/minute")
async def update_entry(
    request: Request,
    entry_id: UUID,
    data: EntryUpdate,
    user: CurrentUser,
) -> EntryWithPlace:
    """Update an entry atomically with its associated place data.

    Uses a database transaction to ensure entry and place updates either
    both succeed or both fail, preventing data inconsistency.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    # Extract place data before processing entry fields
    place_data = update_data.pop("place", None)

    # Validate place data if provided (but not for empty dict which signals deletion)
    if place_data is not None and place_data != {} and not place_data.get("place_name"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="place_name is required when providing place data",
        )

    # Determine place operation for the atomic function
    if place_data is None:
        place_operation = "none"  # Preserve existing place
        place_payload: dict = {}
    elif place_data == {}:
        place_operation = "delete"  # Remove existing place
        place_payload = {}
    else:
        place_operation = "upsert"  # Create or update place
        place_payload = {
            "google_place_id": place_data.get("google_place_id"),
            "place_name": place_data.get("place_name"),
            "lat": place_data.get("lat"),
            "lng": place_data.get("lng"),
            "address": place_data.get("address"),
            "extra_data": place_data.get("extra_data"),
        }

    # Prepare entry data for the RPC call
    entry_payload: dict = {}
    for key, value in update_data.items():
        if value is not None:
            if key == "date":
                entry_payload[key] = value.isoformat()
            elif key == "type" and isinstance(value, EntryType):
                entry_payload[key] = value.value
            else:
                entry_payload[key] = value
        elif key in update_data:
            # Explicitly set to null (e.g., clearing notes)
            entry_payload[key] = None

    # Call atomic RPC function - both entry and place update in single transaction
    result = await db.rpc(
        "atomic_update_entry_with_place",
        {
            "p_entry_id": str(entry_id),
            "p_entry_data": entry_payload,
            "p_place_operation": place_operation,
            "p_place_data": place_payload,
        },
    )

    if result is None or len(result) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found or not authorized to update",
        )

    # Parse the result from the RPC function
    row = result[0]
    entry_data = row.get("entry_row")
    place_data_result = row.get("place_row")

    if not entry_data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update entry",
        )

    entry = Entry(**entry_data)
    place = Place(**place_data_result) if place_data_result else None

    return EntryWithPlace(**entry.model_dump(), place=place)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
async def delete_entry(
    request: Request,
    entry_id: UUID,
    user: CurrentUser,
) -> None:
    """Soft-delete an entry.

    The entry can be restored within 30 days using the restore endpoint.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Atomic soft delete using SECURITY DEFINER function
    # This verifies trip ownership and sets deleted_at in a single operation
    result = await db.rpc("soft_delete_entry", {"p_entry_id": str(entry_id)})

    # RPC returns boolean: True if deleted, False if not found/not authorized
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found or not authorized",
        )


@router.post("/entries/{entry_id}/restore", response_model=EntryWithPlace)
@limiter.limit("30/minute")
async def restore_entry(
    request: Request,
    entry_id: UUID,
    user: CurrentUser,
) -> EntryWithPlace:
    """Restore a soft-deleted entry."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Restore by clearing deleted_at timestamp
    rows = await db.patch(
        "entry",
        {"deleted_at": None},
        {"id": f"eq.{entry_id}", "deleted_at": "not.is.null"},
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found or not deleted",
        )

    entry = Entry(**rows[0])
    place = None

    # Fetch place if this entry has one
    places = await db.get("place", {"entry_id": f"eq.{entry_id}"})
    if places:
        place = Place(**places[0])

    return EntryWithPlace(**entry.model_dump(), place=place)
