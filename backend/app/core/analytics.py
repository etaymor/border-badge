"""Analytics event logging for public pages."""

import logging

logger = logging.getLogger("analytics")


def log_page_view(page_type: str, identifier: str | None = None) -> None:
    """Log a public page view event.

    Args:
        page_type: Type of page (landing, list, trip)
        identifier: Optional identifier (slug, id) for the page
    """
    if identifier:
        logger.info(f"page_view: {page_type} identifier={identifier}")
    else:
        logger.info(f"page_view: {page_type}")


def log_landing_viewed() -> None:
    """Log landing page view."""
    log_page_view("landing")


def log_list_viewed(slug: str) -> None:
    """Log public list page view."""
    log_page_view("list", slug)


def log_trip_viewed(slug: str) -> None:
    """Log public trip page view."""
    log_page_view("trip", slug)


def log_quiz_funnel_event(event: str, slug: str) -> None:
    """Log one public quiz funnel step (U12).

    Args:
        event: Funnel step (page_view, session_started, session_completed,
            install_cta_tap)
        slug: The quiz's share slug
    """
    logger.info(f"quiz_funnel: {event} slug={slug}")
