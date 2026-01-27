"""Main place extraction orchestration logic.

This module coordinates the place extraction process, combining
candidate extraction, location hints, API calls, and scoring.
"""

import asyncio
import html
import logging
import re as _re

from app.core.config import get_settings
from app.schemas.social_ingest import DetectedPlace, OEmbedResponse
from app.services.place_extractor.candidate_extraction import extract_place_candidates
from app.services.place_extractor.data import COUNTRIES
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
MAX_PARALLEL_CANDIDATES = 3

# Overall timeout for place extraction (seconds)
PLACE_EXTRACTION_TIMEOUT = 5.0


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
    title_len = len(title) if title else 0
    bias_name = location_bias.name if location_bias else None
    logger.info(
        f"PLACE EXTRACTION: {len(candidates)} candidates from "
        f"title_len={title_len}, location_bias={bias_name}"
    )
    # Log first candidate only (truncated) for debugging
    if candidates:
        first_cand = (
            candidates[0][:30] + "..." if len(candidates[0]) > 30 else candidates[0]
        )
        logger.debug(f"PLACE EXTRACTION first candidate: {first_cand!r}")

    # Filter out country names - they're used for location biasing, not as search targets
    # (Google Places API returns errors for geopolitical queries like "Kyrgyzstan")
    filtered_candidates = [c for c in candidates if c.lower() not in COUNTRIES]

    # Try all candidates in parallel for better performance (limited by MAX_PARALLEL_CANDIDATES)
    top_candidates = filtered_candidates[:MAX_PARALLEL_CANDIDATES]
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
        alts = [f"{r.name}({s:.2f})" for s, _, r in scored_results[1:3]]
        name = best_result.name
        cc = best_result.country_code
        ptype = best_result.primary_type
        logger.info(
            f"PLACE EXTRACTION selected: {name} (score={best_score:.2f}, "
            f"country={cc}, type={ptype}) over alternatives: {alts}"
        )

    # Apply minimum confidence threshold to avoid low-confidence false matches
    settings = get_settings()
    min_confidence = settings.place_extraction_min_confidence
    if best_result.confidence < min_confidence:
        logger.info(
            "place_extraction_low_confidence",
            extra={
                "event": "place_extraction",
                "result": "low_confidence",
                "place_name": best_result.name[:50] if best_result.name else None,
                "confidence": best_result.confidence,
                "threshold": min_confidence,
            },
        )
        return None

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

    Note:
        The timeout wrapper does not cancel underlying HTTP requests to Google
        Places. This is acceptable because: (1) httpx has its own request timeouts,
        (2) abandoned coroutines are garbage collected, and (3) this prevents
        the caller from waiting indefinitely without needing explicit cancellation.
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


# =============================================================================
# Instagram Profile Place Extraction
# =============================================================================

# Patterns to clean from Instagram profile og:title
_INSTAGRAM_PROFILE_TITLE_PATTERNS = [
    # Pattern: "Business Name (@username)" or "Business Name (@username) "
    (r"\s*\(@[\w.]+\)\s*$", ""),
    # Pattern: "Business Name on Instagram"
    (r"\s+on Instagram\s*$", ""),
    # Pattern: "Business Name * Instagram photos and videos"
    (r"\s*[•*]\s*Instagram photos and videos\s*$", ""),
    # Pattern: "Business Name | Instagram"
    (r"\s*\|\s*Instagram\s*$", ""),
    # Pattern: "Instagram - Business Name" (less common, at start)
    (r"^Instagram\s*[-–—]\s*", ""),
]

_COMPILED_PROFILE_PATTERNS = [
    (_re.compile(pattern, _re.IGNORECASE), replacement)
    for pattern, replacement in _INSTAGRAM_PROFILE_TITLE_PATTERNS
]


def clean_instagram_profile_name(og_title: str) -> str:
    """Clean an Instagram profile og:title to extract the business name.

    Removes common Instagram-specific suffixes and patterns:
    - " (@username)" suffix
    - " on Instagram" suffix
    - " * Instagram photos and videos" suffix
    - " | Instagram" suffix

    Args:
        og_title: The og:title from an Instagram profile page

    Returns:
        Cleaned business name

    Examples:
        "Commander's Palace (@commanderspalace)" -> "Commander's Palace"
        "Joe's Cafe on Instagram" -> "Joe's Cafe"
        "Cafe Central • Instagram photos and videos" -> "Cafe Central"
    """
    if not og_title:
        return ""

    # Guard against malformed responses with excessive text.
    # Instagram profile names are limited to 30 chars, but og:title includes
    # additional text like " (@username) • Instagram photos and videos".
    # 500 chars is more than sufficient for any valid og:title.
    if len(og_title) > 500:
        og_title = og_title[:500]

    # Unescape HTML entities that may be present in og:title
    result = html.unescape(og_title.strip())

    for pattern, replacement in _COMPILED_PROFILE_PATTERNS:
        result = pattern.sub(replacement, result)

    return result.strip()


async def extract_place_from_profile(
    profile_name: str,
    bio: str | None = None,
) -> DetectedPlace | None:
    """Extract a place from an Instagram business profile.

    For business profiles (e.g., restaurant Instagram pages), the profile name
    is the business name. This function searches Google Places using the
    profile name directly, with optional location biasing from the bio.

    Compared to extract_place(), this function:
    - Uses the profile name as the primary search query (no candidate extraction)
    - Gives higher base confidence since user explicitly shared a business profile
    - Extracts location hints from bio for geographic biasing

    Args:
        profile_name: The cleaned business name from the profile
        bio: Optional profile bio (may contain location hints like address)

    Returns:
        DetectedPlace if a matching business was found, None otherwise
    """
    if not profile_name:
        logger.info(
            "profile_place_extraction_skipped",
            extra={
                "event": "place_extraction",
                "result": "no_profile_name",
                "source": "profile",
            },
        )
        return None

    if not is_configured():
        logger.debug("profile_place_extraction_skipped: google_places_not_configured")
        return None

    # Extract location hints from bio for geographic biasing
    location_bias: LocationHint | None = None
    if bio:
        hints = extract_location_hints(bio)
        if hints:
            location_bias = hints[0]
            logger.debug(
                f"profile_place_extraction: bio_location_hint={location_bias.name}"
            )

    logger.info(
        "profile_place_extraction_started",
        extra={
            "event": "place_extraction",
            "source": "profile",
            "profile_name_len": len(profile_name),
            "has_bio": bool(bio),
            "location_bias": location_bias.name if location_bias else None,
        },
    )

    try:
        detected = await asyncio.wait_for(
            _try_candidate(profile_name, location_bias=location_bias),
            timeout=PLACE_EXTRACTION_TIMEOUT,
        )

        if detected:
            # Boost confidence for profile-based extraction
            # Users intentionally shared a business profile, so matches are more likely correct
            boosted_confidence = min(detected.confidence + 0.1, 1.0)
            detected = DetectedPlace(
                google_place_id=detected.google_place_id,
                name=detected.name,
                address=detected.address,
                latitude=detected.latitude,
                longitude=detected.longitude,
                city=detected.city,
                country=detected.country,
                country_code=detected.country_code,
                confidence=boosted_confidence,
                primary_type=detected.primary_type,
                types=detected.types,
            )

            logger.info(
                "profile_place_extraction_success",
                extra={
                    "event": "place_extraction",
                    "result": "found",
                    "source": "profile",
                    "profile_name": profile_name[:50],
                    "place_name": detected.name[:50] if detected.name else None,
                    "country_code": detected.country_code,
                    "confidence": detected.confidence,
                },
            )
        else:
            logger.info(
                "profile_place_extraction_no_match",
                extra={
                    "event": "place_extraction",
                    "result": "no_match",
                    "source": "profile",
                    "profile_name": profile_name[:50],
                },
            )

        return detected

    except TimeoutError:
        logger.warning(
            "profile_place_extraction_timeout",
            extra={
                "event": "place_extraction",
                "result": "timeout",
                "source": "profile",
                "timeout_seconds": PLACE_EXTRACTION_TIMEOUT,
            },
        )
        return None
