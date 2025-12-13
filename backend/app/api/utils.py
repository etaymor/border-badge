"""Shared API utilities."""

from fastapi import Request


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_flag_emoji(country_code: str | None) -> str:
    """Convert ISO 3166-1 alpha-2 country code to flag emoji.

    Returns empty string for invalid or non-standard codes.
    """
    if not country_code:
        return ""

    # Normalize and validate
    code = country_code.strip().upper()

    # Must be exactly 2 ASCII letters A-Z
    if len(code) != 2 or not code.isalpha() or not code.isascii():
        return ""

    # Convert to regional indicator symbols
    return "".join(chr(ord(c) + 127397) for c in code)
