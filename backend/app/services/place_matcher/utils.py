"""Utility functions for place matching operations."""

import math
import re

from .constants import MAX_ADDRESS_LENGTH, MAX_PLACE_NAME_LENGTH


def sanitize_place_text(text: str, max_length: int) -> str:
    """
    Sanitize text from external API for safe display.

    Since this is rendered in React Native Text components (not HTML),
    we don't HTML-escape (which would show &amp; literally). We only:
    1. Remove control characters that could cause display issues
    2. Truncate unexpectedly long strings

    Args:
        text: Raw text from external API
        max_length: Maximum allowed length

    Returns:
        Sanitized text safe for display
    """
    if not text:
        return ""

    # Remove control characters (except common whitespace like space, tab, newline)
    sanitized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)

    # Truncate to max length
    if len(sanitized) > max_length:
        sanitized = sanitized[: max_length - 3] + "..."

    return sanitized.strip()


def sanitize_place_name(text: str) -> str:
    """Sanitize a place name for display."""
    return sanitize_place_text(text, MAX_PLACE_NAME_LENGTH)


def sanitize_address(text: str) -> str:
    """Sanitize an address for display."""
    return sanitize_place_text(text, MAX_ADDRESS_LENGTH)


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance in meters between two coordinates using Haversine formula.

    Args:
        lat1, lon1: First coordinate
        lat2, lon2: Second coordinate

    Returns:
        Distance in meters, or infinity if coordinates are invalid
    """
    # Validate coordinate bounds (defense in depth - Pydantic validates inputs
    # but this prevents nonsense results from edge cases or data corruption)
    if not (-90 <= lat1 <= 90 and -90 <= lat2 <= 90):
        return float("inf")
    if not (-180 <= lon1 <= 180 and -180 <= lon2 <= 180):
        return float("inf")

    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c
