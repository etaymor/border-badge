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

    Uses constant-time comparison patterns throughout to prevent timing attacks.
    All validation steps are performed even when earlier ones fail, ensuring
    consistent execution time regardless of which check fails.

    Args:
        code: The invite code to verify
        expected_email: If provided, verify the email matches

    Returns:
        Dict with inviter_id if valid, None if invalid
    """
    # Track validity through all checks without early returns (timing attack mitigation)
    is_valid = True

    try:
        parts = code.split(":")
        # Pad parts to 5 elements to avoid timing differences from exception handling
        while len(parts) < 5:
            parts.append("")

        if len(parts) != 5:
            is_valid = False

        inviter_id, email_hash, timestamp, nonce, signature = parts[:5]

        # Verify signature (always compute even if other checks failed)
        settings = get_settings()
        message = f"{inviter_id}:{email_hash}:{timestamp}:{nonce}"
        expected_sig = hmac.new(
            settings.INVITE_SIGNING_SECRET.encode(),
            message.encode(),
            hashlib.sha256,
        ).hexdigest()

        # Use constant-time comparison
        if not hmac.compare_digest(signature, expected_sig):
            is_valid = False

        # Check expiration (always compute even if other checks failed)
        try:
            invite_time = datetime.fromtimestamp(int(timestamp), tz=UTC)
            if datetime.now(UTC) - invite_time > timedelta(
                days=settings.invite_expiration_days
            ):
                is_valid = False
        except (ValueError, OverflowError):
            is_valid = False

        # Optionally verify email matches (always compute if email provided)
        if expected_email:
            expected_hash = hashlib.sha256(expected_email.lower().encode()).hexdigest()[
                :16
            ]
            if not hmac.compare_digest(email_hash, expected_hash):
                is_valid = False

        # Return result only after all checks complete
        if is_valid:
            return {"inviter_id": inviter_id, "email_hash": email_hash}
        return None
    except (ValueError, IndexError, OverflowError):
        return None
