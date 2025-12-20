"""oEmbed adapters for TikTok and Instagram with caching."""

import logging
import re
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings
from app.db.session import get_supabase_client
from app.schemas.social_ingest import OEmbedCacheEntry, OEmbedResponse, SocialProvider

logger = logging.getLogger(__name__)

# API endpoints
TIKTOK_OEMBED_URL = "https://www.tiktok.com/oembed"
INSTAGRAM_OEMBED_URL = "https://graph.facebook.com/v21.0/instagram_oembed"

# Timeouts and TTLs
API_TIMEOUT_SECONDS = 5.0
DEFAULT_CACHE_TTL_HOURS = 24

# User agent for requests
USER_AGENT = "Atlasi/1.0 (Social Ingest Service)"


# =============================================================================
# Cache Functions
# =============================================================================


def _row_to_cache_entry(row: dict) -> OEmbedCacheEntry:
    """Convert a database row to an OEmbedCacheEntry model."""
    return OEmbedCacheEntry(
        id=row["id"],
        canonical_url=row["canonical_url"],
        provider=SocialProvider(row["provider"]),
        response=row["response"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
    )


async def get_cached_oembed(canonical_url: str) -> OEmbedResponse | None:
    """Fetch a non-expired cached oEmbed response.

    Args:
        canonical_url: The canonical URL to look up

    Returns:
        Cached oEmbed response if found and not expired, None otherwise
    """
    db = get_supabase_client()

    now = datetime.now(UTC).isoformat()

    rows = await db.get(
        "oembed_cache",
        {
            "canonical_url": f"eq.{canonical_url}",
            "expires_at": f"gt.{now}",
            "select": "*",
        },
    )

    if not rows:
        return None

    logger.debug(f"oembed_cache_hit: url={canonical_url[:50]}")
    response_data = rows[0]["response"]

    return OEmbedResponse(
        title=response_data.get("title"),
        author_name=response_data.get("author_name"),
        author_url=response_data.get("author_url"),
        thumbnail_url=response_data.get("thumbnail_url"),
        thumbnail_width=response_data.get("thumbnail_width"),
        thumbnail_height=response_data.get("thumbnail_height"),
        html=response_data.get("html"),
        provider_name=response_data.get("provider_name"),
        provider_url=response_data.get("provider_url"),
        raw=response_data,
    )


async def cache_oembed(
    canonical_url: str,
    provider: SocialProvider,
    response: dict,
    ttl_hours: int = DEFAULT_CACHE_TTL_HOURS,
) -> OEmbedCacheEntry:
    """Cache an oEmbed response.

    Uses upsert to handle both insert and update cases.

    Args:
        canonical_url: The canonical URL
        provider: The social provider
        response: The oEmbed response data
        ttl_hours: Cache TTL in hours (default 24)

    Returns:
        The created/updated cache entry
    """
    db = get_supabase_client()

    expires_at = datetime.now(UTC) + timedelta(hours=ttl_hours)

    # Use upsert with canonical_url as unique key
    rows = await db.upsert(
        "oembed_cache",
        [
            {
                "canonical_url": canonical_url,
                "provider": provider.value,
                "response": response,
                "expires_at": expires_at.isoformat(),
            }
        ],
        on_conflict="canonical_url",
    )

    row = rows[0]
    logger.debug(
        f"oembed_cache_stored: url={canonical_url[:50]} provider={provider.value} ttl_hours={ttl_hours}"
    )

    return _row_to_cache_entry(row)


async def cleanup_expired_cache() -> int:
    """Delete expired cache entries.

    Returns:
        Number of entries deleted
    """
    db = get_supabase_client()

    now = datetime.now(UTC).isoformat()

    rows = await db.delete(
        "oembed_cache",
        {"expires_at": f"lt.{now}"},
    )

    count = len(rows)
    if count > 0:
        logger.info(f"oembed_cache_cleanup: deleted={count}")

    return count


# =============================================================================
# TikTok oEmbed Adapter
# =============================================================================


async def fetch_tiktok_oembed(url: str) -> OEmbedResponse | None:
    """Fetch oEmbed data from TikTok.

    TikTok's oEmbed endpoint is public and doesn't require authentication.

    Args:
        url: The TikTok video URL

    Returns:
        OEmbedResponse or None on failure
    """
    params = {"url": url}
    api_url = f"{TIKTOK_OEMBED_URL}?{urlencode(params)}"

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.get(
                api_url,
                headers={"User-Agent": USER_AGENT},
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code != 200:
                logger.warning(
                    "tiktok_oembed_error",
                    extra={
                        "event": "oembed_error",
                        "provider": "tiktok",
                        "url": url[:200],
                        "status_code": response.status_code,
                        "elapsed_ms": round(elapsed_ms, 2),
                    },
                )
                return None

            data = response.json()

            logger.info(
                "tiktok_oembed_success",
                extra={
                    "event": "oembed_fetch",
                    "provider": "tiktok",
                    "url": url[:200],
                    "has_thumbnail": bool(data.get("thumbnail_url")),
                    "elapsed_ms": round(elapsed_ms, 2),
                },
            )

            return OEmbedResponse(
                title=data.get("title"),
                author_name=data.get("author_name"),
                author_url=data.get("author_url"),
                thumbnail_url=data.get("thumbnail_url"),
                thumbnail_width=data.get("thumbnail_width"),
                thumbnail_height=data.get("thumbnail_height"),
                html=data.get("html"),
                provider_name=data.get("provider_name"),
                provider_url=data.get("provider_url"),
                raw=data,
            )

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "tiktok_oembed_timeout",
            extra={
                "event": "oembed_error",
                "provider": "tiktok",
                "error_type": "timeout",
                "url": url[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None

    except (httpx.RequestError, ValueError) as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "tiktok_oembed_error",
            extra={
                "event": "oembed_error",
                "provider": "tiktok",
                "error_type": type(e).__name__,
                "url": url[:200],
                "error": str(e)[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None


# =============================================================================
# Instagram oEmbed Adapter
# =============================================================================


def _is_instagram_configured() -> bool:
    """Check if Instagram oEmbed credentials are configured."""
    settings = get_settings()
    return bool(settings.instagram_oembed_token)


async def fetch_instagram_oembed(url: str) -> OEmbedResponse | None:
    """Fetch oEmbed data from Instagram via Meta Graph API.

    Requires a Meta app access token configured via INSTAGRAM_OEMBED_TOKEN.

    Args:
        url: The Instagram post/reel URL

    Returns:
        OEmbedResponse or None on failure
    """
    if not _is_instagram_configured():
        logger.debug("instagram_oembed_not_configured: skipping fetch")
        return None

    settings = get_settings()
    params = {
        "url": url,
        "access_token": settings.instagram_oembed_token,
        "omitscript": "true",  # Don't include embed.js script
    }

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.get(
                INSTAGRAM_OEMBED_URL,
                params=params,
                headers={"User-Agent": USER_AGENT},
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code != 200:
                logger.warning(
                    "instagram_oembed_error",
                    extra={
                        "event": "oembed_error",
                        "provider": "instagram",
                        "url": url[:200],
                        "status_code": response.status_code,
                        "elapsed_ms": round(elapsed_ms, 2),
                    },
                )
                return None

            data = response.json()

            logger.info(
                "instagram_oembed_success",
                extra={
                    "event": "oembed_fetch",
                    "provider": "instagram",
                    "url": url[:200],
                    "has_thumbnail": bool(data.get("thumbnail_url")),
                    "elapsed_ms": round(elapsed_ms, 2),
                },
            )

            return OEmbedResponse(
                title=data.get("title"),
                author_name=data.get("author_name"),
                author_url=data.get("author_url"),
                thumbnail_url=data.get("thumbnail_url"),
                thumbnail_width=data.get("thumbnail_width"),
                thumbnail_height=data.get("thumbnail_height"),
                html=data.get("html"),
                provider_name=data.get("provider_name"),
                provider_url=data.get("provider_url"),
                raw=data,
            )

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "instagram_oembed_timeout",
            extra={
                "event": "oembed_error",
                "provider": "instagram",
                "error_type": "timeout",
                "url": url[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None

    except (httpx.RequestError, ValueError) as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "instagram_oembed_error",
            extra={
                "event": "oembed_error",
                "provider": "instagram",
                "error_type": type(e).__name__,
                "url": url[:200],
                "error": str(e)[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None


# =============================================================================
# OpenGraph Fallback
# =============================================================================


async def fetch_opengraph_fallback(url: str) -> OEmbedResponse | None:
    """Fetch OpenGraph metadata as fallback when oEmbed fails.

    Parses basic og:title, og:image, etc. from the page HTML.

    Args:
        url: The page URL

    Returns:
        OEmbedResponse with available metadata, or None on failure
    """
    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(
            timeout=API_TIMEOUT_SECONDS,
            follow_redirects=True,
            max_redirects=3,
        ) as client:
            response = await client.get(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html",
                },
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code != 200:
                logger.debug(f"opengraph_fallback_error: status={response.status_code}")
                return None

            html = response.text

            # Extract OpenGraph metadata using regex (avoid heavy HTML parsing)
            og_title = _extract_meta_content(html, "og:title")
            og_image = _extract_meta_content(html, "og:image")
            og_description = _extract_meta_content(html, "og:description")
            og_site_name = _extract_meta_content(html, "og:site_name")

            if not og_title and not og_image:
                return None

            logger.info(
                "opengraph_fallback_success",
                extra={
                    "event": "oembed_fallback",
                    "url": url[:200],
                    "has_title": bool(og_title),
                    "has_image": bool(og_image),
                    "elapsed_ms": round(elapsed_ms, 2),
                },
            )

            return OEmbedResponse(
                title=og_title or og_description,
                thumbnail_url=og_image,
                provider_name=og_site_name,
                raw={
                    "og:title": og_title,
                    "og:image": og_image,
                    "og:description": og_description,
                    "og:site_name": og_site_name,
                    "source": "opengraph_fallback",
                },
            )

    except Exception as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.debug(
            f"opengraph_fallback_error: url={url[:50]} error={str(e)[:100]} elapsed_ms={round(elapsed_ms, 2)}"
        )
        return None


def _extract_meta_content(html: str, property_name: str) -> str | None:
    """Extract content from an OpenGraph meta tag.

    Args:
        html: The HTML content
        property_name: The og: property name (e.g., "og:title")

    Returns:
        The content value, or None if not found
    """
    # Match <meta property="og:title" content="..." /> or <meta content="..." property="og:title" />
    patterns = [
        rf'<meta[^>]*property=["\']?{re.escape(property_name)}["\']?[^>]*content=["\']([^"\']+)["\']',
        rf'<meta[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']?{re.escape(property_name)}["\']?',
    ]

    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


# =============================================================================
# High-Level Functions
# =============================================================================


async def fetch_oembed(
    url: str,
    provider: SocialProvider,
    use_cache: bool = True,
) -> OEmbedResponse | None:
    """Fetch oEmbed data for a URL with caching.

    Checks cache first, then calls the appropriate provider API,
    then falls back to OpenGraph if needed.

    Args:
        url: The canonical URL
        provider: The detected social provider
        use_cache: Whether to use caching (default True)

    Returns:
        OEmbedResponse or None on failure
    """
    # Check cache first
    if use_cache:
        cached = await get_cached_oembed(url)
        if cached:
            return cached

    logger.debug(f"oembed_cache_miss: url={url[:50]}")

    # Fetch from provider
    oembed: OEmbedResponse | None = None

    if provider == SocialProvider.TIKTOK:
        oembed = await fetch_tiktok_oembed(url)
    elif provider == SocialProvider.INSTAGRAM:
        oembed = await fetch_instagram_oembed(url)
        # Fall back to OpenGraph if Instagram oEmbed not configured or fails
        if not oembed:
            oembed = await fetch_opengraph_fallback(url)

    # Cache the result if successful
    if oembed and use_cache:
        try:
            await cache_oembed(url, provider, oembed.raw)
        except Exception as e:
            # Log but don't fail - caching is best-effort
            logger.warning(f"oembed_cache_error: url={url[:50]} error={e}")

    return oembed
