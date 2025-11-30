"""Notification stub for trip tagging workflow.

This module provides a placeholder for notification functionality.
In future phases, this will integrate with push notifications and/or email.
"""

import logging
from uuid import UUID

logger = logging.getLogger(__name__)


async def send_trip_tag_notification(
    trip_id: UUID,
    trip_name: str,
    initiator_id: str,
    tagged_user_id: UUID,
) -> str | None:
    """
    Send a notification to a user when they are tagged in a trip.

    Currently logs the notification payload for future integration.

    Args:
        trip_id: The trip the user was tagged in
        trip_name: Name of the trip
        initiator_id: User who created the tag
        tagged_user_id: User being notified

    Returns:
        notification_id if sent, None if failed/disabled
    """
    # Log for now - will be replaced with actual push/email in future
    logger.info(
        "Trip tag notification",
        extra={
            "trip_id": str(trip_id),
            "trip_name": trip_name,
            "initiator_id": initiator_id,
            "tagged_user_id": str(tagged_user_id),
        },
    )

    # Return None for now - future implementation would return actual notification ID
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
