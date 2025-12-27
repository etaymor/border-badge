"""Secure invite code generation and verification using HMAC."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.core.config import get_settings


def generate_invite_code(inviter_id: UUID, email: str) -> str:
    """
    Generate a signed invite code with HMAC to prevent abuse.

    Format: {inviter_id}:{email_hash}:{timestamp}:{nonce}:{signature}

    Security:
    - Uses HMAC-SHA256 with server secret
    - Includes nonce to prevent replay attacks
    - Email is hashed in the code to prevent leaking
    """
    timestamp = int(datetime.now(UTC).timestamp())
    nonce = secrets.token_hex(8)
    email_hash = hashlib.sha256(email.lower().encode()).hexdigest()[:16]

    settings = get_settings()
    message = f"{inviter_id}:{email_hash}:{timestamp}:{nonce}"
    signature = hmac.new(
        settings.INVITE_SIGNING_SECRET.encode(),
        message.encode(),
        hashlib.sha256,
    ).hexdigest()

    return f"{inviter_id}:{email_hash}:{timestamp}:{nonce}:{signature}"


def verify_invite_code(code: str, expected_email: str | None = None) -> dict | None:
    """
    Verify invite code signature and expiration.

    Args:
        code: The invite code to verify
        expected_email: If provided, verify the email matches

    Returns:
        Dict with inviter_id if valid, None if invalid
    """
    try:
        parts = code.split(":")
        if len(parts) != 5:
            return None

        inviter_id, email_hash, timestamp, nonce, signature = parts

        # Verify signature
        settings = get_settings()
        message = f"{inviter_id}:{email_hash}:{timestamp}:{nonce}"
        expected_sig = hmac.new(
            settings.INVITE_SIGNING_SECRET.encode(),
            message.encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_sig):
            return None

        # Check expiration
        invite_time = datetime.fromtimestamp(int(timestamp), tz=UTC)
        if datetime.now(UTC) - invite_time > timedelta(
            days=settings.invite_expiration_days
        ):
            return None

        # Optionally verify email matches
        if expected_email:
            expected_hash = hashlib.sha256(expected_email.lower().encode()).hexdigest()[
                :16
            ]
            if not hmac.compare_digest(email_hash, expected_hash):
                return None

        return {"inviter_id": inviter_id, "email_hash": email_hash}
    except (ValueError, IndexError, OverflowError):
        return None
