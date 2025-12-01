"""Trip and trip_tags endpoints."""

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.notifications import send_trip_tag_notification
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.trips import (
    Trip,
    TripCreate,
    TripTag,
    TripTagAction,
    TripTagStatus,
    TripUpdate,
    TripWithTags,
)

router = APIRouter()


def format_daterange(start: date | None, end: date | None) -> str | None:
    """Format start/end dates as a PostgreSQL daterange literal.

    - Returns ``None`` when both bounds are missing (no date range).
    - Supports open-ended ranges when only one bound is provided.
    - Validates that the start date is not after the end date.
    """
    if start is None and end is None:
        return None

    if start is not None and end is not None:
        if start > end:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="date_start must be on or before date_end",
            )
        return f"[{start.isoformat()},{end.isoformat()}]"

    if start is not None:
        # Open-ended range going forward in time
        return f"[{start.isoformat()},infinity]"

    # Only end is provided: open-ended range going back in time
    return f"[-infinity,{end.isoformat()}]"


@router.get("", response_model=list[Trip])
async def list_trips(
    request: Request,
    user: CurrentUser,
    country_id: UUID | None = Query(None, description="Filter trips by country"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Trip]:
    """List all trips accessible to the current user (owned or approved tags).

    Optionally filter by country_id to get trips for a specific country.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    params: dict[str, str | int] = {
        "select": "*",
        "order": "created_at.desc",
        "limit": limit,
        "offset": offset,
    }
    if country_id:
        params["country_id"] = f"eq.{country_id}"
    rows = await db.get("trip", params)
    return [Trip(**row) for row in rows]


@router.post("", response_model=TripWithTags, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def create_trip(
    request: Request,
    data: TripCreate,
    user: CurrentUser,
) -> TripWithTags:
    """
    Create a new trip.

    Optionally tag other users who will receive pending invitations.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Build trip data
    trip_data = {
        "user_id": user.id,
        "country_id": str(data.country_id),
        "name": data.name,
        "cover_image_url": data.cover_image_url,
        "date_range": format_daterange(data.date_start, data.date_end),
    }

    rows = await db.post("trip", trip_data)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create trip",
        )

    trip = Trip(**rows[0])
    tags: list[TripTag] = []

    # Create trip tags for tagged users
    if data.tagged_user_ids:
        for tagged_user_id in data.tagged_user_ids:
            if str(tagged_user_id) == user.id:
                continue  # Don't tag yourself

            # Send notification (returns notification_id for future use)
            notification_id = await send_trip_tag_notification(
                trip_id=trip.id,
                trip_name=trip.name,
                initiator_id=user.id,
                tagged_user_id=tagged_user_id,
            )

            tag_data = {
                "trip_id": str(trip.id),
                "tagged_user_id": str(tagged_user_id),
                "status": TripTagStatus.PENDING.value,
                "initiated_by": user.id,
                "notification_id": notification_id,
            }
            tag_rows = await db.post("trip_tags", tag_data)
            if tag_rows:
                tags.append(TripTag(**tag_rows[0]))

    return TripWithTags(**trip.model_dump(), tags=tags)


@router.get("/{trip_id}", response_model=TripWithTags)
async def get_trip(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> TripWithTags:
    """Get trip details with tags."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Fetch trip (RLS ensures access control)
    trips = await db.get("trip", {"id": f"eq.{trip_id}"})
    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
        )

    trip = Trip(**trips[0])

    # Fetch tags
    tag_rows = await db.get("trip_tags", {"trip_id": f"eq.{trip_id}"})
    tags = [TripTag(**row) for row in tag_rows]

    return TripWithTags(**trip.model_dump(), tags=tags)


@router.patch("/{trip_id}", response_model=Trip)
@limiter.limit("20/minute")
async def update_trip(
    request: Request,
    trip_id: UUID,
    data: TripUpdate,
    user: CurrentUser,
) -> Trip:
    """Update a trip (owner only)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    # Handle date range separately
    if "date_start" in update_data or "date_end" in update_data:
        # Need to fetch existing dates first
        existing = await db.get("trip", {"id": f"eq.{trip_id}", "select": "date_range"})
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found"
            )

        start = update_data.pop("date_start", None)
        end = update_data.pop("date_end", None)
        if start is not None or end is not None:
            update_data["date_range"] = format_daterange(
                start,
                end,
            )

    rows = await db.patch("trip", update_data, {"id": f"eq.{trip_id}"})
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not authorized",
        )

    return Trip(**rows[0])


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/minute")
async def delete_trip(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> None:
    """Delete a trip (owner only)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    await db.delete("trip", {"id": f"eq.{trip_id}"})


@router.post("/{trip_id}/approve", response_model=TripTagAction)
async def approve_trip_tag(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> TripTagAction:
    """Approve a trip tag invitation."""
    token = get_token_from_request(request)
    return await _update_tag_status(trip_id, user.id, TripTagStatus.APPROVED, token)


@router.post("/{trip_id}/decline", response_model=TripTagAction)
async def decline_trip_tag(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> TripTagAction:
    """Decline a trip tag invitation."""
    token = get_token_from_request(request)
    return await _update_tag_status(trip_id, user.id, TripTagStatus.DECLINED, token)


async def _update_tag_status(
    trip_id: UUID,
    user_id: str,
    new_status: TripTagStatus,
    token: str | None,
) -> TripTagAction:
    """Update trip tag status for the current user."""
    db = get_supabase_client(user_token=token)

    # Find the user's tag for this trip
    tags = await db.get(
        "trip_tags",
        {"trip_id": f"eq.{trip_id}", "tagged_user_id": f"eq.{user_id}"},
    )

    if not tags:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tag not found",
        )

    tag = tags[0]

    # Use optimistic locking - include status in WHERE clause to prevent race conditions
    responded_at = datetime.now(UTC).isoformat()
    rows = await db.patch(
        "trip_tags",
        {"status": new_status.value, "responded_at": responded_at},
        {
            "id": f"eq.{tag['id']}",
            "status": f"eq.{TripTagStatus.PENDING.value}",  # Only update if still pending
        },
    )

    if not rows:
        # Either tag doesn't exist or status already changed
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tag has already been responded to",
        )

    return TripTagAction(
        status=new_status,
        responded_at=datetime.fromisoformat(rows[0]["responded_at"]),
    )
