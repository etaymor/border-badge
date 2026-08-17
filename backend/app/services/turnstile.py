"""Cloudflare Turnstile verification service."""

import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile_token(token: str, remote_ip: str | None = None) -> bool:
    """Verify a Turnstile token with Cloudflare.

    Args:
        token: The turnstile response token from the client
        remote_ip: Optional client IP for additional verification

    Returns:
        True if verification successful, False otherwise
    """
    settings = get_settings()

    if not settings.turnstile_secret_key:
        logger.warning("Turnstile secret key not configured, skipping verification")
        return False

    payload = {
        "secret": settings.turnstile_secret_key,
        "response": token,
    }

    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                TURNSTILE_VERIFY_URL,
                data=payload,
                timeout=10.0,
            )
            response.raise_for_status()
            result = response.json()

            if result.get("success"):
                logger.info("Turnstile verification successful")
                return True
            else:
                error_codes = result.get("error-codes", [])
                logger.warning(
                    "Turnstile verification failed",
                    extra={"error_codes": error_codes},
                )
                return False

    except httpx.HTTPError as e:
        logger.error(f"Turnstile verification HTTP error: {e}")
        return False
    except Exception as e:
        logger.error(f"Turnstile verification error: {e}")
        return False
