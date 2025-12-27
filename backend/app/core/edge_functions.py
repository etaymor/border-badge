"""Helper functions to call Supabase Edge Functions."""

import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def call_edge_function(
    function_name: str,
    payload: dict,
    timeout: float = 10.0,
) -> dict | None:
    """
    Call a Supabase Edge Function.

    Args:
        function_name: Name of the edge function (e.g., 'send-push-notification')
        payload: JSON payload to send
        timeout: Request timeout in seconds

    Returns:
        Response JSON or None if request failed
    """
    settings = get_settings()

    if not settings.supabase_url or not settings.supabase_anon_key:
        return None

    url = f"{settings.supabase_url}/functions/v1/{function_name}"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.supabase_anon_key}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        # Log error but don't raise - edge functions are best effort
        logger.warning(
            f"Edge function '{function_name}' call failed",
            extra={
                "function_name": function_name,
                "error_type": type(e).__name__,
                "error_message": str(e),
            },
            exc_info=True,
        )
        return None


async def send_push_notification(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
) -> dict | None:
    """
    Send push notification via Edge Function.

    Args:
        tokens: List of Expo push tokens
        title: Notification title
        body: Notification body text
        data: Optional data payload for deep linking

    Returns:
        Response from Edge Function or None if failed
    """
    if not tokens:
        return None

    return await call_edge_function(
        "send-push-notification",
        {
            "tokens": tokens,
            "title": title,
            "body": body,
            "data": data,
        },
    )


async def send_invite_email(
    email: str,
    inviter_name: str,
    invite_code: str,
    invite_type: str = "follow",
) -> dict | None:
    """
    Send invite email via Edge Function.

    Args:
        email: Recipient email
        inviter_name: Name of the person sending the invite
        invite_code: HMAC-signed invite code
        invite_type: 'follow' or 'trip_tag'

    Returns:
        Response from Edge Function or None if failed
    """
    return await call_edge_function(
        "send-invite-email",
        {
            "email": email,
            "inviter_name": inviter_name,
            "invite_code": invite_code,
            "invite_type": invite_type,
        },
    )
