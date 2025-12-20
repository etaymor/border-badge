"""Outbound redirect endpoint for affiliate link tracking."""

import logging
import time
from typing import Annotated
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path, Query, Request, status
from fastapi.responses import RedirectResponse

from app.core.bot_detection import is_known_bot
from app.core.urls import safe_external_url
from app.main import limiter
from app.schemas.affiliate import (
    OutboundClickCreate,
    OutboundLinkStatus,
)
from app.services.affiliate_links import (
    get_link_by_id,
    log_click_fire_and_forget,
    resolve_destination_url_async,
    verify_signature,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["outbound"])


def _anonymize_ip(ip: str | None) -> str | None:
    """Mask IP address for privacy compliance (GDPR).

    Zeroes the last octet for IPv4 (e.g., 192.168.1.42 -> 192.168.1.0)
    and the last 80 bits for IPv6.
    """
    if not ip:
        return None
    if ":" in ip:  # IPv6
        parts = ip.split(":")
        if len(parts) >= 4:
            return ":".join(parts[:4]) + ":0:0:0:0"
        return ip
    else:  # IPv4
        parts = ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3]) + ".0"
        return ip


@router.get("/o/{link_id}")
# Rate limit: 120 req/min per IP (via get_remote_address in main.py)
# Higher than other endpoints for legitimate link sharing traffic
@limiter.limit("120/minute")
async def redirect_outbound(
    request: Request,
    link_id: Annotated[
        UUID,
        Path(description="UUID of the outbound link"),
    ],
    src: Annotated[
        str,
        Query(
            min_length=1,
            max_length=50,
            description="Click source context (trip_share, list_share, in_app)",
        ),
    ],
    sig: Annotated[
        str,
        Query(
            min_length=1,
            max_length=128,
            description="HMAC signature for validation",
        ),
    ],
    trip_id: Annotated[
        UUID | None,
        Query(description="Optional trip UUID for analytics context"),
    ] = None,
    entry_id: Annotated[
        UUID | None,
        Query(description="Optional entry UUID for analytics context"),
    ] = None,
) -> RedirectResponse:
    """Handle outbound redirect with signature validation and click logging.

    This endpoint:
    1. Validates the HMAC signature to prevent URL tampering
    2. Fetches the link definition from the database
    3. Resolves the destination URL (partner affiliate → Skimlinks → original)
    4. Logs the click asynchronously (non-blocking)
    5. Returns a 302 redirect to the destination

    Args:
        request: FastAPI request object
        link_id: UUID of the outbound link
        src: Click source context (trip_share, list_share, in_app)
        sig: HMAC-SHA256 signature for validation
        trip_id: Optional trip UUID for analytics
        entry_id: Optional entry UUID for analytics

    Returns:
        302 redirect to the resolved destination URL

    Raises:
        400: Invalid or missing signature
        404: Link not found
        410: Link is paused or archived
    """
    # Start timing for latency measurement
    start_time = time.perf_counter()

    # Convert UUIDs to strings for signature verification
    link_id_str = str(link_id)
    trip_id_str = str(trip_id) if trip_id else None
    entry_id_str = str(entry_id) if entry_id else None

    # Extract request metadata early for logging
    user_agent = request.headers.get("user-agent")
    client_ip = request.client.host if request.client else None

    # 1. Verify HMAC signature
    # verify_signature uses hmac.compare_digest() for constant-time comparison
    # preventing timing attacks on signature validation
    if not verify_signature(link_id_str, trip_id_str, entry_id_str, src, sig):
        logger.warning(
            "affiliate_redirect_invalid_sig",
            extra={
                "event": "invalid_signature",
                "link_id": link_id_str,
                "client_ip": _anonymize_ip(client_ip),
                "source": src,
                "is_bot": is_known_bot(user_agent),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired signature",
        )

    # 2. Fetch link definition
    link = await get_link_by_id(link_id)
    if not link:
        logger.info(
            "affiliate_redirect_not_found",
            extra={
                "event": "link_not_found",
                "link_id": link_id_str,
                "source": src,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found",
        )

    # 3. Check link status
    if link.status == OutboundLinkStatus.PAUSED:
        logger.info(
            "affiliate_redirect_paused",
            extra={
                "event": "link_paused",
                "link_id": link_id_str,
                "source": src,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This link is temporarily unavailable",
        )
    if link.status == OutboundLinkStatus.ARCHIVED:
        logger.info(
            "affiliate_redirect_archived",
            extra={
                "event": "link_archived",
                "link_id": link_id_str,
                "source": src,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This link is no longer available",
        )

    # 4. Resolve destination URL (priority: affiliate_url → Skimlinks → original)
    destination_url, resolution_path = await resolve_destination_url_async(
        link,
        trip_id=trip_id_str,
        entry_id=entry_id_str,
    )

    # Defense-in-depth: Validate destination URL before redirect
    # This catches any issues with URLs that made it into the database
    if not safe_external_url(destination_url):
        logger.error(
            "affiliate_redirect_invalid_destination",
            extra={
                "event": "invalid_destination",
                "link_id": link_id_str,
                "destination_url": destination_url[:100] if destination_url else None,
                "resolution_path": resolution_path.value,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid redirect destination",
        )

    # 5. Log click asynchronously (fire-and-forget to avoid blocking redirect)
    # Extract additional request metadata for analytics
    referer = request.headers.get("referer")
    # IP country could be extracted from headers like CF-IPCountry or X-Vercel-IP-Country
    ip_country = (
        request.headers.get("cf-ipcountry")
        or request.headers.get("x-vercel-ip-country")
        or None
    )

    click_data = OutboundClickCreate(
        link_id=link_id,
        trip_id=trip_id,
        entry_id=entry_id,
        source=src,
        resolution=resolution_path,
        destination_url=destination_url,
        user_agent=user_agent[:500] if user_agent else None,  # Truncate long UAs
        ip_country=ip_country,
        referer=referer[:2048] if referer else None,  # Truncate long referers
    )

    # Fire-and-forget click logging (truly non-blocking via asyncio.create_task)
    log_click_fire_and_forget(click_data)

    # Calculate latency and log structured redirect event
    # Analytics data logged (see privacy policy):
    # - user_agent: 100 chars in log, 500 in DB (bot detection, device stats)
    # - ip_country: 2-char code from CDN headers (geo analytics)
    # Click records: stored indefinitely for analytics
    latency_ms = (time.perf_counter() - start_time) * 1000
    logger.info(
        "affiliate_redirect",
        extra={
            "event": "redirect",
            "link_id": link_id_str,
            "entry_id": entry_id_str,
            "trip_id": trip_id_str,
            "source": src,
            "resolution_path": resolution_path.value,
            "destination_domain": urlparse(destination_url).netloc,
            "latency_ms": round(latency_ms, 2),
            "user_agent": user_agent[:100] if user_agent else None,
            "ip_country": ip_country,
            "is_bot": is_known_bot(user_agent),
        },
    )

    # 6. Return 302 redirect
    return RedirectResponse(url=destination_url, status_code=status.HTTP_302_FOUND)
