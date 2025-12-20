"""Admin endpoints for affiliate link management.

Protected by service role authentication - not for end users.
These endpoints allow viewing and managing outbound links and click statistics.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.core.security import require_service_role
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.affiliate import OutboundLinkStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# =============================================================================
# Response Models
# =============================================================================


class LinkWithStats(BaseModel):
    """Outbound link with click statistics."""

    id: UUID
    entry_id: UUID
    destination_url: str
    affiliate_url: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    click_count: int = 0


class LinkDetail(BaseModel):
    """Detailed link info with recent clicks."""

    id: UUID
    entry_id: UUID
    destination_url: str
    affiliate_url: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    click_count: int
    recent_clicks: list[dict]


class LinkUpdateRequest(BaseModel):
    """Request to update a link."""

    status: OutboundLinkStatus | None = None
    affiliate_url: str | None = None


class LinkListResponse(BaseModel):
    """Response for link listing."""

    links: list[LinkWithStats]
    total: int
    limit: int
    offset: int


class StatsSummary(BaseModel):
    """Aggregate click statistics."""

    total_clicks: int
    unique_links_clicked: int
    clicks_by_source: dict[str, int]
    clicks_by_resolution: dict[str, int]
    top_destinations: list[dict]
    period_days: int


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/links")
@limiter.limit("30/minute")
async def list_links(
    request: Request,  # Required for rate limiter
    status_filter: Annotated[
        str | None,
        Query(alias="status", description="Filter by link status"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    _: None = Depends(require_service_role),
) -> LinkListResponse:
    """List outbound links with click statistics.

    Returns paginated list of links with their click counts.
    Can filter by status (active, paused, archived).
    """
    db = get_supabase_client()

    # Build query filters
    filters: dict[str, str] = {}
    if status_filter:
        filters["status"] = f"eq.{status_filter}"

    # Get links with pagination
    links_rows = await db.get(
        "outbound_link",
        {
            **filters,
            "select": "*",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        },
    )

    # Get total count for pagination
    count_rows = await db.get(
        "outbound_link",
        {
            **filters,
            "select": "id",
        },
    )
    total = len(count_rows)

    # Get click counts for these links
    link_ids = [row["id"] for row in links_rows]
    click_counts: dict[str, int] = {}

    if link_ids:
        # Get click counts grouped by link_id
        for link_id in link_ids:
            clicks = await db.get(
                "outbound_click",
                {
                    "link_id": f"eq.{link_id}",
                    "select": "id",
                },
            )
            click_counts[link_id] = len(clicks)

    # Build response
    links = [
        LinkWithStats(
            id=row["id"],
            entry_id=row["entry_id"],
            destination_url=row["destination_url"],
            affiliate_url=row.get("affiliate_url"),
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            click_count=click_counts.get(row["id"], 0),
        )
        for row in links_rows
    ]

    logger.info(
        "admin_list_links",
        extra={
            "event": "admin_list_links",
            "count": len(links),
            "total": total,
            "status_filter": status_filter,
        },
    )

    return LinkListResponse(
        links=links,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/links/stats/summary")
@limiter.limit("30/minute")
async def get_stats_summary(
    request: Request,  # Required for rate limiter
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    _: None = Depends(require_service_role),
) -> StatsSummary:
    """Get aggregate click statistics for the specified period.

    Returns summary including:
    - Total clicks
    - Unique links clicked
    - Clicks by source (trip_share, list_share, etc.)
    - Clicks by resolution path (partner, skimlinks, original)
    - Top destinations by click count
    """
    db = get_supabase_client()

    # Calculate date range
    since = datetime.now(UTC) - timedelta(days=days)

    # Get all clicks in the period
    clicks = await db.get(
        "outbound_click",
        {
            "created_at": f"gte.{since.isoformat()}",
            "select": "id,link_id,source,resolution,destination_url",
        },
    )

    # Calculate statistics
    total_clicks = len(clicks)
    unique_links = len({c["link_id"] for c in clicks})

    # Clicks by source
    clicks_by_source: dict[str, int] = {}
    for click in clicks:
        source = click.get("source", "unknown")
        clicks_by_source[source] = clicks_by_source.get(source, 0) + 1

    # Clicks by resolution path
    clicks_by_resolution: dict[str, int] = {}
    for click in clicks:
        resolution = click.get("resolution", "unknown")
        clicks_by_resolution[resolution] = clicks_by_resolution.get(resolution, 0) + 1

    # Top destinations
    dest_counts: dict[str, int] = {}
    for click in clicks:
        dest = click.get("destination_url", "")
        # Extract domain for grouping
        if dest:
            try:
                from urllib.parse import urlparse

                domain = urlparse(dest).netloc
                dest_counts[domain] = dest_counts.get(domain, 0) + 1
            except Exception:
                pass

    top_destinations = sorted(
        [{"domain": k, "clicks": v} for k, v in dest_counts.items()],
        key=lambda x: x["clicks"],
        reverse=True,
    )[:10]

    logger.info(
        "admin_stats_summary",
        extra={
            "event": "admin_stats_summary",
            "days": days,
            "total_clicks": total_clicks,
            "unique_links": unique_links,
        },
    )

    return StatsSummary(
        total_clicks=total_clicks,
        unique_links_clicked=unique_links,
        clicks_by_source=clicks_by_source,
        clicks_by_resolution=clicks_by_resolution,
        top_destinations=top_destinations,
        period_days=days,
    )


@router.get("/links/{link_id}")
@limiter.limit("30/minute")
async def get_link_detail(
    request: Request,  # Required for rate limiter
    link_id: UUID,
    _: None = Depends(require_service_role),
) -> LinkDetail:
    """Get detailed link info including recent clicks.

    Returns the link definition plus the 20 most recent clicks.
    """
    db = get_supabase_client()

    # Get the link
    links = await db.get(
        "outbound_link",
        {
            "id": f"eq.{link_id}",
            "select": "*",
        },
    )

    if not links:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found",
        )

    link = links[0]

    # Get click count
    all_clicks = await db.get(
        "outbound_click",
        {
            "link_id": f"eq.{link_id}",
            "select": "id",
        },
    )
    click_count = len(all_clicks)

    # Get recent clicks (last 20)
    recent_clicks = await db.get(
        "outbound_click",
        {
            "link_id": f"eq.{link_id}",
            "select": "id,source,resolution,ip_country,user_agent,created_at",
            "order": "created_at.desc",
            "limit": "20",
        },
    )

    return LinkDetail(
        id=link["id"],
        entry_id=link["entry_id"],
        destination_url=link["destination_url"],
        affiliate_url=link.get("affiliate_url"),
        status=link["status"],
        created_at=link["created_at"],
        updated_at=link["updated_at"],
        click_count=click_count,
        recent_clicks=recent_clicks,
    )


@router.patch("/links/{link_id}")
@limiter.limit("20/minute")
async def update_link(
    request: Request,  # Required for rate limiter
    link_id: UUID,
    update: LinkUpdateRequest,
    _: None = Depends(require_service_role),
) -> LinkWithStats:
    """Update link status or override affiliate URL.

    Can be used to:
    - Pause a link (stop redirects temporarily)
    - Archive a link (permanently disable)
    - Override the affiliate URL for a specific link
    """
    db = get_supabase_client()

    # Verify link exists
    links = await db.get(
        "outbound_link",
        {
            "id": f"eq.{link_id}",
            "select": "*",
        },
    )

    if not links:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found",
        )

    # Build update data
    update_data: dict[str, str] = {
        "updated_at": datetime.now(UTC).isoformat(),
    }

    if update.status is not None:
        update_data["status"] = update.status.value

    if update.affiliate_url is not None:
        update_data["affiliate_url"] = update.affiliate_url

    # Perform update
    updated = await db.update(
        "outbound_link",
        update_data,
        {"id": f"eq.{link_id}"},
    )

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update link",
        )

    row = updated[0]

    # Get click count
    clicks = await db.get(
        "outbound_click",
        {
            "link_id": f"eq.{link_id}",
            "select": "id",
        },
    )

    logger.info(
        "admin_update_link",
        extra={
            "event": "admin_update_link",
            "link_id": str(link_id),
            "new_status": update.status.value if update.status else None,
            "affiliate_url_changed": update.affiliate_url is not None,
        },
    )

    return LinkWithStats(
        id=row["id"],
        entry_id=row["entry_id"],
        destination_url=row["destination_url"],
        affiliate_url=row.get("affiliate_url"),
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        click_count=len(clicks),
    )
