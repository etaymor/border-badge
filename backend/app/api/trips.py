"""Trip and trip_tags endpoints."""

import asyncio
import logging
from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.edge_functions import send_push_notification
from app.core.notifications import send_trip_tag_notification
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.public import TripShareResponse
from app.schemas.trips import (
    Trip,
    TripCreate,
    TripTag,
    TripTagAction,
    TripTagStatus,
    TripUpdate,
    TripWithTags,
)

logger = logging.getLogger(__name__)

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

    return [
        Trip(
            **{k: v for k, v in row.items() if k != "country"},
            country_code=row.get("country", {}).get("code", "")
            if row.get("country")
            else "",
        )
        for row in rows
    ]


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
            update_data["date_range"] = format_daterange(
                start,
                end,
            )

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

    row = rows[0]
    country_code = row.get("country", {}).get("code", "") if row.get("country") else ""
    return Trip(
        **{k: v for k, v in row.items() if k != "country"}, country_code=country_code
    )


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

    row = rows[0]
    country_code = row.get("country", {}).get("code", "") if row.get("country") else ""
    return Trip(
        **{k: v for k, v in row.items() if k != "country"}, country_code=country_code
    )


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

    # Auto-follow on approval: tagged user follows trip owner
    if new_status == TripTagStatus.APPROVED:

        async def auto_follow_trip_owner() -> None:
            try:
                admin_db = get_supabase_client()

                # Get trip to find owner
                trips = await admin_db.get(
                    "trip",
                    {
                        "select": "user_id",
                        "id": f"eq.{trip_id}",
                    },
                )
                if not trips:
                    return

                trip_owner_id = trips[0]["user_id"]

                # Skip if already following
                existing_follow = await admin_db.get(
                    "user_follow",
                    {
                        "select": "id",
                        "follower_id": f"eq.{user_id}",
                        "following_id": f"eq.{trip_owner_id}",
                    },
                )
                if existing_follow:
                    return

                # Check for blocks
                blocks = await admin_db.get(
                    "user_block",
                    {
                        "select": "id",
                        "or": f"(blocker_id.eq.{user_id},blocked_id.eq.{trip_owner_id}),"
                        f"(blocker_id.eq.{trip_owner_id},blocked_id.eq.{user_id})",
                    },
                )
                if blocks:
                    return

                # Create mutual follow
                await admin_db.post(
                    "user_follow",
                    {"follower_id": user_id, "following_id": trip_owner_id},
                )

                # Get trip owner's push token to notify
                owner_profile = await admin_db.get(
                    "user_profile",
                    {
                        "select": "push_token,display_name",
                        "user_id": f"eq.{trip_owner_id}",
                    },
                )
                if owner_profile and owner_profile[0].get("push_token"):
                    tagged_user = await admin_db.get(
                        "user_profile",
                        {
                            "select": "username,display_name",
                            "user_id": f"eq.{user_id}",
                        },
                    )
                    if tagged_user:
                        tagged_name = (
                            tagged_user[0].get("display_name")
                            or tagged_user[0].get("username")
                            or "Someone"
                        )
                        await send_push_notification(
                            tokens=[owner_profile[0]["push_token"]],
                            title="Trip Tag Accepted",
                            body=f"{tagged_name} accepted your trip tag and is now following you",
                            data={
                                "screen": "UserProfile",
                                "userId": user_id,
                                "username": tagged_user[0].get("username", ""),
                            },
                        )
            except Exception as e:
                logger.warning(f"Failed to auto-follow on tag acceptance: {e}")

        asyncio.create_task(auto_follow_trip_owner())

    return TripTagAction(
        status=new_status,
        responded_at=datetime.fromisoformat(rows[0]["responded_at"]),
    )


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
