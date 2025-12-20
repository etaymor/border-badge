"""Skimlinks API client for affiliate link wrapping."""

import logging
import time
from datetime import UTC, datetime, timedelta

import httpx

from app.core.config import get_settings
from app.db.session import get_supabase_client
from app.schemas.affiliate import ResolutionPath, SkimlinksCacheEntry

logger = logging.getLogger(__name__)

# Skimlinks Link API endpoint
SKIMLINKS_API_URL = "https://api.skimlinks.com/link/api"

# Default cache TTL in hours
DEFAULT_CACHE_TTL_HOURS = 48

# API timeout in seconds
API_TIMEOUT_SECONDS = 3.0


def _build_subid(trip_id: str | None, entry_id: str | None) -> str:
    """Build Skimlinks subid for tracking.

    Format: trip_{trip_id}_entry_{entry_id}
    If either is None, use 'none' as placeholder.

    Args:
        trip_id: Optional trip UUID
        entry_id: Optional entry UUID

    Returns:
        Formatted subid string
    """
    trip_part = trip_id or "none"
    entry_part = entry_id or "none"
    return f"trip_{trip_part}_entry_{entry_part}"


def _is_configured() -> bool:
    """Check if Skimlinks credentials are configured."""
    settings = get_settings()
    return bool(settings.skimlinks_api_key and settings.skimlinks_publisher_id)


async def wrap_url(
    url: str,
    trip_id: str | None = None,
    entry_id: str | None = None,
) -> str | None:
    """Wrap a URL with Skimlinks affiliate tracking.

    Makes a request to the Skimlinks Link API to convert a regular URL
    into an affiliate-tracked URL. Returns None on any failure, allowing
    the caller to fall back to the original URL.

    Args:
        url: The destination URL to wrap
        trip_id: Optional trip UUID for subid tracking
        entry_id: Optional entry UUID for subid tracking

    Returns:
        Wrapped affiliate URL, or None if wrapping failed
    """
    if not _is_configured():
        logger.debug("skimlinks_not_configured: skipping URL wrap")
        return None

    settings = get_settings()
    subid = _build_subid(trip_id, entry_id)

    # Build API request parameters
    params = {
        "url": url,
        "apikey": settings.skimlinks_api_key,
        "publisher_id": settings.skimlinks_publisher_id,
        "xs": "1",  # Return short URL format
        "custom_id": subid,
    }

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.get(SKIMLINKS_API_URL, params=params)
            response.raise_for_status()

            elapsed_ms = (time.monotonic() - start_time) * 1000

            # Skimlinks returns the wrapped URL in the response body
            wrapped_url = response.text.strip()

            # Validate response - should be a valid URL
            if not wrapped_url.startswith("http"):
                logger.warning(
                    "skimlinks_invalid_response",
                    extra={
                        "event": "skimlinks_invalid_response",
                        "url": url[:200],
                        "response": wrapped_url[:100],
                        "elapsed_ms": round(elapsed_ms, 2),
                    },
                )
                return None

            logger.info(
                "skimlinks_wrap_success",
                extra={
                    "event": "skimlinks_wrap",
                    "url": url[:200],
                    "elapsed_ms": round(elapsed_ms, 2),
                    "subid": subid,
                },
            )

            return wrapped_url

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "skimlinks_timeout",
            extra={
                "event": "skimlinks_error",
                "error_type": "timeout",
                "url": url[:200],
                "elapsed_ms": round(elapsed_ms, 2),
                "timeout": API_TIMEOUT_SECONDS,
            },
        )
        return None

    except httpx.HTTPStatusError as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "skimlinks_http_error",
            extra={
                "event": "skimlinks_error",
                "error_type": "http_status",
                "url": url[:200],
                "status_code": e.response.status_code,
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None

    except httpx.RequestError as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "skimlinks_request_error",
            extra={
                "event": "skimlinks_error",
                "error_type": "request_error",
                "url": url[:200],
                "error": str(e)[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None


# =============================================================================
# Cache Functions
# =============================================================================


def _row_to_cache_entry(row: dict) -> SkimlinksCacheEntry:
    """Convert a database row to a SkimlinksCacheEntry model."""
    return SkimlinksCacheEntry(
        id=row["id"],
        original_url=row["original_url"],
        wrapped_url=row["wrapped_url"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
    )


async def get_cached_url(original_url: str) -> str | None:
    """Fetch a non-expired cached Skimlinks URL.

    Args:
        original_url: The original URL to look up

    Returns:
        Cached wrapped URL if found and not expired, None otherwise
    """
    db = get_supabase_client()

    now = datetime.now(UTC).isoformat()

    rows = await db.get(
        "skimlinks_cache",
        {
            "original_url": f"eq.{original_url}",
            "expires_at": f"gt.{now}",
            "select": "*",
        },
    )

    if not rows:
        return None

    logger.debug(f"skimlinks_cache_hit: url={original_url[:50]}")
    return rows[0]["wrapped_url"]


async def cache_url(
    original_url: str,
    wrapped_url: str,
    ttl_hours: int = DEFAULT_CACHE_TTL_HOURS,
) -> SkimlinksCacheEntry:
    """Cache a Skimlinks-wrapped URL.

    Uses upsert to handle both insert and update cases.

    Args:
        original_url: The original URL
        wrapped_url: The Skimlinks-wrapped URL
        ttl_hours: Cache TTL in hours (default 48)

    Returns:
        The created/updated cache entry
    """
    db = get_supabase_client()

    expires_at = datetime.now(UTC) + timedelta(hours=ttl_hours)

    # Use upsert with original_url as unique key
    rows = await db.upsert(
        "skimlinks_cache",
        [
            {
                "original_url": original_url,
                "wrapped_url": wrapped_url,
                "expires_at": expires_at.isoformat(),
            }
        ],
        on_conflict="original_url",
    )

    row = rows[0]
    logger.debug(
        f"skimlinks_cache_stored: url={original_url[:50]} ttl_hours={ttl_hours}"
    )

    return _row_to_cache_entry(row)


async def invalidate_cache(original_url: str) -> bool:
    """Invalidate (delete) a cached URL entry.

    Call this when the original URL changes to ensure fresh lookup.

    Args:
        original_url: The URL to invalidate

    Returns:
        True if an entry was deleted, False if not found
    """
    db = get_supabase_client()

    rows = await db.delete(
        "skimlinks_cache",
        {"original_url": f"eq.{original_url}"},
    )

    deleted = len(rows) > 0
    if deleted:
        logger.debug(f"skimlinks_cache_invalidated: url={original_url[:50]}")

    return deleted


async def cleanup_expired_cache() -> int:
    """Delete expired cache entries.

    This can be called periodically to clean up stale entries.

    Returns:
        Number of entries deleted
    """
    db = get_supabase_client()

    now = datetime.now(UTC).isoformat()

    rows = await db.delete(
        "skimlinks_cache",
        {"expires_at": f"lt.{now}"},
    )

    count = len(rows)
    if count > 0:
        logger.info(f"skimlinks_cache_cleanup: deleted={count}")

    return count


# =============================================================================
# High-Level Functions
# =============================================================================


async def wrap_url_with_cache(
    url: str,
    trip_id: str | None = None,
    entry_id: str | None = None,
    ttl_hours: int = DEFAULT_CACHE_TTL_HOURS,
) -> tuple[str | None, bool]:
    """Wrap a URL with caching support.

    Checks cache first, then calls API if needed, then caches result.

    Args:
        url: The destination URL to wrap
        trip_id: Optional trip UUID for subid tracking
        entry_id: Optional entry UUID for subid tracking
        ttl_hours: Cache TTL in hours

    Returns:
        Tuple of (wrapped_url, from_cache):
        - If cache hit: (cached_url, True)
        - If API success: (wrapped_url, False)
        - If failure: (None, False)
    """
    # Check cache first
    cached = await get_cached_url(url)
    if cached:
        return cached, True

    logger.debug(f"skimlinks_cache_miss: url={url[:50]}")

    # Call API
    wrapped = await wrap_url(url, trip_id, entry_id)
    if not wrapped:
        return None, False

    # Cache the result
    try:
        await cache_url(url, wrapped, ttl_hours)
    except Exception as e:
        # Log but don't fail - caching is best-effort
        logger.warning(f"skimlinks_cache_error: url={url[:50]} error={e}")

    return wrapped, False


async def resolve_with_skimlinks(
    destination_url: str,
    trip_id: str | None = None,
    entry_id: str | None = None,
) -> tuple[str, ResolutionPath]:
    """Resolve a URL through Skimlinks with fallback.

    Attempts to wrap the URL with Skimlinks. If Skimlinks is not configured
    or fails, returns the original URL with ORIGINAL resolution path.

    Args:
        destination_url: The original destination URL
        trip_id: Optional trip UUID for tracking
        entry_id: Optional entry UUID for tracking

    Returns:
        Tuple of (resolved_url, resolution_path)
    """
    if not _is_configured():
        return destination_url, ResolutionPath.ORIGINAL

    wrapped_url, from_cache = await wrap_url_with_cache(
        destination_url,
        trip_id=trip_id,
        entry_id=entry_id,
    )

    if wrapped_url:
        return wrapped_url, ResolutionPath.SKIMLINKS

    # Fallback to original URL
    return destination_url, ResolutionPath.ORIGINAL
