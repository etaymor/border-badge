"""Entry endpoints."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.schemas.entries import (
    Entry,
    EntryCreate,
    EntryUpdate,
    EntryWithPlace,
    Place,
)

router = APIRouter()


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


@router.get("/trips/{trip_id}/entries", response_model=list[EntryWithPlace])
async def list_entries(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> list[EntryWithPlace]:
    """List all entries for a trip."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Fetch entries (RLS ensures trip access)
    entries = await db.get(
        "entry",
        {"trip_id": f"eq.{trip_id}", "select": "*", "order": "date.asc.nullslast,created_at.asc"},
    )

    results = []
    for entry_row in entries:
        entry = Entry(**entry_row)
        place = None

        # Fetch associated place if exists
        if entry.type.value == "place":
            places = await db.get("place", {"entry_id": f"eq.{entry.id}"})
            if places:
                place = Place(**places[0])

        results.append(EntryWithPlace(**entry.model_dump(), place=place))

    return results


@router.post(
    "/trips/{trip_id}/entries",
    response_model=EntryWithPlace,
    status_code=status.HTTP_201_CREATED,
)
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
        if place_rows:
            place = Place(**place_rows[0])

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
async def delete_entry(
    request: Request,
    entry_id: UUID,
    user: CurrentUser,
) -> None:
    """Delete an entry (cascades to place)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    await db.delete("entry", {"id": f"eq.{entry_id}"})
