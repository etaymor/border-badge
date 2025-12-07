"""Entry endpoints."""

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
    EntryUpdate,
    EntryWithPlace,
    Place,
)

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

        # Parse place if it exists (place is an array from PostgREST)
        place = None
        if place_data and isinstance(place_data, list) and len(place_data) > 0:
            place = Place(**place_data[0])

        # Parse media_files and build URLs
        media_files = []
        if media_data and isinstance(media_data, list):
            for media in media_data:
                if media.get("status") != "uploaded":
                    continue

                file_path = media.get("file_path")
                if not file_path:
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
        if not place_rows:
            # Rollback: delete the entry we just created
            await db.delete("entry", {"id": f"eq.{entry.id}"})
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
    """Get a single entry by ID."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    entries = await db.get("entry", {"id": f"eq.{entry_id}"})
    if not entries:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found",
        )

    entry = Entry(**entries[0])
    place = None

    # Fetch place if this is a place-type entry
    places = await db.get("place", {"entry_id": f"eq.{entry_id}"})
    if places:
        place = Place(**places[0])

    return EntryWithPlace(**entry.model_dump(), place=place)


@router.patch("/entries/{entry_id}", response_model=Entry)
@limiter.limit("30/minute")
async def update_entry(
    request: Request,
    entry_id: UUID,
    data: EntryUpdate,
    user: CurrentUser,
) -> Entry:
    """Update an entry."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    # Convert date to ISO format if present
    if "date" in update_data and update_data["date"]:
        update_data["date"] = update_data["date"].isoformat()

    rows = await db.patch("entry", update_data, {"id": f"eq.{entry_id}"})
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found or not authorized",
        )

    return Entry(**rows[0])


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
