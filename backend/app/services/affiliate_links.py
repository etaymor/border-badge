"""Affiliate links service for outbound redirect management."""

import asyncio
import hashlib
import hmac
import logging
from urllib.parse import urlencode
from uuid import UUID

from app.core.config import get_settings
from app.db.session import get_supabase_client
from app.schemas.affiliate import (
    OutboundClick,
    OutboundClickCreate,
    OutboundLink,
    OutboundLinkCreate,
    OutboundLinkStatus,
    OutboundLinkUpdate,
    PartnerMapping,
    PartnerMappingCreate,
    PartnerMappingUpdate,
    ResolutionPath,
)

logger = logging.getLogger(__name__)


def _get_signing_secret() -> str:
    """Get the signing secret, generating a development fallback if needed."""
    settings = get_settings()
    secret = settings.affiliate_signing_secret
    if not secret:
        if settings.is_production:
            raise ValueError("AFFILIATE_SIGNING_SECRET must be set in production")
        # Use a consistent dev secret for testing
        secret = "dev-affiliate-signing-secret-do-not-use-in-prod"
        logger.warning("Using development fallback for affiliate signing secret")
    return secret


def generate_signature(
    link_id: str,
    trip_id: str | None,
    entry_id: str | None,
    source: str,
) -> str:
    """Generate HMAC-SHA256 signature for redirect URL validation.

    Args:
        link_id: UUID of the outbound link
        trip_id: Optional trip UUID for context
        entry_id: Optional entry UUID for context
        source: Click source (trip_share, list_share, in_app)

    Returns:
        Hex-encoded HMAC signature
    """
    secret = _get_signing_secret()

    # Build canonical message with sorted, normalized values
    parts = [
        f"link_id={link_id}",
        f"trip_id={trip_id or ''}",
        f"entry_id={entry_id or ''}",
        f"source={source}",
    ]
    message = "&".join(parts)

    signature = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return signature


def verify_signature(
    link_id: str,
    trip_id: str | None,
    entry_id: str | None,
    source: str,
    signature: str,
) -> bool:
    """Verify HMAC-SHA256 signature for redirect URL.

    Args:
        link_id: UUID of the outbound link
        trip_id: Optional trip UUID for context
        entry_id: Optional entry UUID for context
        source: Click source (trip_share, list_share, in_app)
        signature: Hex-encoded signature to verify

    Returns:
        True if signature is valid, False otherwise
    """
    expected = generate_signature(link_id, trip_id, entry_id, source)
    return hmac.compare_digest(expected, signature)


def build_redirect_url(
    base_url: str,
    link_id: str,
    trip_id: str | None = None,
    entry_id: str | None = None,
    source: str = "list_share",
) -> str:
    """Build a signed redirect URL for an outbound link.

    Args:
        base_url: Base URL of the application (e.g., https://atlasi.app)
        link_id: UUID of the outbound link
        trip_id: Optional trip UUID for analytics context
        entry_id: Optional entry UUID for analytics context
        source: Click source context

    Returns:
        Full redirect URL with signature
    """
    signature = generate_signature(link_id, trip_id, entry_id, source)

    params = {
        "src": source,
        "sig": signature,
    }
    if trip_id:
        params["trip_id"] = trip_id
    if entry_id:
        params["entry_id"] = entry_id

    query = urlencode(params)
    return f"{base_url}/o/{link_id}?{query}"


async def get_link_by_id(link_id: str | UUID) -> OutboundLink | None:
    """Fetch an outbound link by its ID.

    Args:
        link_id: UUID of the link to fetch

    Returns:
        OutboundLink if found, None otherwise
    """
    db = get_supabase_client()

    rows = await db.get(
        "outbound_link",
        {
            "id": f"eq.{link_id}",
            "select": "*",
        },
    )

    if not rows:
        return None

    row = rows[0]
    return OutboundLink(
        id=row["id"],
        entry_id=row.get("entry_id"),
        destination_url=row["destination_url"],
        partner_slug=row.get("partner_slug"),
        affiliate_url=row.get("affiliate_url"),
        status=OutboundLinkStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def get_link_by_entry_id(entry_id: str | UUID) -> OutboundLink | None:
    """Fetch an outbound link by its entry ID.

    Args:
        entry_id: UUID of the entry

    Returns:
        OutboundLink if found, None otherwise
    """
    db = get_supabase_client()

    rows = await db.get(
        "outbound_link",
        {
            "entry_id": f"eq.{entry_id}",
            "select": "*",
        },
    )

    if not rows:
        return None

    row = rows[0]
    return OutboundLink(
        id=row["id"],
        entry_id=row.get("entry_id"),
        destination_url=row["destination_url"],
        partner_slug=row.get("partner_slug"),
        affiliate_url=row.get("affiliate_url"),
        status=OutboundLinkStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def create_link(data: OutboundLinkCreate) -> OutboundLink:
    """Create a new outbound link.

    Args:
        data: Link creation data

    Returns:
        Created OutboundLink
    """
    db = get_supabase_client()

    insert_data = {
        "entry_id": str(data.entry_id),
        "destination_url": data.destination_url,
        "partner_slug": data.partner_slug,
        "affiliate_url": data.affiliate_url,
        "status": OutboundLinkStatus.ACTIVE.value,
    }

    rows = await db.post("outbound_link", insert_data)
    row = rows[0]

    return OutboundLink(
        id=row["id"],
        entry_id=row.get("entry_id"),
        destination_url=row["destination_url"],
        partner_slug=row.get("partner_slug"),
        affiliate_url=row.get("affiliate_url"),
        status=OutboundLinkStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def update_link(
    link_id: str | UUID, data: OutboundLinkUpdate
) -> OutboundLink | None:
    """Update an outbound link.

    Args:
        link_id: UUID of the link to update
        data: Update data

    Returns:
        Updated OutboundLink if found, None otherwise
    """
    db = get_supabase_client()

    update_data = {}
    if data.destination_url is not None:
        update_data["destination_url"] = data.destination_url
    if data.partner_slug is not None:
        update_data["partner_slug"] = data.partner_slug
    if data.affiliate_url is not None:
        update_data["affiliate_url"] = data.affiliate_url
    if data.status is not None:
        update_data["status"] = data.status.value

    if not update_data:
        return await get_link_by_id(link_id)

    rows = await db.patch(
        "outbound_link",
        update_data,
        {"id": f"eq.{link_id}"},
    )

    if not rows:
        return None

    row = rows[0]
    return OutboundLink(
        id=row["id"],
        entry_id=row.get("entry_id"),
        destination_url=row["destination_url"],
        partner_slug=row.get("partner_slug"),
        affiliate_url=row.get("affiliate_url"),
        status=OutboundLinkStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def get_or_create_link_for_entry(
    entry_id: str | UUID,
    destination_url: str,
    partner_slug: str | None = None,
) -> OutboundLink:
    """Get existing link for entry or create a new one.

    Handles race conditions where concurrent callers may both try to create
    a link for the same entry. If a duplicate key error occurs, re-fetches
    the existing link created by another caller.

    Args:
        entry_id: UUID of the entry
        destination_url: Destination URL for the link
        partner_slug: Optional partner identifier

    Returns:
        Existing or newly created OutboundLink
    """
    existing = await get_link_by_entry_id(entry_id)
    if existing:
        # Update destination if changed
        if existing.destination_url != destination_url:
            updated = await update_link(
                existing.id,
                OutboundLinkUpdate(destination_url=destination_url),
            )
            # Handle case where link was deleted between read and update
            if updated is None:
                existing = await get_link_by_entry_id(entry_id)
                if existing:
                    return existing
                # Link truly deleted, fall through to create
            else:
                return updated
        else:
            return existing

    try:
        return await create_link(
            OutboundLinkCreate(
                entry_id=UUID(str(entry_id)),
                destination_url=destination_url,
                partner_slug=partner_slug,
            )
        )
    except Exception as e:
        # Handle race condition: another caller created the link concurrently
        error_msg = str(e).lower()
        if "duplicate" in error_msg or "unique" in error_msg or "conflict" in error_msg:
            logger.debug(
                f"Race condition on link creation for entry {entry_id}, re-fetching"
            )
            existing = await get_link_by_entry_id(entry_id)
            if existing:
                return existing
        # Re-raise if not a duplicate key error or if re-fetch failed
        raise


async def log_click(data: OutboundClickCreate) -> OutboundClick:
    """Log an outbound click event.

    This should be called asynchronously to avoid blocking redirects.

    Args:
        data: Click data to log

    Returns:
        Created OutboundClick record
    """
    db = get_supabase_client()

    insert_data = {
        "link_id": str(data.link_id),
        "trip_id": str(data.trip_id) if data.trip_id else None,
        "entry_id": str(data.entry_id) if data.entry_id else None,
        "source": data.source,
        "resolution": data.resolution.value,
        "destination_url": data.destination_url,
        "user_agent": data.user_agent,
        "ip_country": data.ip_country,
        "referer": data.referer,
    }

    try:
        rows = await db.post("outbound_click", insert_data)
        row = rows[0]

        logger.info(
            f"click_logged: link_id={data.link_id} "
            f"source={data.source} resolution={data.resolution.value}"
        )

        return OutboundClick(
            id=row["id"],
            link_id=row["link_id"],
            trip_id=row.get("trip_id"),
            entry_id=row.get("entry_id"),
            source=row["source"],
            resolution=ResolutionPath(row["resolution"]),
            destination_url=row["destination_url"],
            user_agent=row.get("user_agent"),
            ip_country=row.get("ip_country"),
            referer=row.get("referer"),
            clicked_at=row["clicked_at"],
        )
    except Exception as e:
        # Log but don't fail the redirect on click logging errors
        logger.error(f"Failed to log click for link {data.link_id}: {e}")
        raise


async def _log_click_wrapper(data: OutboundClickCreate) -> None:
    """Internal wrapper that catches and logs exceptions for background task."""
    try:
        await log_click(data)
    except Exception as e:
        # Structured logging for alerting - filter on event=click_log_error
        logger.error(
            "click_log_error",
            extra={
                "event": "click_log_error",
                "link_id": str(data.link_id),
                "source": data.source,
                "error": str(e),
            },
        )


def log_click_fire_and_forget(data: OutboundClickCreate) -> None:
    """Schedule click logging as a background task (true fire-and-forget).

    Uses asyncio.create_task to run the click logging in the background
    without blocking the caller. This ensures redirects are not delayed
    by database writes.

    Args:
        data: Click data to log
    """
    asyncio.create_task(_log_click_wrapper(data))


async def log_click_async(data: OutboundClickCreate) -> None:
    """Log click without waiting for result (fire-and-forget for redirects).

    DEPRECATED: Use log_click_fire_and_forget() instead for true non-blocking.
    This function still awaits internally for backwards compatibility.

    Args:
        data: Click data to log
    """
    try:
        await log_click(data)
    except Exception:
        # Already logged in log_click
        pass


def resolve_destination_url(link: OutboundLink) -> tuple[str, ResolutionPath]:
    """Resolve the final destination URL for a link.

    Priority:
    1. Cached affiliate_url (if available)
    2. Original destination_url

    Note: Skimlinks integration will be added in Phase 3.

    Args:
        link: OutboundLink to resolve

    Returns:
        Tuple of (destination_url, resolution_path)
    """
    # If we have a cached affiliate URL, use it
    if link.affiliate_url:
        if link.partner_slug == "skimlinks":
            return link.affiliate_url, ResolutionPath.SKIMLINKS
        return link.affiliate_url, ResolutionPath.DIRECT_PARTNER

    # Fall back to original URL
    return link.destination_url, ResolutionPath.ORIGINAL


async def resolve_destination_url_async(
    link: OutboundLink,
    trip_id: str | None = None,
    entry_id: str | None = None,
) -> tuple[str, ResolutionPath]:
    """Resolve the final destination URL for a link with Skimlinks fallback.

    This async version integrates with Skimlinks API when no direct partner
    affiliate URL is available.

    Priority:
    1. Cached affiliate_url (direct partner or previous Skimlinks wrap)
    2. Try Skimlinks API wrap (if no affiliate_url and Skimlinks configured)
    3. Original destination_url (no monetization)

    Args:
        link: OutboundLink to resolve
        trip_id: Optional trip UUID for Skimlinks tracking
        entry_id: Optional entry UUID for Skimlinks tracking

    Returns:
        Tuple of (destination_url, resolution_path)
    """
    # Import here to avoid circular dependency
    from app.services.skimlinks import resolve_with_skimlinks

    # 1. If we have a cached affiliate URL, use it
    if link.affiliate_url:
        if link.partner_slug == "skimlinks":
            return link.affiliate_url, ResolutionPath.SKIMLINKS
        return link.affiliate_url, ResolutionPath.DIRECT_PARTNER

    # 2. Try Skimlinks wrapping for the original URL
    wrapped_url, resolution_path = await resolve_with_skimlinks(
        destination_url=link.destination_url,
        trip_id=trip_id,
        entry_id=entry_id,
    )

    # If Skimlinks succeeded, cache it on the link for future requests
    if resolution_path == ResolutionPath.SKIMLINKS:
        try:
            await update_link(
                link.id,
                OutboundLinkUpdate(
                    affiliate_url=wrapped_url,
                    partner_slug="skimlinks",
                ),
            )
            logger.debug(
                f"cached_skimlinks_on_link: link_id={link.id} url={wrapped_url[:50]}"
            )
        except Exception as e:
            # Log but don't fail - caching is best-effort
            logger.warning(f"failed_to_cache_skimlinks: link_id={link.id} error={e}")

    return wrapped_url, resolution_path


# =============================================================================
# Partner Mapping CRUD Functions
# =============================================================================


def _row_to_partner_mapping(row: dict) -> PartnerMapping:
    """Convert a database row to a PartnerMapping model."""
    return PartnerMapping(
        id=row["id"],
        entry_id=row.get("entry_id"),
        google_place_id=row.get("google_place_id"),
        partner_slug=row["partner_slug"],
        partner_property_id=row["partner_property_id"],
        confidence=row["confidence"],
        is_verified=row["is_verified"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def create_partner_mapping(data: PartnerMappingCreate) -> PartnerMapping:
    """Create a new partner mapping.

    Args:
        data: Partner mapping creation data

    Returns:
        Created PartnerMapping
    """
    db = get_supabase_client()

    insert_data = {
        "entry_id": str(data.entry_id) if data.entry_id else None,
        "google_place_id": data.google_place_id,
        "partner_slug": data.partner_slug,
        "partner_property_id": data.partner_property_id,
        "confidence": data.confidence,
        "is_verified": data.is_verified,
    }

    rows = await db.post("partner_mapping", insert_data)
    row = rows[0]

    logger.info(
        f"partner_mapping_created: entry_id={data.entry_id} "
        f"partner={data.partner_slug} confidence={data.confidence}"
    )

    return _row_to_partner_mapping(row)


async def get_partner_mapping(
    entry_id: str | UUID, partner_slug: str
) -> PartnerMapping | None:
    """Fetch a partner mapping by entry ID and partner slug.

    Args:
        entry_id: UUID of the entry
        partner_slug: Partner identifier (e.g., 'booking', 'tripadvisor')

    Returns:
        PartnerMapping if found, None otherwise
    """
    db = get_supabase_client()

    rows = await db.get(
        "partner_mapping",
        {
            "entry_id": f"eq.{entry_id}",
            "partner_slug": f"eq.{partner_slug}",
            "select": "*",
        },
    )

    if not rows:
        return None

    return _row_to_partner_mapping(rows[0])


async def get_partner_mapping_by_id(mapping_id: str | UUID) -> PartnerMapping | None:
    """Fetch a partner mapping by its ID.

    Args:
        mapping_id: UUID of the mapping

    Returns:
        PartnerMapping if found, None otherwise
    """
    db = get_supabase_client()

    rows = await db.get(
        "partner_mapping",
        {
            "id": f"eq.{mapping_id}",
            "select": "*",
        },
    )

    if not rows:
        return None

    return _row_to_partner_mapping(rows[0])


async def get_mappings_for_entry(entry_id: str | UUID) -> list[PartnerMapping]:
    """Fetch all partner mappings for an entry.

    Args:
        entry_id: UUID of the entry

    Returns:
        List of PartnerMapping objects, ordered by confidence descending
    """
    db = get_supabase_client()

    rows = await db.get(
        "partner_mapping",
        {
            "entry_id": f"eq.{entry_id}",
            "select": "*",
            "order": "confidence.desc",
        },
    )

    return [_row_to_partner_mapping(row) for row in rows]


async def get_mapping_by_google_place_id(
    google_place_id: str, partner_slug: str
) -> PartnerMapping | None:
    """Fetch a partner mapping by Google Place ID and partner slug.

    Args:
        google_place_id: Google Places API ID
        partner_slug: Partner identifier

    Returns:
        PartnerMapping if found, None otherwise
    """
    db = get_supabase_client()

    rows = await db.get(
        "partner_mapping",
        {
            "google_place_id": f"eq.{google_place_id}",
            "partner_slug": f"eq.{partner_slug}",
            "select": "*",
        },
    )

    if not rows:
        return None

    return _row_to_partner_mapping(rows[0])


async def upsert_partner_mapping(data: PartnerMappingCreate) -> PartnerMapping:
    """Create or update a partner mapping.

    Uses (entry_id, partner_slug) as the unique key for upsert.

    Args:
        data: Partner mapping data

    Returns:
        Created or updated PartnerMapping
    """
    db = get_supabase_client()

    upsert_data = {
        "entry_id": str(data.entry_id) if data.entry_id else None,
        "google_place_id": data.google_place_id,
        "partner_slug": data.partner_slug,
        "partner_property_id": data.partner_property_id,
        "confidence": data.confidence,
        "is_verified": data.is_verified,
    }

    rows = await db.upsert(
        "partner_mapping",
        [upsert_data],
        on_conflict="entry_id,partner_slug",
    )
    row = rows[0]

    logger.info(
        f"partner_mapping_upserted: entry_id={data.entry_id} "
        f"partner={data.partner_slug} confidence={data.confidence}"
    )

    return _row_to_partner_mapping(row)


async def update_partner_mapping(
    mapping_id: str | UUID, data: PartnerMappingUpdate
) -> PartnerMapping | None:
    """Update a partner mapping.

    Args:
        mapping_id: UUID of the mapping to update
        data: Update data

    Returns:
        Updated PartnerMapping if found, None otherwise
    """
    db = get_supabase_client()

    update_data = {}
    if data.partner_property_id is not None:
        update_data["partner_property_id"] = data.partner_property_id
    if data.confidence is not None:
        update_data["confidence"] = data.confidence
    if data.is_verified is not None:
        update_data["is_verified"] = data.is_verified

    if not update_data:
        return await get_partner_mapping_by_id(mapping_id)

    rows = await db.patch(
        "partner_mapping",
        update_data,
        {"id": f"eq.{mapping_id}"},
    )

    if not rows:
        return None

    logger.info(
        f"partner_mapping_updated: id={mapping_id} "
        f"updates={list(update_data.keys())}"
    )

    return _row_to_partner_mapping(rows[0])


async def delete_partner_mapping(mapping_id: str | UUID) -> bool:
    """Delete a partner mapping.

    Args:
        mapping_id: UUID of the mapping to delete

    Returns:
        True if deleted, False if not found
    """
    db = get_supabase_client()

    rows = await db.delete(
        "partner_mapping",
        {"id": f"eq.{mapping_id}"},
    )

    deleted = len(rows) > 0
    if deleted:
        logger.info(f"partner_mapping_deleted: id={mapping_id}")

    return deleted


async def delete_mappings_for_entry(entry_id: str | UUID) -> int:
    """Delete all partner mappings for an entry.

    Args:
        entry_id: UUID of the entry

    Returns:
        Number of mappings deleted
    """
    db = get_supabase_client()

    rows = await db.delete(
        "partner_mapping",
        {"entry_id": f"eq.{entry_id}"},
    )

    count = len(rows)
    if count > 0:
        logger.info(f"partner_mappings_deleted: entry_id={entry_id} count={count}")

    return count
