"""URL canonicalization and provider detection for social media links."""

import asyncio
import ipaddress
import logging
import re
import socket
import time
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx

from app.schemas.social_ingest import SocialProvider

logger = logging.getLogger(__name__)

# Blocked hostnames for SSRF protection
BLOCKED_HOSTNAMES = {
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
}


def _is_trusted_domain(hostname: str) -> bool:
    """Check if a hostname is in the trusted domains list.

    Args:
        hostname: The hostname to check

    Returns:
        True if the hostname is trusted for redirect following
    """
    if not hostname:
        return False
    hostname_lower = hostname.lower()
    # Check exact match or if it's a subdomain of a trusted domain
    for domain in TRUSTED_DOMAINS:
        if hostname_lower == domain or hostname_lower.endswith(f".{domain}"):
            return True
    return False


def _is_private_ip_sync(hostname: str) -> bool:
    """Synchronous check if a hostname resolves to a private/internal IP address.

    This is a blocking call - use _is_private_ip for async contexts.
    """
    # Check explicit blocklist
    if hostname.lower() in BLOCKED_HOSTNAMES:
        return True

    try:
        # Try to parse as IP address directly
        ip = ipaddress.ip_address(hostname)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        pass

    try:
        # Resolve hostname to IP
        resolved = socket.gethostbyname(hostname)
        ip = ipaddress.ip_address(resolved)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except (socket.gaierror, ValueError):
        # Can't resolve - allow the request but log it
        logger.debug(f"ssrf_check_failed: could not resolve hostname {hostname}")
        return False


# DNS resolution timeout in seconds
DNS_TIMEOUT_SECONDS = 3.0


async def _is_private_ip(hostname: str) -> bool:
    """Check if a hostname resolves to a private/internal IP address.

    Protects against SSRF attacks targeting internal services.
    Uses asyncio.to_thread to avoid blocking the event loop during DNS resolution.

    Args:
        hostname: The hostname to check

    Returns:
        True if the hostname is blocked or resolves to a private IP
    """
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_is_private_ip_sync, hostname),
            timeout=DNS_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        logger.warning(f"ssrf_dns_timeout: hostname={hostname}")
        # Fail closed on timeout - treat as blocked for security
        return True


# Timeout for redirect resolution
REDIRECT_TIMEOUT_SECONDS = 5.0

# Maximum URL length (matches SocialIngestRequest validation)
MAX_URL_LENGTH = 2048

# Trusted domains for redirect validation
# Only redirects to these domains are allowed after following redirects
TRUSTED_DOMAINS = {
    # TikTok
    "tiktok.com",
    "www.tiktok.com",
    "vm.tiktok.com",
    "m.tiktok.com",
    # Instagram
    "instagram.com",
    "www.instagram.com",
    "l.instagram.com",
}

# URL patterns for provider detection
TIKTOK_PATTERNS = [
    re.compile(r"^(?:www\.)?tiktok\.com/@[\w.-]+/video/\d+", re.IGNORECASE),
    re.compile(r"^(?:www\.)?tiktok\.com/t/[\w]+", re.IGNORECASE),
    re.compile(r"^vm\.tiktok\.com/[\w]+", re.IGNORECASE),
    re.compile(r"^(?:www\.)?tiktok\.com/@[\w.-]+/photo/\d+", re.IGNORECASE),
]

INSTAGRAM_PATTERNS = [
    re.compile(r"^(?:www\.)?instagram\.com/p/[\w-]+", re.IGNORECASE),
    re.compile(r"^(?:www\.)?instagram\.com/reel/[\w-]+", re.IGNORECASE),
    re.compile(r"^(?:www\.)?instagram\.com/reels/[\w-]+", re.IGNORECASE),
    re.compile(r"^(?:www\.)?instagram\.com/tv/[\w-]+", re.IGNORECASE),
]

# Tracking parameters to strip from URLs
TRACKING_PARAMS = {
    # TikTok
    "_t",
    "_r",
    "is_copy_url",
    "is_from_webapp",
    "sender_device",
    "sender_web_id",
    "share_app_id",
    "share_item_id",
    "share_link_id",
    "social_sharing",
    "source",
    "timestamp",
    "u_code",
    "user_id",
    # Instagram
    "igshid",
    "igsh",
    "img_index",
    # Common tracking
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
    "ref",
    "ref_src",
    "ref_url",
}


def detect_provider(url: str) -> SocialProvider | None:
    """Detect the social media provider from a URL.

    Args:
        url: The URL to analyze

    Returns:
        The detected provider, or None if not recognized
    """
    parsed = urlparse(url)
    host_path = f"{parsed.netloc}{parsed.path}"

    for pattern in TIKTOK_PATTERNS:
        if pattern.match(host_path):
            return SocialProvider.TIKTOK

    for pattern in INSTAGRAM_PATTERNS:
        if pattern.match(host_path):
            return SocialProvider.INSTAGRAM

    return None


def normalize_url(url: str) -> str:
    """Normalize a URL by removing tracking parameters and standardizing format.

    Args:
        url: The URL to normalize

    Returns:
        Normalized URL
    """
    parsed = urlparse(url)

    # Parse query parameters and filter out tracking params
    query_params = parse_qs(parsed.query, keep_blank_values=False)
    filtered_params = {
        k: v for k, v in query_params.items() if k.lower() not in TRACKING_PARAMS
    }

    # Rebuild query string (sorted for consistency)
    new_query = urlencode(filtered_params, doseq=True) if filtered_params else ""

    # Reconstruct URL
    normalized = urlunparse(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/"),
            parsed.params,
            new_query,
            "",  # Remove fragment
        )
    )

    return normalized


async def follow_redirect(url: str) -> str:
    """Follow one redirect to get the canonical URL.

    Only follows a single redirect to avoid redirect chains.
    Returns the original URL if no redirect or on error.

    Includes SSRF protection to block requests to private/internal IPs.

    Args:
        url: The URL to resolve

    Returns:
        The resolved URL (or original if no redirect)
    """
    # SSRF protection: check if URL points to internal/private addresses
    parsed = urlparse(url)
    if await _is_private_ip(parsed.hostname or ""):
        logger.warning(
            "ssrf_blocked",
            extra={
                "event": "url_resolve_error",
                "error_type": "ssrf_blocked",
                "url": url[:200],
                "hostname": parsed.hostname,
            },
        )
        return url  # Return original URL without following

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(
            timeout=REDIRECT_TIMEOUT_SECONDS,
            follow_redirects=False,
        ) as client:
            response = await client.head(url)

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location")
                if location:
                    # Handle relative redirects
                    if location.startswith("/"):
                        parsed_orig = urlparse(url)
                        location = (
                            f"{parsed_orig.scheme}://{parsed_orig.netloc}{location}"
                        )

                    # SSRF protection: also check redirect target
                    parsed_loc = urlparse(location)
                    if await _is_private_ip(parsed_loc.hostname or ""):
                        logger.warning(
                            "ssrf_redirect_blocked",
                            extra={
                                "event": "url_resolve_error",
                                "error_type": "ssrf_redirect_blocked",
                                "original_url": url[:200],
                                "redirect_url": location[:200],
                                "hostname": parsed_loc.hostname,
                            },
                        )
                        return url  # Return original URL, don't follow to internal

                    # URL length protection: reject extremely long redirect URLs
                    if len(location) > MAX_URL_LENGTH:
                        logger.warning(
                            "redirect_url_too_long",
                            extra={
                                "event": "url_resolve_error",
                                "error_type": "url_too_long",
                                "original_url": url[:200],
                                "redirect_url_length": len(location),
                            },
                        )
                        return (
                            url  # Return original URL, don't follow oversized redirect
                        )

                    # Open redirect protection: verify redirect target is trusted
                    if not _is_trusted_domain(parsed_loc.hostname or ""):
                        logger.warning(
                            "untrusted_redirect_blocked",
                            extra={
                                "event": "url_resolve_error",
                                "error_type": "untrusted_redirect",
                                "original_url": url[:200],
                                "redirect_url": location[:200],
                                "hostname": parsed_loc.hostname,
                            },
                        )
                        return url  # Return original URL, don't follow to untrusted

                    logger.info(
                        "url_redirect_followed",
                        extra={
                            "event": "url_redirect",
                            "original_url": url[:200],
                            "resolved_url": location[:200],
                            "status_code": response.status_code,
                            "elapsed_ms": round(elapsed_ms, 2),
                        },
                    )
                    return location

            return url

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "url_redirect_timeout",
            extra={
                "event": "url_resolve_error",
                "error_type": "timeout",
                "url": url[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return url

    except httpx.RequestError as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "url_redirect_error",
            extra={
                "event": "url_resolve_error",
                "error_type": "request_error",
                "url": url[:200],
                "error": str(e)[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return url


async def canonicalize_url(url: str) -> tuple[str, SocialProvider | None]:
    """Canonicalize a social media URL.

    Performs the following steps:
    1. Follow one redirect (for short URLs like vm.tiktok.com)
    2. Detect the provider
    3. Normalize the URL (remove tracking params)

    Args:
        url: The original URL

    Returns:
        Tuple of (canonical_url, detected_provider)
    """
    # Step 1: Follow redirect if needed
    resolved_url = await follow_redirect(url)

    # Step 2: Detect provider
    provider = detect_provider(resolved_url)

    # Step 3: Normalize URL
    canonical_url = normalize_url(resolved_url)

    logger.info(
        "url_canonicalized",
        extra={
            "event": "url_canonicalize",
            "original_url": url[:200],
            "canonical_url": canonical_url[:200],
            "provider": provider.value if provider else None,
        },
    )

    return canonical_url, provider


def is_supported_url(url: str) -> bool:
    """Check if a URL is from a supported social media provider.

    Args:
        url: The URL to check

    Returns:
        True if the URL is from TikTok or Instagram
    """
    return detect_provider(url) is not None


def extract_tiktok_video_id(url: str) -> str | None:
    """Extract the video ID from a TikTok URL.

    Args:
        url: TikTok URL

    Returns:
        Video ID string, or None if not found
    """
    parsed = urlparse(url)
    path = parsed.path

    # Match /video/1234567890 or /photo/1234567890
    match = re.search(r"/(?:video|photo)/(\d+)", path)
    if match:
        return match.group(1)

    return None


def extract_instagram_shortcode(url: str) -> str | None:
    """Extract the shortcode from an Instagram URL.

    Args:
        url: Instagram URL

    Returns:
        Shortcode string, or None if not found
    """
    parsed = urlparse(url)
    path = parsed.path

    # Match /p/ABC123 or /reel/ABC123 or /reels/ABC123 or /tv/ABC123
    match = re.search(r"/(?:p|reel|reels|tv)/([\w-]+)", path)
    if match:
        return match.group(1)

    return None
