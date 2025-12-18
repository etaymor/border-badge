"""URL utilities shared across the backend."""

from urllib.parse import parse_qs, urlparse, urlunparse

ALLOWED_EXTERNAL_URL_SCHEMES = frozenset({"http", "https"})
MAX_URL_LENGTH = 2048
MAX_QUERY_PARAM_LENGTH = 1024
MAX_QUERY_PARAMS = 50

# Google Places Photo API domains (for SSRF protection)
GOOGLE_PHOTO_DOMAINS = frozenset(
    {
        "maps.googleapis.com",
        "lh3.googleusercontent.com",
        "geo0.ggpht.com",
        "geo1.ggpht.com",
        "geo2.ggpht.com",
        "geo3.ggpht.com",
    }
)


class URLValidationError(ValueError):
    """Raised when URL validation fails."""


def safe_external_url(url: str | None) -> str | None:
    """Validate and normalize external URLs before rendering them in templates.

    Only http/https schemes with a hostname are allowed. Returns None for unsafe inputs.

    Validation includes:
    - URL length limit (2048 chars max)
    - Scheme whitelist (http/https only)
    - Hostname presence required
    - Query parameter validation (length and count limits)
    """
    if not url:
        return None

    candidate = url.strip()
    if not candidate:
        return None

    # URL length validation to prevent DoS
    if len(candidate) > MAX_URL_LENGTH:
        return None

    parsed = urlparse(candidate)
    scheme = parsed.scheme.lower()

    if scheme not in ALLOWED_EXTERNAL_URL_SCHEMES:
        return None

    if not parsed.netloc:
        return None

    # Validate query parameters
    if parsed.query:
        if not _validate_query_params(parsed.query):
            return None

    # Use public API for replacement (ParseResult is a namedtuple)
    sanitized = parsed._replace(scheme=scheme)
    return urlunparse(sanitized)


def safe_google_photo_url(url: str | None) -> str | None:
    """Validate Google Places photo URLs with domain whitelist.

    Adds SSRF protection by ensuring URLs come from known Google photo
    serving domains. Uses safe_external_url() for base validation.

    Args:
        url: URL string to validate

    Returns:
        Validated URL or None if invalid
    """
    validated = safe_external_url(url)
    if not validated:
        return None

    parsed = urlparse(validated)
    if parsed.netloc not in GOOGLE_PHOTO_DOMAINS:
        return None

    return validated


def _validate_query_params(query_string: str) -> bool:
    """Validate query string parameters.

    Args:
        query_string: The query string portion of a URL (without leading '?')

    Returns:
        True if query params are valid, False otherwise.
    """
    try:
        params = parse_qs(query_string, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        # Malformed query string
        return False

    # Check number of parameters
    if len(params) > MAX_QUERY_PARAMS:
        return False

    # Check individual parameter lengths
    for key, values in params.items():
        if len(key) > MAX_QUERY_PARAM_LENGTH:
            return False
        for value in values:
            if len(value) > MAX_QUERY_PARAM_LENGTH:
                return False

    return True
