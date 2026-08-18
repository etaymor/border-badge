"""Notifications for the trip tagging workflow."""

import logging
from uuid import UUID

from app.core.edge_functions import send_push_notification
from app.db.session import SupabaseClient, get_service_supabase_client

logger = logging.getLogger(__name__)


async def get_user_push_tokens(db: SupabaseClient, user_id: UUID | str) -> list[str]:
    """Fetch ALL of a user's device push tokens (multi-device).

    push_token holds one row per device. Requires a service-role client:
    reading another user's tokens is a cross-user read that RLS would
    otherwise deny.
    """
    rows = await db.get(
        "push_token",
        {
            "select": "token",
            "user_id": f"eq.{user_id}",
        },
    )
    return [row["token"] for row in rows or [] if row.get("token")]


def profile_display_name(profile: dict) -> str:
    """Best display name for notification copy: display_name, then username,
    then the "Someone" fallback."""
    return profile.get("display_name") or profile.get("username") or "Someone"


async def send_trip_tag_notification(
    trip_id: UUID,
    trip_name: str,
    initiator_id: str,
    tagged_user_id: UUID,
) -> str | None:
    """
    Send the "you were tagged" push to the tagged user.

    Scheduled as a BackgroundTask strictly AFTER the tag insert succeeds,
    and only on paths that already passed the bidirectional block check
    -- so a failed insert or a blocked pair never produces a push,
    and each created tag pushes exactly once.

    Fetches ALL of the tagged user's device tokens (multi-device)
    via the service role: a cross-user read that RLS would otherwise deny.

    Best effort: any failure is logged and swallowed -- a push must never
    fail or delay the request that scheduled it.

    Args:
        trip_id: The trip the user was tagged in
        trip_name: Name of the trip
        initiator_id: User who created the tag
        tagged_user_id: User being notified

    Returns:
        None (kept for signature compatibility with notification_id plans)
    """
    try:
        db = get_service_supabase_client()

        tokens = await get_user_push_tokens(db, tagged_user_id)
        if not tokens:
            return None

        initiator_profile = await db.get(
            "user_profile",
            {
                "select": "username,display_name",
                "user_id": f"eq.{initiator_id}",
            },
        )
        initiator_name = "Someone"
        initiator_username = ""
        if initiator_profile:
            initiator_name = profile_display_name(initiator_profile[0])
            initiator_username = initiator_profile[0].get("username") or ""

        await send_push_notification(
            tokens=tokens,
            title="You Were Tagged",
            body=f"{initiator_name} tagged you on the trip {trip_name}",
            data={
                # The tag is pending, so the trip itself is not yet visible
                # to the tagged user under RLS; deep link to the initiator's
                # profile instead (a screen the app already handles).
                "screen": "UserProfile",
                "userId": str(initiator_id),
                "username": initiator_username,
                "tripId": str(trip_id),
            },
        )
    except Exception as e:
        logger.warning(f"Failed to send trip tag push: {e}", exc_info=True)

    return None


async def send_tag_response_notification(
    trip_id: UUID,
    trip_name: str,
    responder_id: str,
    owner_id: UUID,
    response: str,
) -> str | None:
    """
    Send a notification to trip owner when someone responds to their tag.

    Args:
        trip_id: The trip
        trip_name: Name of the trip
        responder_id: User who approved/declined
        owner_id: Trip owner to notify
        response: 'approved' or 'declined'

    Returns:
        notification_id if sent, None if failed/disabled
    """
    logger.info(
        "Tag response notification",
        extra={
            "trip_id": str(trip_id),
            "trip_name": trip_name,
            "responder_id": responder_id,
            "owner_id": str(owner_id),
            "response": response,
        },
    )

    return None
