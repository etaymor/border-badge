"""Trip tag endpoints for consent workflow and friend tagging."""

import asyncio
import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from app.api.trips_helpers import verify_trip_ownership
from app.api.utils import get_token_from_request
from app.core.edge_functions import send_push_notification
from app.core.notifications import send_trip_tag_notification
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.trips import TripTag, TripTagAction, TripTagStatus

logger = logging.getLogger(__name__)

router = APIRouter()


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
        asyncio.create_task(_auto_follow_trip_owner(trip_id, user_id))

    return TripTagAction(
        status=new_status,
        responded_at=datetime.fromisoformat(rows[0]["responded_at"]),
    )


async def _auto_follow_trip_owner(trip_id: UUID, follower_user_id: str) -> None:
    """Auto-follow the trip owner when a tag is approved."""
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
        follower_id = str(follower_user_id)
        following_id = str(trip_owner_id)

        # Skip if already following
        existing_follow = await admin_db.get(
            "user_follow",
            {
                "select": "id",
                "follower_id": f"eq.{follower_id}",
                "following_id": f"eq.{following_id}",
            },
        )
        if existing_follow:
            return

        # Check for blocks
        blocks = await admin_db.get(
            "user_block",
            {
                "select": "id",
                "or": f"(and(blocker_id.eq.{follower_id},blocked_id.eq.{following_id})),"
                f"(and(blocker_id.eq.{following_id},blocked_id.eq.{follower_id}))",
            },
        )
        if blocks:
            return

        # Create follow relationship
        await admin_db.post(
            "user_follow",
            {"follower_id": follower_id, "following_id": following_id},
        )

        # Notify trip owner
        await _notify_trip_owner_of_acceptance(admin_db, follower_id, following_id)

    except Exception as e:
        logger.warning(f"Failed to auto-follow on tag acceptance: {e}")


async def _notify_trip_owner_of_acceptance(
    db: "SupabaseClient",  # noqa: F821
    follower_id: str,
    owner_id: str,
) -> None:
    """Send push notification to trip owner when tag is accepted."""
    owner_profile = await db.get(
        "user_profile",
        {
            "select": "push_token,display_name",
            "user_id": f"eq.{owner_id}",
        },
    )
    if not owner_profile or not owner_profile[0].get("push_token"):
        return

    tagged_user = await db.get(
        "user_profile",
        {
            "select": "username,display_name",
            "user_id": f"eq.{follower_id}",
        },
    )
    if not tagged_user:
        return

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
            "userId": follower_id,
            "username": tagged_user[0].get("username", ""),
        },
    )


@router.post("/{trip_id}/tags/{tagged_user_id}", response_model=TripTag)
@limiter.limit("20/minute")
async def add_trip_tag(
    request: Request,
    trip_id: UUID,
    tagged_user_id: UUID,
    user: CurrentUser,
) -> TripTag:
    """Add a tag to an existing trip (owner only).

    Creates a pending tag invitation for the specified user.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Verify trip ownership
    trip = await verify_trip_ownership(db, str(trip_id), user.id, select="id,name")

    # Don't allow tagging yourself
    if str(tagged_user_id) == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot tag yourself",
        )

    # Check if tag already exists
    existing_tags = await db.get(
        "trip_tags",
        {"trip_id": f"eq.{trip_id}", "tagged_user_id": f"eq.{tagged_user_id}"},
    )
    if existing_tags:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already tagged on this trip",
        )

    # Send notification
    notification_id = await send_trip_tag_notification(
        trip_id=trip_id,
        trip_name=trip["name"],
        initiator_id=user.id,
        tagged_user_id=tagged_user_id,
    )

    # Create the tag
    tag_data = {
        "trip_id": str(trip_id),
        "tagged_user_id": str(tagged_user_id),
        "status": TripTagStatus.PENDING.value,
        "initiated_by": user.id,
        "notification_id": notification_id,
    }
    tag_rows = await db.post("trip_tags", tag_data)
    if not tag_rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create tag",
        )

    return TripTag(**tag_rows[0])


@router.delete(
    "/{trip_id}/tags/{tagged_user_id}", status_code=status.HTTP_204_NO_CONTENT
)
@limiter.limit("20/minute")
async def remove_trip_tag(
    request: Request,
    trip_id: UUID,
    tagged_user_id: UUID,
    user: CurrentUser,
) -> None:
    """Remove a tag from a trip (owner only).

    Deletes the tag regardless of its status.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Verify trip ownership
    await verify_trip_ownership(db, str(trip_id), user.id)

    # Delete the tag
    deleted = await db.delete(
        "trip_tags",
        {"trip_id": f"eq.{trip_id}", "tagged_user_id": f"eq.{tagged_user_id}"},
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tag not found",
        )
