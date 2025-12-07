"""Reusable validation utilities."""

from urllib.parse import urlparse

ALLOWED_IMAGE_SCHEMES = {"https"}


def validate_image_url(url: str | None) -> str | None:
    """Validate that URL is safe for use in img src attributes.

    Args:
        url: The URL to validate, or None.

    Returns:
        The validated URL if valid, None if input was None.

    Raises:
        ValueError: If the URL is invalid or uses a disallowed scheme.
    """
    if url is None:
        return None

    parsed = urlparse(url)

    # Require https scheme
    if parsed.scheme.lower() not in ALLOWED_IMAGE_SCHEMES:
        raise ValueError("Image URL must use https protocol")

    # Require valid host
    if not parsed.netloc:
        raise ValueError("Image URL must have a valid host")

    # Limit length to prevent DoS
    if len(url) > 2048:
        raise ValueError("Image URL too long (max 2048 characters)")

    return url
