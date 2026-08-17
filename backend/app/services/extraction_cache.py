"""Extraction result caching for social media place detection.

Caches LLM and video frame extraction results in the oembed_cache table.
Extraction results are user-agnostic (same places for all users).

The cache stores extraction results alongside oEmbed data, keyed by canonical URL.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from app.db.session import get_supabase_client
from app.schemas.social_ingest import DetectedPlace

logger = logging.getLogger(__name__)

# Type alias for extraction source
ExtractionSource = Literal["caption", "video_frames", "carousel", "screenshot"]

# Priority hierarchy for extraction sources (higher = better quality)
# video_frames: Most reliable, from visual analysis of video content
# carousel: Visual analysis of carousel images
# screenshot: Visual analysis of screenshots
# caption: Text-based extraction (lowest quality)
SOURCE_PRIORITY: dict[str | None, int] = {
    "video_frames": 4,
    "carousel": 3,
    "screenshot": 2,
    "caption": 1,
}


def get_source_priority(source: str | None) -> int:
    """Get the priority value for an extraction source.

    Args:
        source: The extraction source type

    Returns:
        Priority value (higher = better quality). Unknown sources return 0.
    """
    return SOURCE_PRIORITY.get(source, 0)


def should_update_cache(existing_source: str | None, new_source: str) -> bool:
    """Determine if cache should be updated based on source quality hierarchy.

    Update rules:
    - Always update if no existing extraction (existing_source is None)
    - Update if new source has higher priority than existing
    - Update if same source type (allow re-extraction with fresh data)
    - Do NOT update if new source has lower priority (preserve higher quality)

    Args:
        existing_source: The current cached extraction source (None if no cache)
        new_source: The new extraction source attempting to cache

    Returns:
        True if cache should be updated, False otherwise
    """
    if existing_source is None:
        return True

    existing_priority = get_source_priority(existing_source)
    new_priority = get_source_priority(new_source)

    # Update if new source is equal or higher quality
    return new_priority >= existing_priority


@dataclass
class CachedExtractionResult:
    """Cached extraction result from database."""

    places: list[DetectedPlace]
    source: ExtractionSource
    extraction_at: datetime


def _places_to_json(places: list[DetectedPlace]) -> list[dict]:
    """Convert DetectedPlace list to JSON-serializable format."""
    return [
        {
            "google_place_id": p.google_place_id,
            "name": p.name,
            "address": p.address,
            "latitude": p.latitude,
            "longitude": p.longitude,
            "city": p.city,
            "country": p.country,
            "country_code": p.country_code,
            "confidence": p.confidence,
            "primary_type": p.primary_type,
            "types": p.types,
            "google_photo_url": p.google_photo_url,
            "llm_entry_type": p.llm_entry_type,
        }
        for p in places
    ]


def _json_to_places(data: list[dict]) -> list[DetectedPlace]:
    """Convert JSON data back to DetectedPlace list."""
    return [
        DetectedPlace(
            google_place_id=item.get("google_place_id"),
            name=item.get("name", "Unknown"),
            address=item.get("address"),
            latitude=item.get("latitude"),
            longitude=item.get("longitude"),
            city=item.get("city"),
            country=item.get("country"),
            country_code=item.get("country_code"),
            confidence=item.get("confidence", 0.0),
            primary_type=item.get("primary_type"),
            types=item.get("types", []),
            google_photo_url=item.get("google_photo_url"),
            llm_entry_type=item.get("llm_entry_type"),
        )
        for item in data
        if isinstance(item, dict) and item.get("name")
    ]


async def get_cached_extraction(
    canonical_url: str,
) -> CachedExtractionResult | None:
    """Fetch cached extraction result for a URL.

    Args:
        canonical_url: The canonical URL to look up

    Returns:
        Cached extraction result if found and valid, None otherwise
    """
    db = get_supabase_client()

    rows = await db.get(
        "oembed_cache",
        {
            "canonical_url": f"eq.{canonical_url}",
            "select": "extraction_result,extraction_source,extraction_at",
        },
    )

    if not rows:
        return None

    row = rows[0]

    # Check if extraction result exists (allow empty list for negative cache)
    if row.get("extraction_result") is None or not row.get("extraction_source"):
        logger.debug(f"extraction_cache_miss: no_result url={canonical_url[:50]}")
        return None

    places = _json_to_places(row["extraction_result"])
    source = row["extraction_source"]
    extraction_at = row.get("extraction_at")

    if extraction_at:
        extraction_at = datetime.fromisoformat(extraction_at.replace("Z", "+00:00"))
    else:
        extraction_at = datetime.now(UTC)

    logger.debug(
        f"extraction_cache_hit: url={canonical_url[:50]} places={len(places)} source={source}"
    )

    return CachedExtractionResult(
        places=places,
        source=source,
        extraction_at=extraction_at,
    )


def _get_lower_priority_sources(source: ExtractionSource) -> list[str]:
    """Get all source types with strictly lower priority than the given source.

    Args:
        source: The extraction source to compare against

    Returns:
        List of source type strings with lower priority
    """
    priority = get_source_priority(source)
    return [s for s, p in SOURCE_PRIORITY.items() if s is not None and p < priority]


async def cache_extraction(
    canonical_url: str,
    places: list[DetectedPlace],
    source: ExtractionSource,
) -> None:
    """Cache extraction result for a URL.

    Uses an atomic conditional UPDATE to prevent TOCTOU race conditions.
    The UPDATE only succeeds when:
    - No existing extraction source (IS NULL), OR
    - The existing source is the same type (re-extraction), OR
    - The existing source has strictly lower priority

    This is done in a single PATCH call with WHERE filters, so concurrent
    requests cannot interleave between a check and an update.

    Quality hierarchy (highest to lowest):
    1. video_frames - Most reliable, from visual analysis
    2. carousel - Visual analysis of carousel images
    3. screenshot - Visual analysis of screenshots
    4. caption - Text-based extraction

    Args:
        canonical_url: The canonical URL
        places: List of detected places
        source: How the places were extracted
    """
    db = get_supabase_client()

    extraction_at = datetime.now(UTC).isoformat()
    places_json = _places_to_json(places)

    # Build atomic conditional UPDATE filter.
    # Only update if: source IS NULL, source matches (re-extraction),
    # or source is strictly lower priority.
    lower_sources = _get_lower_priority_sources(source)
    or_conditions = [
        "extraction_source.is.null",
        f"extraction_source.eq.{source}",
    ]
    for ls in lower_sources:
        or_conditions.append(f"extraction_source.eq.{ls}")

    updated = await db.patch(
        "oembed_cache",
        {
            "extraction_result": places_json,
            "extraction_source": source,
            "extraction_at": extraction_at,
        },
        {
            "canonical_url": f"eq.{canonical_url}",
            "or": f"({','.join(or_conditions)})",
        },
    )

    if updated:
        logger.debug(
            f"extraction_cache_stored: url={canonical_url[:50]} places={len(places)} source={source}"
        )
    else:
        logger.debug(
            f"extraction_cache_skip: url={canonical_url[:50]} source={source} "
            f"- preserved higher quality extraction or row missing"
        )


async def invalidate_extraction_cache(canonical_url: str) -> None:
    """Invalidate extraction cache for a URL.

    Clears the extraction result without removing the oEmbed cache.

    Args:
        canonical_url: The canonical URL to invalidate
    """
    db = get_supabase_client()

    await db.patch(
        "oembed_cache",
        {
            "extraction_result": None,
            "extraction_source": None,
            "extraction_at": None,
        },
        {"canonical_url": f"eq.{canonical_url}"},
    )

    logger.debug(f"extraction_cache_invalidated: url={canonical_url[:50]}")
