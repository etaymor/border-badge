"""Shared API utilities."""

from fastapi import Request

from app.db.session import DatabaseError


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def _error_text(error: Exception | str) -> str:
    """Classification text for a database error.

    DatabaseError's ``str()`` is the generic client-facing detail ("Database
    error"), so classification must read its server-side ``message`` field.
    """
    if isinstance(error, DatabaseError):
        return (error.message or "").lower()
    return str(error).lower()


def is_duplicate_key_error(error: Exception | str) -> bool:
    """True when a database error indicates a duplicate-key / unique-constraint
    violation (e.g. the row already exists).

    DatabaseError carries structured PostgREST fields: SQLSTATE 23505
    (unique_violation) or an HTTP 409 Conflict is authoritative. The substring
    fallback keeps non-DatabaseError exceptions (raw client errors, tests)
    classifiable.
    """
    if isinstance(error, DatabaseError) and (
        error.pg_code == "23505" or error.status_code == 409
    ):
        return True
    msg = _error_text(error)
    return "duplicate key" in msg or "unique" in msg


def is_block_violation_error(error: Exception | str) -> bool:
    """True when a database error came from a block-enforcement trigger
    (prevent_follow_when_blocked, prevent_trip_tag_when_blocked).

    The triggers RAISE EXCEPTION with messages naming the block ("Cannot
    follow a blocked user...", "Cannot tag a blocked user..."); the text
    survives on DatabaseError.message even though the client-facing detail
    is generic.
    """
    msg = _error_text(error)
    return "cannot follow" in msg or "cannot tag" in msg or "blocked" in msg


# Special flag mappings for non-standard country codes
SPECIAL_FLAGS: dict[str, str] = {
    # UK constituent countries (subdivision flags)
    "XS": "\U0001f3f4\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f",  # Scotland
    "XW": "\U0001f3f4\U000e0067\U000e0062\U000e0077\U000e006c\U000e0073\U000e007f",  # Wales
    "XI": "\U0001f1ec\U0001f1e7",  # Northern Ireland (use UK flag)
    # Special regions without standard flags
    "ZZ": "\U0001f1f9\U0001f1ff",  # Zanzibar (use Tanzania)
    "XN": "\U0001f1e8\U0001f1fe",  # Northern Cyprus (use Cyprus)
}


def get_flag_emoji(country_code: str | None) -> str:
    """Convert ISO 3166-1 alpha-2 country code to flag emoji.

    Handles standard codes and special cases like Scotland (XS),
    Wales (XW), Northern Ireland (XI), etc.

    Returns empty string for invalid codes or encoding errors.
    """
    if not country_code:
        return ""

    # Normalize and validate
    code = country_code.strip().upper()

    # Check for special flags first
    if code in SPECIAL_FLAGS:
        return SPECIAL_FLAGS[code]

    # Must be exactly 2 ASCII letters A-Z
    if len(code) != 2 or not code.isalpha() or not code.isascii():
        return ""

    # Convert to regional indicator symbols
    # Each letter A-Z maps to regional indicator symbols U+1F1E6 to U+1F1FF
    # The offset 127397 = 0x1F1E6 - ord('A') = 127462 - 65
    try:
        return "".join(chr(ord(c) + 127397) for c in code)
    except (ValueError, OverflowError):
        # Handle potential encoding issues gracefully
        return ""
