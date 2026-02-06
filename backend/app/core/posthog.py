"""PostHog analytics client for backend event tracking.

Provides a singleton PostHog client that batches events in a background thread.
Events are fire-and-forget -- capture() returns immediately.

Usage:
    from app.core.posthog import capture_event

    capture_event(
        "llm_extraction_completed",
        distinct_id=user_id,
        properties={"places_resolved": 3, "method": "llm"},
    )

The client is automatically shut down during application shutdown via the
lifespan handler in main.py.
"""

import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_posthog_client = None


def _get_posthog_client():
    """Get or create the shared PostHog client.

    Returns None if PostHog is not configured (no API key).
    """
    global _posthog_client
    settings = get_settings()

    if not settings.posthog_configured:
        return None

    if _posthog_client is None:
        from posthog import Posthog

        _posthog_client = Posthog(
            project_api_key=settings.posthog_api_key,
            host=settings.posthog_host,
            debug=settings.debug,
            on_error=lambda e: logger.warning("posthog_error: %s", e),
        )

    return _posthog_client


def capture_event(
    event: str,
    *,
    distinct_id: str | None = None,
    properties: dict | None = None,
) -> None:
    """Capture an analytics event to PostHog (fire-and-forget).

    Args:
        event: Event name (e.g., "llm_extraction_completed")
        distinct_id: User ID or fallback identifier.
            If None, uses "backend_system".
        properties: Optional event properties dict.
    """
    client = _get_posthog_client()
    if client is None:
        return

    try:
        client.capture(
            distinct_id=distinct_id or "backend_system",
            event=event,
            properties=properties or {},
        )
    except Exception as e:
        logger.debug("posthog_capture_failed: %s", e)


def shutdown_posthog() -> None:
    """Flush pending events and shut down the PostHog client.

    Called during application shutdown via lifespan handler.
    """
    global _posthog_client
    if _posthog_client is not None:
        try:
            _posthog_client.shutdown()
        except Exception as e:
            logger.warning("posthog_shutdown_error: %s", e)
        _posthog_client = None
