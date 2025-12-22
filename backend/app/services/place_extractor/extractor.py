"""Main place extraction orchestration logic.

This module coordinates the place extraction process, combining
candidate extraction, location hints, API calls, and scoring.
"""

import asyncio
import logging

from app.schemas.social_ingest import DetectedPlace, OEmbedResponse
from app.services.place_extractor.candidate_extraction import extract_place_candidates
from app.services.place_extractor.google_places_client import (
    get_place_details,
    is_configured,
    search_places,
)
from app.services.place_extractor.location_hints import (
    LocationHint,
    extract_location_hints,
)
from app.services.place_extractor.scoring import (
    calculate_confidence,
    score_place_result,
)

logger = logging.getLogger(__name__)

# Maximum candidates to try in parallel (limits API calls)
MAX_PARALLEL_CANDIDATES = 5

# Overall timeout for place extraction (seconds)
PLACE_EXTRACTION_TIMEOUT = 10.0


async def _try_candidate(
    candidate: str,
    location_bias: LocationHint | None = None,
) -> DetectedPlace | None:
    """Try to resolve a single place candidate.

    Args:
        candidate: Place name candidate to search
        location_bias: Optional location hint to bias search results

    Returns:
        DetectedPlace if found, None otherwise
    """
    results = await search_places(candidate, location_bias=location_bias)

    if not results:
        logger.info(f"_try_candidate: no results for {candidate!r}")
        return None

    # Take the first result
    first_result = results[0]
    place_id = first_result.get("place_id")
    logger.debug(f"_try_candidate: first_result place_id={place_id!r}")

    if not place_id:
        logger.info(f"_try_candidate: no place_id in result for {candidate!r}")
        return None

    # Fetch full details
    details = await get_place_details(place_id)
    logger.debug(f"_try_candidate: got details for place_id={place_id!r}")

    if not details:
        logger.info(f"_try_candidate: get_place_details failed for {place_id!r}")
        return None

    # Calculate confidence
    confidence = calculate_confidence(
        query=candidate,
        place_name=details.get("name", ""),
        is_first_result=True,
    )

    detected = DetectedPlace(
        google_place_id=details.get("place_id"),
        name=details.get("name", candidate),
        address=details.get("address"),
        latitude=details.get("latitude"),
        longitude=details.get("longitude"),
        city=details.get("city"),
        country=details.get("country"),
        country_code=details.get("country_code"),
        confidence=confidence,
        primary_type=details.get("primary_type"),
        types=details.get("types", []),
    )

    logger.info(
        "place_extraction_success",
        extra={
            "event": "place_extraction",
            "result": "found",
            "query": candidate[:50],
            "place_name": detected.name[:50] if detected.name else None,
            "country_code": detected.country_code,
            "confidence": confidence,
        },
    )

    return detected


async def _extract_place_impl(
    oembed: OEmbedResponse | None,
    caption: str | None = None,
) -> DetectedPlace | None:
    """Internal implementation of place extraction.

    Args:
        oembed: oEmbed response from the social media provider
        caption: Optional user-provided caption

    Returns:
        DetectedPlace if a place was found, None otherwise
    """
    if not is_configured():
        logger.debug("place_extraction_skipped: google_places_not_configured")
        return None

    # Extract candidate place names from content
    title = oembed.title if oembed else None
    author_name = oembed.author_name if oembed else None

    candidates = extract_place_candidates(title, caption, author_name)

    if not candidates:
        logger.info(
            "place_extraction_no_candidates",
            extra={
                "event": "place_extraction",
                "result": "no_candidates",
                "title": title[:50] if title else None,
            },
        )
        return None

    # Extract location hints from title and caption to bias the search
    # This helps find places in the right geographic area when the content
    # mentions a city or country (e.g., "Best coffee in Tokyo" -> bias to Tokyo)
    combined_text = " ".join(filter(None, [title, caption]))
    location_hints = extract_location_hints(combined_text)
    location_bias = location_hints[0] if location_hints else None

    # Log candidate count without exposing content (privacy)
    logger.info(
        f"PLACE EXTRACTION: {len(candidates)} candidates from title_len="
        f"{len(title) if title else 0}, location_bias={location_bias.name if location_bias else None}"
    )
    # Log first candidate only (truncated) for debugging - avoid exposing full user content
    if candidates:
        first_candidate = (
            candidates[0][:30] + "..." if len(candidates[0]) > 30 else candidates[0]
        )
        logger.debug(f"PLACE EXTRACTION first candidate: {first_candidate!r}")

    # Try all candidates in parallel for better performance (limited by MAX_PARALLEL_CANDIDATES)
    top_candidates = candidates[:MAX_PARALLEL_CANDIDATES]
    tasks = [_try_candidate(c, location_bias=location_bias) for c in top_candidates]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Collect all valid results with scores (best-match selection, not first-wins)
    scored_results: list[tuple[float, int, DetectedPlace]] = []
    for i, result in enumerate(results):
        if result is not None and not isinstance(result, Exception):
            score = score_place_result(result, location_bias, i)
            scored_results.append((score, i, result))

    if not scored_results:
        logger.info(
            "place_extraction_no_match",
            extra={
                "event": "place_extraction",
                "result": "no_match",
                "candidates_tried": len(top_candidates),
            },
        )
        return None

    # Sort by score (descending) and return the highest-scored result
    scored_results.sort(key=lambda x: x[0], reverse=True)
    best_score, best_idx, best_result = scored_results[0]

    # Log selection details for debugging
    if len(scored_results) > 1:
        alternatives = [f"{r.name}({s:.2f})" for s, _, r in scored_results[1:3]]
        logger.info(
            f"PLACE EXTRACTION selected: {best_result.name} (score={best_score:.2f}, "
            f"country={best_result.country_code}, type={best_result.primary_type}) "
            f"over alternatives: {alternatives}"
        )

    return best_result


async def extract_place(
    oembed: OEmbedResponse | None,
    caption: str | None = None,
) -> DetectedPlace | None:
    """Extract a place from social media content.

    Attempts to identify and resolve a place from the oEmbed metadata
    and user caption using Google Places API. Tries top candidates in
    parallel for better performance.

    Args:
        oembed: oEmbed response from the social media provider
        caption: Optional user-provided caption

    Returns:
        DetectedPlace if a place was found, None otherwise
    """
    try:
        return await asyncio.wait_for(
            _extract_place_impl(oembed, caption),
            timeout=PLACE_EXTRACTION_TIMEOUT,
        )
    except TimeoutError:
        logger.warning(
            "place_extraction_timeout",
            extra={
                "event": "place_extraction",
                "result": "timeout",
                "timeout_seconds": PLACE_EXTRACTION_TIMEOUT,
            },
        )
        return None
