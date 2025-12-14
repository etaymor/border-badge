"""URL utilities shared across the backend."""

from urllib.parse import urlparse, urlunparse

ALLOWED_EXTERNAL_URL_SCHEMES = frozenset({"http", "https"})


def safe_external_url(url: str | None) -> str | None:
    """Validate and normalize external URLs before rendering them in templates.

    Only http/https schemes with a hostname are allowed. Returns None for unsafe inputs.
    """
    if not url:
        return None

    candidate = url.strip()
    if not candidate:
        return None

    parsed = urlparse(candidate)
    scheme = parsed.scheme.lower()

    if scheme not in ALLOWED_EXTERNAL_URL_SCHEMES:
        return None

    if not parsed.netloc:
        return None

    sanitized = parsed._replace(scheme=scheme)
    return urlunparse(sanitized)

