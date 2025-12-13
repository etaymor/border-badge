"""Shared API utilities."""

from fastapi import Request


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


# Special flag mappings for non-standard country codes
SPECIAL_FLAGS: dict[str, str] = {
    # UK constituent countries (subdivision flags)
    "XS": "\U0001f3f4\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f",  # Scotland
    "XW": "\U0001f3f4\U000e0067\U000e0062\U000e0077\U000e006c\U000e0073\U000e007f",  # Wales
    "XI": "\U0001f1ec\U0001f1e7",  # Northern Ireland (use UK flag)
    # Special regions without standard flags
    "ZZ": "\U0001f1f9\U0001f1ff",  # Zanzibar (use Tanzania)
    "NC": "\U0001f1e8\U0001f1fe",  # Northern Cyprus (use Cyprus)
}


def get_flag_emoji(country_code: str | None) -> str:
    """Convert ISO 3166-1 alpha-2 country code to flag emoji.

    Handles standard codes and special cases like Scotland (XS),
    Wales (XW), Northern Ireland (XI), etc.

    Returns empty string for invalid codes.
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
    return "".join(chr(ord(c) + 127397) for c in code)
