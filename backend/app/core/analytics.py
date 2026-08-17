"""Analytics event logging for public pages."""

import logging
import re

logger = logging.getLogger("analytics")

# Share attribution refs are usernames: 3-30 word characters. Anything else
# (injection attempts, junk) is dropped rather than logged.
_REF_PATTERN = re.compile(r"^[A-Za-z0-9_]{1,30}$")


def sanitize_ref(ref: str | None) -> str | None:
    """Return the ``?ref=`` attribution value if it looks like a username.

    Malformed refs return None so a bad query param never breaks page
    rendering or pollutes the analytics log.
    """
    if not ref:
        return None
    ref = ref.strip()
    return ref if _REF_PATTERN.match(ref) else None


def log_page_view(
    page_type: str, identifier: str | None = None, ref: str | None = None
) -> None:
    """Log a public page view event.

    Args:
        page_type: Type of page (landing, list, trip, profile, invite)
        identifier: Optional identifier (slug, username) for the page
        ref: Optional share-attribution referrer (already sanitized username)
    """
    parts = [f"page_view: {page_type}"]
    if identifier:
        parts.append(f"identifier={identifier}")
    if ref:
        parts.append(f"ref={ref}")
    logger.info(" ".join(parts))


def log_landing_viewed() -> None:
    """Log landing page view."""
    log_page_view("landing")


def log_list_viewed(slug: str, ref: str | None = None) -> None:
    """Log public list page view."""
    log_page_view("list", slug, ref=ref)


def log_trip_viewed(slug: str, ref: str | None = None) -> None:
    """Log public trip page view."""
    log_page_view("trip", slug, ref=ref)


def log_profile_viewed(username: str, ref: str | None = None) -> None:
    """Log public profile page view."""
    log_page_view("profile", username, ref=ref)


def log_invite_viewed(ref: str | None = None) -> None:
    """Log invite landing page view (the code itself is never logged)."""
    log_page_view("invite", ref=ref)
