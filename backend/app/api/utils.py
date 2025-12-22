"""Shared API utilities."""

from typing import Any

from fastapi import Request


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def check_duplicate_place_in_entries(
    entries: list[dict[str, Any]], google_place_id: str
) -> bool:
    """Check if a place already exists in a list of entries.

    PostgREST behavior for embedded relationships:
    - One-to-one relationships (like entry->place) are returned as a single object
    - One-to-many relationships are returned as arrays
    - When using !inner join, entries without matching places are excluded

    This function handles both formats defensively for forward compatibility.

    Args:
        entries: List of entry dicts from PostgREST with embedded place data
        google_place_id: The Google Place ID to check for

    Returns:
        True if the place already exists in any entry
    """
    for entry in entries:
        place = entry.get("place")
        if place is None:
            continue

        # PostgREST returns one-to-one as object, but handle array defensively
        if isinstance(place, dict):
            if place.get("google_place_id") == google_place_id:
                return True
        elif isinstance(place, list) and len(place) > 0:
            # Handle array format (shouldn't happen with !inner, but be safe)
            if place[0].get("google_place_id") == google_place_id:
                return True

    return False


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
