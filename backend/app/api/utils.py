"""Shared API utilities."""

from fastapi import Request


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_flag_emoji(country_code: str | None) -> str:
    """Convert country code to flag emoji."""
    if not country_code:
        return ""
    return "".join(chr(ord(c) + 127397) for c in country_code.upper())
