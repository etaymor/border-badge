"""Shareable list endpoints."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.lists import (
    ListCreate,
    ListDetail,
    ListEntriesUpdate,
    ListEntry,
    ListSummary,
    ListUpdate,
    PublicListView,
)

router = APIRouter()


@router.get("/trips/{trip_id}/lists", response_model=list[ListSummary])
async def list_trip_lists(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> list[ListSummary]:
    """Get all lists for a trip."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Verify user has access to trip
    trips = await db.get("trip", {"id": f"eq.{trip_id}"})
    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
        )

    # Get lists with entry count
    lists = await db.get(
        "list",
        {
            "trip_id": f"eq.{trip_id}",
            "select": "*, list_entries(count)",
            "order": "created_at.desc",
        },
    )

    result = []
    for lst in lists:
        entry_count = 0
        if lst.get("list_entries"):
            entry_count = (
                lst["list_entries"][0].get("count", 0) if lst["list_entries"] else 0
            )

        result.append(
            ListSummary(
                id=lst["id"],
                trip_id=lst["trip_id"],
                owner_id=lst["owner_id"],
                name=lst["name"],
                slug=lst["slug"],
                description=lst.get("description"),
                is_public=lst["is_public"],
                entry_count=entry_count,
                created_at=lst["created_at"],
                updated_at=lst["updated_at"],
            )
        )

    return result


@router.post(
    "/trips/{trip_id}/lists",
    response_model=ListDetail,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def create_list(
    request: Request,
    trip_id: UUID,
    data: ListCreate,
    user: CurrentUser,
) -> ListDetail:
    """Create a new shareable list for a trip.

    Only the trip owner can create lists.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Verify user owns the trip
    trips = await db.get("trip", {"id": f"eq.{trip_id}", "user_id": f"eq.{user.id}"})
    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not authorized",
        )

    # Validate entry_ids belong to this trip
    if data.entry_ids:
        entries = await db.get(
            "entry",
            {
                "id": f"in.({','.join(str(eid) for eid in data.entry_ids)})",
                "trip_id": f"eq.{trip_id}",
            },
        )
        valid_entry_ids = {e["id"] for e in entries}
        invalid_ids = [
            str(eid) for eid in data.entry_ids if str(eid) not in valid_entry_ids
        ]
        if invalid_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid entry IDs: {', '.join(invalid_ids)}",
            )

    # Create list
    list_data = {
        "trip_id": str(trip_id),
        "owner_id": user.id,
        "name": data.name,
        "description": data.description,
        "is_public": data.is_public,
    }

    rows = await db.post("list", list_data)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create list",
        )

    lst = rows[0]
    entries: list[ListEntry] = []

    # Add entries to list
    if data.entry_ids:
        for position, entry_id in enumerate(data.entry_ids):
            entry_data = {
                "list_id": lst["id"],
                "entry_id": str(entry_id),
                "position": position,
            }
            entry_rows = await db.post("list_entries", entry_data)
            if entry_rows:
                entries.append(ListEntry(**entry_rows[0]))

    return ListDetail(
        id=lst["id"],
        trip_id=lst["trip_id"],
        owner_id=lst["owner_id"],
        name=lst["name"],
        slug=lst["slug"],
        description=lst.get("description"),
        is_public=lst["is_public"],
        created_at=lst["created_at"],
        updated_at=lst["updated_at"],
        entries=entries,
    )


@router.get("/lists/{list_id}", response_model=ListDetail)
async def get_list(
    request: Request,
    list_id: UUID,
    user: CurrentUser,
) -> ListDetail:
    """Get list details with entries."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Fetch list
    lists = await db.get("list", {"id": f"eq.{list_id}"})
    if not lists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="List not found",
        )

    lst = lists[0]

    # Fetch entries
    entry_rows = await db.get(
        "list_entries",
        {
            "list_id": f"eq.{list_id}",
            "order": "position.asc",
        },
    )

    entries = [ListEntry(**row) for row in entry_rows]

    return ListDetail(
        id=lst["id"],
        trip_id=lst["trip_id"],
        owner_id=lst["owner_id"],
        name=lst["name"],
        slug=lst["slug"],
        description=lst.get("description"),
        is_public=lst["is_public"],
        created_at=lst["created_at"],
        updated_at=lst["updated_at"],
        entries=entries,
    )


@router.patch("/lists/{list_id}", response_model=ListDetail)
async def update_list(
    request: Request,
    list_id: UUID,
    data: ListUpdate,
    user: CurrentUser,
) -> ListDetail:
    """Update a list (owner only)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    rows = await db.patch(
        "list",
        update_data,
        {"id": f"eq.{list_id}", "owner_id": f"eq.{user.id}"},
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="List not found or not authorized",
        )

    lst = rows[0]

    # Fetch entries
    entry_rows = await db.get(
        "list_entries",
        {
            "list_id": f"eq.{list_id}",
            "order": "position.asc",
        },
    )

    entries = [ListEntry(**row) for row in entry_rows]

    return ListDetail(
        id=lst["id"],
        trip_id=lst["trip_id"],
        owner_id=lst["owner_id"],
        name=lst["name"],
        slug=lst["slug"],
        description=lst.get("description"),
        is_public=lst["is_public"],
        created_at=lst["created_at"],
        updated_at=lst["updated_at"],
        entries=entries,
    )


@router.put("/lists/{list_id}/entries", response_model=ListDetail)
async def update_list_entries(
    request: Request,
    list_id: UUID,
    data: ListEntriesUpdate,
    user: CurrentUser,
) -> ListDetail:
    """Replace all entries in a list (owner only)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Verify ownership
    lists = await db.get(
        "list",
        {"id": f"eq.{list_id}", "owner_id": f"eq.{user.id}"},
    )
    if not lists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="List not found or not authorized",
        )

    lst = lists[0]

    # Validate entry_ids belong to the list's trip
    if data.entry_ids:
        entries = await db.get(
            "entry",
            {
                "id": f"in.({','.join(str(eid) for eid in data.entry_ids)})",
                "trip_id": f"eq.{lst['trip_id']}",
            },
        )
        valid_entry_ids = {e["id"] for e in entries}
        invalid_ids = [
            str(eid) for eid in data.entry_ids if str(eid) not in valid_entry_ids
        ]
        if invalid_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid entry IDs: {', '.join(invalid_ids)}",
            )

    # Delete existing entries
    await db.delete("list_entries", {"list_id": f"eq.{list_id}"})

    # Add new entries
    new_entries: list[ListEntry] = []
    for position, entry_id in enumerate(data.entry_ids):
        entry_data = {
            "list_id": str(list_id),
            "entry_id": str(entry_id),
            "position": position,
        }
        entry_rows = await db.post("list_entries", entry_data)
        if entry_rows:
            new_entries.append(ListEntry(**entry_rows[0]))

    return ListDetail(
        id=lst["id"],
        trip_id=lst["trip_id"],
        owner_id=lst["owner_id"],
        name=lst["name"],
        slug=lst["slug"],
        description=lst.get("description"),
        is_public=lst["is_public"],
        created_at=lst["created_at"],
        updated_at=lst["updated_at"],
        entries=new_entries,
    )


@router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(
    request: Request,
    list_id: UUID,
    user: CurrentUser,
) -> None:
    """Delete a list (owner only)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    await db.delete("list", {"id": f"eq.{list_id}", "owner_id": f"eq.{user.id}"})


# Public endpoint (no auth required)
@router.get("/public/lists/{slug}", response_model=PublicListView)
async def get_public_list(
    slug: str,
) -> PublicListView:
    """Get a public list by slug (no authentication required)."""
    db = get_supabase_client()  # No user token - uses service role or anon

    # Fetch list by slug
    lists = await db.get(
        "list",
        {
            "slug": f"eq.{slug}",
            "is_public": "eq.true",
            "select": "*, trip:trip_id(name, country:country_id(name))",
        },
    )

    if not lists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="List not found",
        )

    lst = lists[0]

    # Fetch entries with details
    entry_rows = await db.get(
        "list_entries",
        {
            "list_id": f"eq.{lst['id']}",
            "select": "*, entry:entry_id(id, title, type, notes, place:place(place_name, address))",
            "order": "position.asc",
        },
    )

    entries = []
    for row in entry_rows:
        entry = row.get("entry", {})
        if entry:
            place = entry.get("place", {}) if entry.get("place") else {}
            entries.append(
                {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "type": entry.get("type"),
                    "notes": entry.get("notes"),
                    "place_name": place.get("place_name"),
                    "address": place.get("address"),
                }
            )

    trip = lst.get("trip", {}) or {}
    country = trip.get("country", {}) or {}

    return PublicListView(
        id=lst["id"],
        name=lst["name"],
        slug=lst["slug"],
        description=lst.get("description"),
        trip_name=trip.get("name"),
        country_name=country.get("name"),
        created_at=lst["created_at"],
        entries=entries,
    )
