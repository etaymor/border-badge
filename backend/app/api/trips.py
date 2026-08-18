"""Trip CRUD and sharing endpoints."""

import asyncio
import logging
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    HTTPException,
    Query,
    Request,
    status,
)

from app.api.trips_helpers import format_daterange, trip_from_row
from app.api.utils import get_token_from_request, is_block_violation_error
from app.core.config import get_settings
from app.core.media import build_media_url
from app.core.notifications import send_trip_tag_notification
from app.core.security import CurrentUser
from app.db.postgrest import in_list
from app.db.session import get_service_supabase_client, get_supabase_client
from app.main import limiter
from app.schemas.public import TripShareResponse
from app.schemas.trips import (
    Trip,
    TripCreate,
    TripTag,
    TripTagStatus,
    TripTagUser,
    TripUpdate,
    TripWithTags,
    UncategorizedTrip,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[TripWithTags])
async def list_trips(
    request: Request,
    user: CurrentUser,
    country_code: str | None = Query(None, description="Filter trips by country code"),
    include_system: bool = Query(
        False, description="Include system trips like Saved Places"
    ),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[TripWithTags]:
    """List all trips accessible to the current user (owned or approved tags).

    Optionally filter by country_code to get trips for a specific country.
    Returns trips with their tags and owner info for display.
    By default, system trips (Saved Places) are excluded.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # First query: Get trips without entries (avoid N+1 for fallback cover images)
    params: dict[str, str | int | bool] = {
        "select": "*, country:country_id(code), trip_tags(*)",
        "order": "created_at.desc",
        "limit": limit,
        "offset": offset,
        "deleted_at": "is.null",
    }

    # Filter out system trips by default
    if not include_system:
        params["is_system"] = "eq.false"

    if country_code:
        # Look up country UUID from code
        countries = await db.get("country", {"code": f"eq.{country_code}"})
        if countries:
            params["country_id"] = f"eq.{countries[0]['id']}"
        else:
            return []  # No matching country, return empty list
    rows = await db.get("trip", params)

    if not rows:
        return []

    # Collect trip IDs that need fallback cover images
    trips_needing_cover = [row["id"] for row in rows if not row.get("cover_image_url")]

    # Second query: Fetch exactly one media file per trip using DISTINCT ON
    fallback_covers: dict[str, str] = {}
    if trips_needing_cover:
        media_rows = await db.rpc(
            "get_first_media_per_trip",
            {"trip_ids": trips_needing_cover},
        )

        for media in media_rows or []:
            media_trip_id = media.get("trip_id")
            file_path = media.get("file_path")
            if media_trip_id and file_path:
                fallback_covers[media_trip_id] = build_media_url(file_path)

    # Collect all user IDs we need to fetch: owners + tagged users
    user_ids_to_fetch: set[str] = set()
    for row in rows:
        owner_id = row.get("user_id")
        if owner_id:
            user_ids_to_fetch.add(owner_id)
        tag_data = row.get("trip_tags")
        if tag_data and isinstance(tag_data, list):
            for tag in tag_data:
                user_ids_to_fetch.add(tag["tagged_user_id"])

    # Fetch all user profiles in one query
    user_profiles: dict[str, TripTagUser] = {}
    if user_ids_to_fetch:
        profiles = await db.get(
            "user_profile",
            {
                "select": "user_id,username,display_name,avatar_url",
                "user_id": in_list(list(user_ids_to_fetch)),
            },
        )
        if profiles:
            user_profiles = {
                p["user_id"]: TripTagUser(
                    user_id=p["user_id"],
                    username=p["username"],
                    display_name=p.get("display_name"),
                    avatar_url=p.get("avatar_url"),
                )
                for p in profiles
            }

    # Build trips with tags and owner info
    result: list[TripWithTags] = []
    for row in rows:
        country_code_val = (
            row.get("country", {}).get("code", "") if row.get("country") else ""
        )
        owner_id = row.get("user_id")
        owner = user_profiles.get(owner_id) if owner_id else None

        # Build tags with user profile info
        tags: list[TripTag] = []
        tag_data = row.pop("trip_tags", None)
        if tag_data and isinstance(tag_data, list):
            for tag in tag_data:
                user_profile = user_profiles.get(tag["tagged_user_id"])
                tags.append(TripTag(**tag, user=user_profile))

        # Determine cover image: use explicit cover, or fallback from second query
        cover_image_url = row.get("cover_image_url")
        if not cover_image_url:
            cover_image_url = fallback_covers.get(row["id"])

        trip_dict = {k: v for k, v in row.items() if k not in ("country", "trip_tags")}
        trip_dict["cover_image_url"] = cover_image_url

        trip = Trip(**trip_dict, country_code=country_code_val)
        result.append(TripWithTags(**trip.model_dump(), tags=tags, owner=owner))

    return result


@router.get("/uncategorized", response_model=UncategorizedTrip)
@limiter.limit("30/minute")
async def get_uncategorized_trip(
    request: Request,
    user: CurrentUser,
) -> UncategorizedTrip:
    """Get or create the user's uncategorized/Saved Places trip.

    This is a system trip with no country association, used as a holding area
    for entries when the user doesn't have a trip for the detected country.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Use RPC to atomically get or create the uncategorized trip
    result = await db.rpc("get_or_create_uncategorized_trip")

    if not result or len(result) == 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get or create uncategorized trip",
        )

    row = result[0]
    return UncategorizedTrip(
        id=row["id"],
        user_id=row["user_id"],
        country_id=row.get("country_id"),
        country_code=None,  # System trips have no country
        name=row["name"],
        cover_image_url=row.get("cover_image_url"),
        date_range=row.get("date_range"),
        is_system=row.get("is_system", True),
        created_at=row["created_at"],
        deleted_at=row.get("deleted_at"),
        entry_count=row.get("entry_count", 0),
    )


@router.post("", response_model=TripWithTags, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def create_trip(
    request: Request,
    data: TripCreate,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> TripWithTags:
    """Create a new trip.

    Optionally tag other users who will receive pending invitations. Tagged
    users must exist and must not have a block in either direction with the
    caller; invalid targets are skipped (the trip itself is still created).
    Notifications are sent as background tasks only after the tag insert
    succeeds.
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
        # Deduplicate and drop self-tags, preserving order. The self-filter can
        # empty the list (caller tagged only themselves); the guard below skips
        # the lookups too -- in_list() raises on an empty list, and the trip
        # row is already inserted, so a crash here would 500 a created trip.
        candidate_ids: list[str] = list(
            dict.fromkeys(
                tagged_id_str
                for tagged_id_str in map(str, data.tagged_user_ids)
                if tagged_id_str != str(user.id)
            )
        )

        existing_ids: set[str] = set()
        blocked_ids: set[str] = set()
        if candidate_ids:
            candidate_id_list = in_list(candidate_ids)

            # Target-existence check in one query
            existing_profiles = await db.get(
                "user_profile",
                {
                    "select": "user_id",
                    "user_id": candidate_id_list,
                },
            )
            existing_ids = {p["user_id"] for p in existing_profiles or []}

            # Bidirectional block check, batched: two user_block queries via
            # the service client (a JWT-scoped user_block query cannot see
            # "someone blocked me" rows under RLS). Nonexistent and blocked
            # targets are skipped, not errors: the trip itself is already
            # created, and skipping keeps blocks unobservable.
            service_db = get_service_supabase_client()
            blocks_out, blocks_in = await asyncio.gather(
                service_db.get(
                    "user_block",
                    {
                        "select": "blocked_id",
                        "blocker_id": f"eq.{user.id}",
                        "blocked_id": candidate_id_list,
                    },
                ),
                service_db.get(
                    "user_block",
                    {
                        "select": "blocker_id",
                        "blocked_id": f"eq.{user.id}",
                        "blocker_id": candidate_id_list,
                    },
                ),
            )
            blocked_ids = {row["blocked_id"] for row in blocks_out or []} | {
                row["blocker_id"] for row in blocks_in or []
            }

        taggable_ids: list[str] = [
            tagged_id_str
            for tagged_id_str in candidate_ids
            if tagged_id_str in existing_ids and tagged_id_str not in blocked_ids
        ]

        if taggable_ids:
            # Batch insert: one call for the whole tag list. Notifications go
            # out as background tasks only after the insert succeeds.
            tag_payloads = [
                {
                    "trip_id": str(trip.id),
                    "tagged_user_id": tagged_id_str,
                    "status": TripTagStatus.PENDING.value,
                    "initiated_by": user.id,
                    "notification_id": None,
                }
                for tagged_id_str in taggable_ids
            ]
            try:
                tag_rows = await db.post("trip_tags", tag_payloads)
            except Exception as e:
                if not is_block_violation_error(e):
                    raise
                # A block raced past the pre-check and the
                # enforce_no_trip_tag_when_blocked trigger rejected the
                # (all-or-nothing) batch. Same skip semantics as the
                # pre-check: retry per row, dropping only the blocked pairs.
                tag_rows = []
                for payload in tag_payloads:
                    try:
                        rows = await db.post("trip_tags", [payload])
                    except Exception as row_error:
                        if is_block_violation_error(row_error):
                            continue
                        raise
                    tag_rows.extend(rows or [])
            for tag_row in tag_rows or []:
                tags.append(TripTag(**tag_row))
                background_tasks.add_task(
                    send_trip_tag_notification,
                    trip_id=trip.id,
                    trip_name=trip.name,
                    initiator_id=user.id,
                    tagged_user_id=tag_row["tagged_user_id"],
                )

    return TripWithTags(**trip.model_dump(), tags=tags)


@router.get("/{trip_id}", response_model=TripWithTags)
async def get_trip(
    request: Request,
    trip_id: UUID,
    user: CurrentUser,
) -> TripWithTags:
    """Get trip details with tags, user profiles, and owner info."""
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
    owner_id = row.get("user_id")

    # Extract embedded trip_tags
    tag_data = row.pop("trip_tags", None)
    tags: list[TripTag] = []

    # Collect all user IDs we need to fetch: tagged users + owner
    user_ids_to_fetch: set[str] = set()
    if owner_id:
        user_ids_to_fetch.add(owner_id)

    if tag_data and isinstance(tag_data, list):
        for tag in tag_data:
            user_ids_to_fetch.add(tag["tagged_user_id"])

    # Fetch all user profiles in one query
    user_profiles: dict[str, TripTagUser] = {}
    if user_ids_to_fetch:
        profiles = await db.get(
            "user_profile",
            {
                "select": "user_id,username,display_name,avatar_url",
                "user_id": in_list(list(user_ids_to_fetch)),
            },
        )
        if profiles:
            user_profiles = {
                p["user_id"]: TripTagUser(
                    user_id=p["user_id"],
                    username=p["username"],
                    display_name=p.get("display_name"),
                    avatar_url=p.get("avatar_url"),
                )
                for p in profiles
            }

    # Build tags with user profile info
    if tag_data and isinstance(tag_data, list):
        for tag in tag_data:
            user_profile = user_profiles.get(tag["tagged_user_id"])
            tags.append(TripTag(**tag, user=user_profile))

    # Get owner profile
    owner = user_profiles.get(owner_id) if owner_id else None

    trip = Trip(
        **{k: v for k, v in row.items() if k != "country"}, country_code=country_code
    )

    return TripWithTags(**trip.model_dump(), tags=tags, owner=owner)


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

    # Resolve country_code -> country_id. Reject system trips and unknown codes.
    if "country_code" in update_data:
        new_country_code = update_data.pop("country_code")
        if not new_country_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="country_code cannot be empty",
            )
        existing_trip = await db.get(
            "trip", {"id": f"eq.{trip_id}", "select": "is_system"}
        )
        if not existing_trip:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found"
            )
        if existing_trip[0].get("is_system"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change country of a system trip",
            )
        countries = await db.get("country", {"code": f"eq.{new_country_code}"})
        if not countries:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Country not found: {new_country_code}",
            )
        update_data["country_id"] = str(countries[0]["id"])

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
