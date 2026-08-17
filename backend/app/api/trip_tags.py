"""Trip tag endpoints for consent workflow and friend tagging."""

import asyncio
import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, status

from app.api.trips_helpers import verify_trip_ownership
from app.api.utils import get_token_from_request
from app.core.edge_functions import send_push_notification
from app.core.notifications import send_trip_tag_notification
from app.core.security import CurrentUser
from app.db.postgrest import in_list
from app.db.session import get_service_supabase_client, get_supabase_client
from app.main import limiter
from app.schemas.trips import (
    PendingTripTagCount,
    PendingTripTagDetail,
    TripTag,
    TripTagAction,
    TripTagStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/pending", response_model=list[PendingTripTagDetail])
@limiter.limit("30/minute")
async def get_pending_trip_tags(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[PendingTripTagDetail]:
    """Get pending trip tag invitations for the current user.

    Returns tags where the current user has been invited but hasn't responded
    yet. Tags initiated by users with a block in either direction are
    filtered out (block_user_full clears pending tags at block time; this
    read-side filter also covers rows created before that migration).
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Fetch pending tags with trip details (trip_tags.initiated_by -> auth.users,
    # not user_profile, so we can't use PostgREST embedding for initiator)
    tags = await db.get(
        "trip_tags",
        {
            "select": (
                "id,trip_id,initiated_by,created_at,"
                "trip:trip_id(name,country:country_id(code))"
            ),
            "tagged_user_id": f"eq.{user.id}",
            "status": f"eq.{TripTagStatus.PENDING.value}",
            "order": "created_at.desc",
            "limit": limit,
            "offset": offset,
        },
    )

    if not tags:
        return []

    # Collect unique initiator IDs and fetch their profiles separately
    initiator_ids = list(
        {tag["initiated_by"] for tag in tags if tag.get("initiated_by")}
    )
    initiator_map: dict[str, dict] = {}
    blocked_initiator_ids: set[str] = set()

    if initiator_ids:
        initiator_id_list = in_list([str(uid) for uid in initiator_ids])
        # Block filtering needs the service client: RLS hides "someone
        # blocked me" user_block rows from the blocked party's JWT.
        service_db = get_service_supabase_client()
        initiators, blocks_out, blocks_in = await asyncio.gather(
            db.get(
                "user_profile",
                {
                    "select": "user_id,username,avatar_url",
                    "user_id": initiator_id_list,
                },
            ),
            service_db.get(
                "user_block",
                {
                    "select": "blocked_id",
                    "blocker_id": f"eq.{user.id}",
                    "blocked_id": initiator_id_list,
                },
            ),
            service_db.get(
                "user_block",
                {
                    "select": "blocker_id",
                    "blocked_id": f"eq.{user.id}",
                    "blocker_id": initiator_id_list,
                },
            ),
        )
        if initiators:
            initiator_map = {p["user_id"]: p for p in initiators}
        blocked_initiator_ids = {row["blocked_id"] for row in blocks_out or []} | {
            row["blocker_id"] for row in blocks_in or []
        }

    results = []
    for tag in tags:
        # Hide tags from users with a block in either direction
        if tag.get("initiated_by") in blocked_initiator_ids:
            continue
        # Validate required fields exist
        tag_id = tag.get("id")
        trip_id = tag.get("trip_id")
        created_at = tag.get("created_at")
        if not tag_id or not trip_id or not created_at:
            logger.warning(
                f"Skipping tag with missing required fields: id={tag_id}, "
                f"trip_id={trip_id}, created_at={created_at}"
            )
            continue

        # Extract nested trip data
        trip_data = tag.get("trip")
        trip_name = "Unknown Trip"
        trip_country_code = ""
        if trip_data:
            trip_name = trip_data.get("name", "Unknown Trip")
            country_data = trip_data.get("country")
            if country_data:
                trip_country_code = country_data.get("code", "")

        # Get initiator data from our separate query
        initiated_by_id = tag.get("initiated_by")
        initiator_data = (
            initiator_map.get(initiated_by_id, {}) if initiated_by_id else {}
        )

        results.append(
            PendingTripTagDetail(
                id=tag_id,
                trip_id=trip_id,
                trip_name=trip_name,
                trip_country_code=trip_country_code,
                initiated_by=initiated_by_id,
                initiated_by_username=initiator_data.get("username"),
                initiated_by_avatar_url=initiator_data.get("avatar_url"),
                created_at=created_at,
            )
        )

    return results


@router.get("/pending/count", response_model=PendingTripTagCount)
@limiter.limit("60/minute")
async def get_pending_trip_tag_count(
    request: Request,
    user: CurrentUser,
) -> PendingTripTagCount:
    """Return the number of pending trip tags for the current user."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    count = await db.count(
        "trip_tags",
        {
            "tagged_user_id": f"eq.{user.id}",
            "status": f"eq.{TripTagStatus.PENDING.value}",
        },
    )

    return PendingTripTagCount(count=count)


@router.post("/{trip_id}/approve", response_model=TripTagAction)
@limiter.limit("30/minute")
async def approve_trip_tag(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> TripTagAction:
    """Approve a trip tag invitation."""
    token = get_token_from_request(request)
    return await _update_tag_status(
        trip_id, user.id, TripTagStatus.APPROVED, token, background_tasks
    )


@router.post("/{trip_id}/decline", response_model=TripTagAction)
@limiter.limit("30/minute")
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
    background_tasks: BackgroundTasks | None = None,
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
    if new_status == TripTagStatus.APPROVED and background_tasks:
        background_tasks.add_task(_auto_follow_trip_owner, trip_id, user_id)

    return TripTagAction(
        status=new_status,
        responded_at=datetime.fromisoformat(rows[0]["responded_at"]),
    )


async def _auto_follow_trip_owner(trip_id: UUID, follower_user_id: str) -> None:
    """Auto-follow the trip owner when a tag is approved."""
    try:
        admin_db = get_service_supabase_client()

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

        trip_owner_id = trips[0].get("user_id")
        if not trip_owner_id:
            logger.warning(f"Trip {trip_id} has no user_id, skipping auto-follow")
            return
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
    # Get push token from dedicated table (requires admin_db for cross-user access)
    push_token_row = await db.get(
        "push_token",
        {
            "select": "token",
            "user_id": f"eq.{owner_id}",
        },
    )
    if not push_token_row or not push_token_row[0].get("token"):
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
        tokens=[push_token_row[0]["token"]],
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
    background_tasks: BackgroundTasks,
) -> TripTag:
    """Add a tag to an existing trip (owner only).

    Creates a pending tag invitation for the specified user. The target must
    exist and must not have a block in either direction with the caller
    (both cases return 404 so a block never reveals user existence). The
    notification is sent as a background task only after the insert succeeds.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Verify trip ownership
    trip = await verify_trip_ownership(db, str(trip_id), user.id, select="id,name")

    # Don't allow tagging yourself
    # Normalize both to strings for reliable comparison
    if str(tagged_user_id) == str(user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot tag yourself",
        )

    # Target must exist. user_profile is readable by any authenticated user.
    target = await db.get(
        "user_profile",
        {
            "select": "user_id",
            "user_id": f"eq.{tagged_user_id}",
            "limit": 1,
        },
    )
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Bidirectional block check via SECURITY DEFINER RPC (a JWT-scoped
    # user_block query cannot see "someone blocked me" rows under RLS).
    # 404, not 403: a block must not reveal that the user exists.
    blocked = await db.rpc(
        "is_blocked_bidirectional", {"p_user_id": str(tagged_user_id)}
    )
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
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

    # Create the tag FIRST; notify only after the insert succeeds.
    tag_data = {
        "trip_id": str(trip_id),
        "tagged_user_id": str(tagged_user_id),
        "status": TripTagStatus.PENDING.value,
        "initiated_by": user.id,
        "notification_id": None,
    }
    tag_rows = await db.post("trip_tags", tag_data)
    if not tag_rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create tag",
        )

    background_tasks.add_task(
        send_trip_tag_notification,
        trip_id=trip_id,
        trip_name=trip["name"],
        initiator_id=user.id,
        tagged_user_id=tagged_user_id,
    )

    return TripTag(**tag_rows[0])


@router.delete("/{trip_id}/tag", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
async def withdraw_trip_tag(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> None:
    """Withdraw the current user's own tag from a trip (tagged user only).

    Consent is revocable (plan Q3): the tagged user may remove their own tag
    at any status - decline handles the pending case, and this endpoint also
    covers tags that were already approved. Deleting the tag removes the trip
    from the tagged user's profile view and from the owner's tag list.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # The tagged user can SELECT their own tag under RLS; this both finds the
    # row and proves it belongs to the caller.
    tags = await db.get(
        "trip_tags",
        {
            "select": "id",
            "trip_id": f"eq.{trip_id}",
            "tagged_user_id": f"eq.{user.id}",
        },
    )
    if not tags:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tag not found",
        )

    # RLS only grants DELETE on trip_tags to the trip owner, so a JWT-scoped
    # delete by the tagged user would silently no-op. The SELECT above
    # authorized the withdrawal (the row is the caller's own tag); execute it
    # with the service client, still scoped to the caller's tagged_user_id.
    service_db = get_service_supabase_client()
    deleted = await service_db.delete(
        "trip_tags",
        {
            "id": f"eq.{tags[0]['id']}",
            "tagged_user_id": f"eq.{user.id}",
        },
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tag not found",
        )


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
