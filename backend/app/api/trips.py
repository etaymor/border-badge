"""Trip CRUD and sharing endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.trips_helpers import format_daterange, trip_from_row
from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.notifications import send_trip_tag_notification
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.public import TripShareResponse
from app.schemas.trips import (
    Trip,
    TripCreate,
    TripTag,
    TripTagStatus,
    TripUpdate,
    TripWithTags,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[Trip])
async def list_trips(
    request: Request,
    user: CurrentUser,
    country_code: str | None = Query(None, description="Filter trips by country code"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Trip]:
    """List all trips accessible to the current user (owned or approved tags).

    Optionally filter by country_code to get trips for a specific country.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    params: dict[str, str | int] = {
        "select": "*, country:country_id(code)",
        "order": "created_at.desc",
        "limit": limit,
        "offset": offset,
    }
    if country_code:
        # Look up country UUID from code
        countries = await db.get("country", {"code": f"eq.{country_code}"})
        if countries:
            params["country_id"] = f"eq.{countries[0]['id']}"
        else:
            return []  # No matching country, return empty list
    rows = await db.get("trip", params)

    return [trip_from_row(row) for row in rows]


@router.post("", response_model=TripWithTags, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def create_trip(
    request: Request,
    data: TripCreate,
    user: CurrentUser,
) -> TripWithTags:
    """Create a new trip.

    Optionally tag other users who will receive pending invitations.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Look up country UUID from code
    countries = await db.get("country", {"code": f"eq.{data.country_code}"})
    if not countries:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Country not found: {data.country_code}",
        )
    country_id = countries[0]["id"]

    # Build trip data
    trip_data = {
        "user_id": user.id,
        "country_id": str(country_id),
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

    # We already have the country_code from the input
    trip = Trip(**rows[0], country_code=data.country_code)
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
    """Get trip details with tags (single query with embedded data)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Fetch trip with country code and tags in single query
    trips = await db.get(
        "trip",
        {
            "id": f"eq.{trip_id}",
            "select": "*, country:country_id(code), trip_tags(*)",
        },
    )
    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
        )

    row = trips[0]
    country_code = row.get("country", {}).get("code", "") if row.get("country") else ""

    # Extract embedded trip_tags
    tag_data = row.pop("trip_tags", None)
    tags = []
    if tag_data and isinstance(tag_data, list):
        tags = [TripTag(**tag) for tag in tag_data]

    trip = Trip(
        **{k: v for k, v in row.items() if k != "country"}, country_code=country_code
    )

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
            update_data["date_range"] = format_daterange(start, end)

    rows = await db.patch(
        "trip",
        update_data,
        {"id": f"eq.{trip_id}", "select": "*, country:country_id(code)"},
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not authorized",
        )

    return trip_from_row(rows[0])


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/minute")
async def delete_trip(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> None:
    """Soft-delete a trip (owner only).

    The trip can be restored within 30 days using the restore endpoint.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Atomic soft delete using SECURITY DEFINER function
    # This verifies ownership and sets deleted_at in a single operation
    result = await db.rpc("soft_delete_trip", {"p_trip_id": str(trip_id)})

    # RPC returns boolean: True if deleted, False if not found/not authorized
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not authorized",
        )


@router.post("/{trip_id}/restore", response_model=Trip)
@limiter.limit("10/minute")
async def restore_trip(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> Trip:
    """Restore a soft-deleted trip (owner only)."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Restore by clearing deleted_at timestamp
    # Note: RLS policies filter out deleted trips, so we need to query directly
    rows = await db.patch(
        "trip",
        {"deleted_at": None},
        {
            "id": f"eq.{trip_id}",
            "user_id": f"eq.{user.id}",
            "deleted_at": "not.is.null",
            "select": "*, country:country_id(code)",
        },
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not deleted",
        )

    return trip_from_row(rows[0])


@router.post("/{trip_id}/share", response_model=TripShareResponse)
@limiter.limit("10/minute")
async def generate_share_link(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> TripShareResponse:
    """Generate a public share link for a trip (owner only).

    Creates a unique share_slug that allows the trip to be viewed publicly.
    If a share link already exists, returns the existing one.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    settings = get_settings()

    # Check if trip exists and user owns it
    trips = await db.get(
        "trip",
        {
            "id": f"eq.{trip_id}",
            "user_id": f"eq.{user.id}",
            "select": "id, name, share_slug",
        },
    )

    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not authorized",
        )

    trip = trips[0]

    # If already has a share slug, return it
    if trip.get("share_slug"):
        return TripShareResponse(
            share_slug=trip["share_slug"],
            share_url=f"{settings.base_url}/t/{trip['share_slug']}",
        )

    # Generate a new share slug using the database function
    result = await db.rpc("generate_trip_share_slug", {"trip_name": trip["name"]})
    if not result:
        logger.error(f"RPC generate_trip_share_slug returned empty for trip {trip_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate share link",
        )

    # Validate result type - RPC may return string directly or wrapped in list
    if isinstance(result, list) and len(result) > 0:
        share_slug = result[0] if isinstance(result[0], str) else str(result[0])
    elif isinstance(result, str):
        share_slug = result
    else:
        logger.error(f"Unexpected RPC result type: {type(result)} - {result}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate share link",
        )

    # Atomic update - only succeeds if share_slug is still NULL (prevents race condition)
    rows = await db.patch(
        "trip",
        {"share_slug": share_slug},
        {
            "id": f"eq.{trip_id}",
            "user_id": f"eq.{user.id}",
            "share_slug": "is.null",
        },
    )

    if not rows:
        # Race condition: another request already set the share_slug
        # Re-fetch to get the existing slug
        trips = await db.get(
            "trip",
            {"id": f"eq.{trip_id}", "user_id": f"eq.{user.id}", "select": "share_slug"},
        )
        if not trips or not trips[0].get("share_slug"):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save share link",
            )
        share_slug = trips[0]["share_slug"]

    return TripShareResponse(
        share_slug=share_slug,
        share_url=f"{settings.base_url}/t/{share_slug}",
    )


@router.delete("/{trip_id}/share", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/minute")
async def revoke_share_link(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> None:
    """Remove public share access for a trip (owner only).

    Clears the share_slug, making the trip private again.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    rows = await db.patch(
        "trip",
        {"share_slug": None},
        {"id": f"eq.{trip_id}", "user_id": f"eq.{user.id}"},
    )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not authorized",
        )
