"""Main place extraction orchestration logic.

This module coordinates the place extraction process, combining
candidate extraction, location hints, API calls, and scoring.
"""

import asyncio
import html
import json
import logging
import re as _re
from dataclasses import dataclass
from typing import Literal

import httpx

from app.core.config import get_settings
from app.schemas.social_ingest import DetectedPlace, OEmbedResponse
from app.services.place_extractor.candidate_extraction import extract_place_candidates
from app.services.place_extractor.data import COUNTRIES
from app.services.place_extractor.google_places_client import (
    get_place_details,
    is_configured,
    search_places,
)
from app.services.place_extractor.llm_client import try_llm_extraction
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

# LLM extraction timeout (shorter than overall, allows fallback)
LLM_EXTRACTION_TIMEOUT = 3.0


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
        logger.debug("_try_candidate: no results", extra={"candidate": candidate[:50]})
        return None

    # Take the first result
    first_result = results[0]
    place_id = first_result.get("place_id")

    if not place_id:
        logger.debug("_try_candidate: no place_id", extra={"candidate": candidate[:50]})
        return None

    # Fetch full details
    details = await get_place_details(place_id)

    if not details:
        logger.debug("_try_candidate: no details", extra={"place_id": place_id})
        return None

    # Calculate confidence
    confidence = calculate_confidence(
        query=candidate,
        place_name=details.get("name", ""),
        is_first_result=True,
    )

    return DetectedPlace(
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


@dataclass(frozen=True)
class ExtractionResult:
    """Result of place extraction with method tracking."""

    place: DetectedPlace | None
    method: Literal["llm", "regex", "none"]


async def _extract_place_impl(
    oembed: OEmbedResponse | None,
    caption: str | None = None,
    extraction_method: Literal["auto", "llm", "regex"] = "auto",
) -> ExtractionResult:
    """Internal implementation of place extraction.

    Cost Optimization:
    - Regex candidate extraction runs in parallel (CPU-only, FREE)
    - Google Places API is ONLY called after we know which path to take
    - If LLM succeeds → Google resolves LLM's candidate
    - If LLM fails → Google resolves regex candidates
    - Never both (avoids duplicate $$ API calls)

    Args:
        oembed: oEmbed response from the social media provider
        caption: Optional user-provided caption
        extraction_method: Method preference ("auto", "llm", or "regex")

    Returns:
        ExtractionResult with detected place and method used
    """
    if not is_configured():
        logger.debug("google_places_not_configured")
        return ExtractionResult(None, "none")

    # Extract content from oEmbed
    title = oembed.title if oembed else None
    author_name = oembed.author_name if oembed else None

    settings = get_settings()

    # ===== PARALLEL PHASE (CPU-only for regex, async for LLM) =====

    # Start LLM extraction if enabled and method allows
    llm_task = None
    if extraction_method in ("auto", "llm") and settings.llm_place_extraction_enabled:
        llm_task = asyncio.create_task(
            try_llm_extraction(
                title,
                caption,
                author_name,
                try_candidate_fn=_try_candidate,
                extract_location_hints_fn=extract_location_hints,
                timeout=LLM_EXTRACTION_TIMEOUT,
            )
        )

    # Run regex candidate extraction concurrently (CPU-only, FREE)
    # This does NOT call Google Places - just extracts candidate strings
    regex_candidates = []
    if extraction_method in ("auto", "regex"):
        regex_candidates = extract_place_candidates(title, caption, author_name)

    # Extract location hints for geographic biasing
    combined_text = " ".join(filter(None, [title, caption]))
    location_hints = extract_location_hints(combined_text)
    location_bias = location_hints[0] if location_hints else None

    # ===== SEQUENTIAL PHASE (API calls only when needed) =====

    # Wait for LLM result if we started it
    if llm_task:
        try:
            llm_result = await asyncio.wait_for(
                llm_task, timeout=LLM_EXTRACTION_TIMEOUT
            )
            if (
                llm_result
                and llm_result.confidence >= settings.place_extraction_min_confidence
            ):
                # Success already logged in llm_client.py as llm_extraction_success
                return ExtractionResult(llm_result, "llm")
        except asyncio.CancelledError:
            raise  # Don't catch cancellation - propagate it
        except TimeoutError:
            logger.debug("llm_extraction_timed_out")
            llm_task.cancel()
            try:
                await llm_task
            except asyncio.CancelledError:
                pass
        except (
            httpx.RequestError,
            httpx.HTTPStatusError,
            json.JSONDecodeError,
            KeyError,
            ValueError,
        ) as e:
            logger.warning("llm_extraction_failed", extra={"error": str(e)[:100]})
            if not llm_task.done():
                llm_task.cancel()
        finally:
            # Ensure task cleanup regardless of path
            if llm_task and not llm_task.done():
                try:
                    await llm_task
                except (asyncio.CancelledError, Exception):
                    pass

    # If method was "llm" only and it failed, return no result
    if extraction_method == "llm":
        logger.info("place_extraction_failed", extra={"reason": "llm_only_no_result"})
        return ExtractionResult(None, "none")

    # ===== FALLBACK: LLM failed, NOW call Google Places for regex candidates =====

    if not regex_candidates:
        logger.info("place_extraction_failed", extra={"reason": "no_candidates"})
        return ExtractionResult(None, "none")

    logger.debug("regex_fallback", extra={"candidates": len(regex_candidates)})

    # Filter out country names - they're used for location biasing, not as search targets
    # (Google Places API returns errors for geopolitical queries like "Kyrgyzstan")
    filtered_candidates = [c for c in regex_candidates if c.lower() not in COUNTRIES]

    # NOW call Google Places API - only in the fallback path
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
        logger.info("place_extraction_failed", extra={"reason": "no_match"})
        return ExtractionResult(None, "none")

    # Sort by score (descending) and return the highest-scored result
    scored_results.sort(key=lambda x: x[0], reverse=True)
    best_score, _, best_result = scored_results[0]

    # Log selection when multiple candidates matched (debugging)
    if len(scored_results) > 1:
        logger.debug(
            "regex_selected_from_multiple",
            extra={
                "place": best_result.name[:30] if best_result.name else None,
                "score": round(best_score, 2),
                "alternatives": len(scored_results) - 1,
            },
        )

    # Apply minimum confidence threshold to avoid low-confidence false matches
    min_confidence = settings.place_extraction_min_confidence
    if best_result.confidence < min_confidence:
        logger.info(
            "place_extraction_failed",
            extra={"reason": "low_confidence", "confidence": best_result.confidence},
        )
        return ExtractionResult(None, "none")

    logger.info(
        "regex_extraction_success",
        extra={"place_name": best_result.name[:30] if best_result.name else None},
    )
    return ExtractionResult(best_result, "regex")


async def extract_place_with_method(
    oembed: OEmbedResponse | None,
    caption: str | None = None,
    extraction_method: Literal["auto", "llm", "regex"] = "auto",
) -> ExtractionResult:
    """Extract a place from social media content with method tracking.

    Attempts to identify and resolve a place from the oEmbed metadata
    and user caption using Google Places API. Uses LLM-first extraction
    when enabled, with regex as fallback.

    Args:
        oembed: oEmbed response from the social media provider
        caption: Optional user-provided caption
        extraction_method: Method preference ("auto", "llm", or "regex")

    Returns:
        ExtractionResult containing the place (if found) and method used

    Note:
        The timeout wrapper does not cancel underlying HTTP requests to Google
        Places. This is acceptable because: (1) httpx has its own request timeouts,
        (2) abandoned coroutines are garbage collected, and (3) this prevents
        the caller from waiting indefinitely without needing explicit cancellation.
    """
    try:
        return await asyncio.wait_for(
            _extract_place_impl(oembed, caption, extraction_method),
            timeout=PLACE_EXTRACTION_TIMEOUT,
        )
    except TimeoutError:
        logger.warning("place_extraction_timeout")
        return ExtractionResult(None, "none")


async def extract_place(
    oembed: OEmbedResponse | None,
    caption: str | None = None,
) -> DetectedPlace | None:
    """Extract a place from social media content.

    This is a convenience wrapper around extract_place_with_method that
    returns only the detected place (for backward compatibility).

    Args:
        oembed: oEmbed response from the social media provider
        caption: Optional user-provided caption

    Returns:
        DetectedPlace if a place was found, None otherwise
    """
    result = await extract_place_with_method(oembed, caption)
    return result.place


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
        logger.debug("profile_extraction_skipped: no_profile_name")
        return None

    if not is_configured():
        logger.debug("profile_extraction_skipped: google_places_not_configured")
        return None

    # Extract location hints from bio for geographic biasing
    location_bias: LocationHint | None = None
    if bio:
        hints = extract_location_hints(bio)
        if hints:
            location_bias = hints[0]

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
                "profile_extraction_success",
                extra={
                    "place_name": detected.name[:50] if detected.name else None,
                    "country_code": detected.country_code,
                },
            )
        else:
            logger.info("place_extraction_failed", extra={"reason": "profile_no_match"})

        return detected

    except TimeoutError:
        logger.warning("place_extraction_timeout", extra={"source": "profile"})
        return None
