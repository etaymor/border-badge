"""Place extraction from social media content using Google Places API."""

import asyncio
import logging
import re
import time

import httpx

from app.core.config import get_settings
from app.schemas.social_ingest import DetectedPlace, OEmbedResponse

logger = logging.getLogger(__name__)

# Google Places API endpoints (New API v1)
PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places"

# API timeouts
API_TIMEOUT_SECONDS = 5.0

# Input length limits to prevent ReDoS attacks
MAX_TEXT_LENGTH = 5000  # Maximum length of text to process for place extraction

# Confidence thresholds
HIGH_CONFIDENCE_THRESHOLD = 0.8
MEDIUM_CONFIDENCE_THRESHOLD = 0.5

# Common location indicator words to help identify place names in text
LOCATION_INDICATORS = {
    "at",
    "in",
    "visit",
    "visiting",
    "visited",
    "restaurant",
    "cafe",
    "coffee",
    "hotel",
    "beach",
    "bar",
    "club",
    "museum",
    "park",
    "market",
    "shop",
    "store",
    "temple",
    "church",
    "mosque",
    "plaza",
    "square",
    "street",
    "avenue",
    "road",
    "island",
}

# Words to filter out from potential place names
NOISE_WORDS = {
    "the",
    "a",
    "an",
    "this",
    "that",
    "my",
    "your",
    "best",
    "top",
    "amazing",
    "incredible",
    "beautiful",
    "stunning",
    "delicious",
    "yummy",
    "perfect",
    "must",
    "try",
    "check",
    "out",
    "link",
    "bio",
    "fyp",
    "viral",
    "trending",
    "follow",
    "like",
    "share",
    "comment",
}


def _is_configured() -> bool:
    """Check if Google Places API is configured."""
    settings = get_settings()
    return bool(settings.google_places_api_key)


def extract_place_candidates(
    title: str | None,
    caption: str | None,
    author_name: str | None,
) -> list[str]:
    """Extract potential place name candidates from social media content.

    Uses heuristics to identify likely place names from:
    - Video/post title
    - User caption
    - Author name (sometimes contains location)

    Input is truncated to prevent ReDoS attacks.

    Args:
        title: The video/post title from oEmbed
        caption: User-provided caption when sharing
        author_name: Content creator's name/handle

    Returns:
        List of potential place name candidates, ordered by likelihood
    """
    candidates: list[str] = []

    # Truncate inputs to prevent ReDoS attacks
    if title and len(title) > MAX_TEXT_LENGTH:
        title = title[:MAX_TEXT_LENGTH]
    if caption and len(caption) > MAX_TEXT_LENGTH:
        caption = caption[:MAX_TEXT_LENGTH]
    if author_name and len(author_name) > 500:  # Author names are shorter
        author_name = author_name[:500]

    # Process title - often contains the best place info
    if title:
        # Look for quoted place names
        quoted = re.findall(r'["\']([^"\']{3,50})["\']', title)
        candidates.extend(quoted)

        # Look for location patterns like "at Place Name" or "in City"
        location_matches = re.findall(
            r"\b(?:at|in|visit(?:ing)?)\s+([A-Z][A-Za-z\s&\'-]{2,40})", title
        )
        candidates.extend(location_matches)

        # Look for capitalized multi-word phrases (likely proper nouns/place names)
        proper_nouns = re.findall(r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)", title)
        candidates.extend(proper_nouns)

        # Add the full title as a fallback candidate (cleaned up)
        cleaned_title = _clean_text_for_search(title)
        if cleaned_title and len(cleaned_title) > 3:
            candidates.append(cleaned_title)

    # Process caption
    if caption:
        # Look for hashtag locations (common pattern: #PlaceName)
        hashtag_locations = re.findall(r"#([A-Z][A-Za-z]{2,30})", caption)
        candidates.extend(hashtag_locations)

        # Look for @ mentions that might be place handles
        at_mentions = re.findall(r"@([A-Za-z][A-Za-z0-9_]{2,30})", caption)
        # Filter to likely business names (not personal accounts)
        for mention in at_mentions:
            # Business handles often contain keywords
            lower_mention = mention.lower()
            if any(
                word in lower_mention
                for word in [
                    "restaurant",
                    "cafe",
                    "hotel",
                    "bar",
                    "beach",
                    "resort",
                    "club",
                ]
            ):
                candidates.append(mention.replace("_", " "))

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_candidates: list[str] = []
    for candidate in candidates:
        normalized = candidate.strip().lower()
        if normalized and normalized not in seen and len(normalized) > 2:
            seen.add(normalized)
            unique_candidates.append(candidate.strip())

    return unique_candidates[:10]  # Limit to top 10 candidates


def _clean_text_for_search(text: str) -> str:
    """Clean text for use in place search.

    Removes hashtags, mentions, emojis, and other noise.
    Truncates input to prevent ReDoS attacks.

    Args:
        text: Raw text to clean

    Returns:
        Cleaned text suitable for search
    """
    # Truncate to prevent ReDoS attacks on regex operations
    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    # Remove hashtags and mentions
    cleaned = re.sub(r"[#@]\w+", " ", text)

    # Remove URLs
    cleaned = re.sub(r"https?://\S+", " ", cleaned)

    # Remove emojis (basic pattern)
    cleaned = re.sub(
        r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF\U00002702-\U000027B0\U0001F900-\U0001F9FF]",
        " ",
        cleaned,
    )

    # Remove special characters except basic punctuation
    cleaned = re.sub(r"[^\w\s\'-]", " ", cleaned)

    # Collapse whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # Remove noise words from beginning
    words = cleaned.split()
    while words and words[0].lower() in NOISE_WORDS:
        words.pop(0)

    return " ".join(words)


async def search_places(
    query: str,
    country_code: str | None = None,
) -> list[dict]:
    """Search for places using Google Places Autocomplete API.

    Args:
        query: Search query string
        country_code: Optional ISO country code to scope results

    Returns:
        List of place predictions with id, name, address
    """
    if not _is_configured():
        logger.debug("google_places_not_configured: skipping search")
        return []

    if not query or len(query) < 2:
        return []

    settings = get_settings()

    body: dict = {
        "input": query,
        "includedPrimaryTypes": ["establishment"],
    }

    if country_code:
        body["includedRegionCodes"] = [country_code.lower()]

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.post(
                PLACES_AUTOCOMPLETE_URL,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": settings.google_places_api_key,
                },
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code != 200:
                logger.warning(
                    "places_autocomplete_error",
                    extra={
                        "event": "places_error",
                        "query": query[:50],
                        "status_code": response.status_code,
                        "elapsed_ms": round(elapsed_ms, 2),
                    },
                )
                return []

            data = response.json()
            suggestions = data.get("suggestions", [])

            results = []
            for suggestion in suggestions:
                place_prediction = suggestion.get("placePrediction")
                if place_prediction:
                    results.append(
                        {
                            "place_id": place_prediction.get("placeId"),
                            "name": place_prediction.get("structuredFormat", {})
                            .get("mainText", {})
                            .get("text", ""),
                            "address": place_prediction.get("structuredFormat", {})
                            .get("secondaryText", {})
                            .get("text", ""),
                            "description": place_prediction.get("text", {}).get(
                                "text", ""
                            ),
                        }
                    )

            logger.info(
                "places_autocomplete_success",
                extra={
                    "event": "places_search",
                    "query": query[:50],
                    "result_count": len(results),
                    "elapsed_ms": round(elapsed_ms, 2),
                },
            )

            return results

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "places_autocomplete_timeout",
            extra={
                "event": "places_error",
                "error_type": "timeout",
                "query": query[:50],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return []

    except (httpx.RequestError, ValueError) as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "places_autocomplete_error",
            extra={
                "event": "places_error",
                "error_type": type(e).__name__,
                "query": query[:50],
                "error": str(e)[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return []


async def get_place_details(place_id: str) -> dict | None:
    """Get detailed information about a place.

    Args:
        place_id: Google Places place ID

    Returns:
        Place details dict, or None on failure
    """
    if not _is_configured():
        return None

    settings = get_settings()
    url = f"{PLACES_DETAILS_URL}/{place_id}"

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.get(
                url,
                headers={
                    "X-Goog-Api-Key": settings.google_places_api_key,
                    "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents,photos,websiteUri",
                },
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code != 200:
                logger.warning(
                    "places_details_error",
                    extra={
                        "event": "places_error",
                        "place_id": place_id,
                        "status_code": response.status_code,
                        "elapsed_ms": round(elapsed_ms, 2),
                    },
                )
                return None

            data = response.json()

            # Extract city and country from address components
            city = None
            country = None
            country_code = None

            for component in data.get("addressComponents", []):
                types = component.get("types", [])
                if "locality" in types:
                    city = component.get("longText")
                elif "country" in types:
                    country = component.get("longText")
                    country_code = component.get("shortText")

            location = data.get("location", {})

            result = {
                "place_id": data.get("id"),
                "name": data.get("displayName", {}).get("text", ""),
                "address": data.get("formattedAddress"),
                "latitude": location.get("latitude"),
                "longitude": location.get("longitude"),
                "city": city,
                "country": country,
                "country_code": country_code,
                "website": data.get("websiteUri"),
                "photos": data.get("photos", []),
            }

            logger.info(
                "places_details_success",
                extra={
                    "event": "places_details",
                    "place_id": place_id,
                    "name": result["name"][:50] if result["name"] else None,
                    "country_code": country_code,
                    "elapsed_ms": round(elapsed_ms, 2),
                },
            )

            return result

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "places_details_timeout",
            extra={
                "event": "places_error",
                "error_type": "timeout",
                "place_id": place_id,
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None

    except (httpx.RequestError, ValueError) as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "places_details_error",
            extra={
                "event": "places_error",
                "error_type": type(e).__name__,
                "place_id": place_id,
                "error": str(e)[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None


def _calculate_confidence(
    query: str,
    place_name: str,
    is_first_result: bool,
) -> float:
    """Calculate confidence score for a place match.

    Args:
        query: Original search query
        place_name: Name of the matched place
        is_first_result: Whether this was the first search result

    Returns:
        Confidence score between 0.0 and 1.0
    """
    confidence = 0.0

    query_lower = query.lower()
    name_lower = place_name.lower()

    # Exact match is high confidence
    if query_lower == name_lower:
        confidence = 0.95

    # Query is substring of place name (or vice versa)
    elif query_lower in name_lower or name_lower in query_lower:
        confidence = 0.75

    # Significant word overlap
    else:
        query_words = set(query_lower.split())
        name_words = set(name_lower.split())
        overlap = len(query_words & name_words)
        total_words = max(len(query_words), len(name_words))
        if total_words > 0:
            confidence = 0.5 * (overlap / total_words)

    # Boost for first result
    if is_first_result:
        confidence = min(confidence + 0.1, 1.0)

    return round(confidence, 2)


async def _try_candidate(candidate: str) -> DetectedPlace | None:
    """Try to resolve a single place candidate.

    Args:
        candidate: Place name candidate to search

    Returns:
        DetectedPlace if found, None otherwise
    """
    results = await search_places(candidate)

    if not results:
        return None

    # Take the first result
    first_result = results[0]
    place_id = first_result.get("place_id")

    if not place_id:
        return None

    # Fetch full details
    details = await get_place_details(place_id)

    if not details:
        return None

    # Calculate confidence
    confidence = _calculate_confidence(
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


# Maximum candidates to try in parallel (limits API calls)
MAX_PARALLEL_CANDIDATES = 3


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
    if not _is_configured():
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

    logger.debug(f"place_extraction_candidates: {candidates[:5]}")

    # Try top candidates in parallel for better performance
    top_candidates = candidates[:MAX_PARALLEL_CANDIDATES]
    tasks = [_try_candidate(c) for c in top_candidates]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Return first successful result (order preserved)
    for result in results:
        if result is not None and not isinstance(result, Exception):
            return result

    # If parallel batch failed, try remaining candidates sequentially
    for candidate in candidates[MAX_PARALLEL_CANDIDATES:]:
        result = await _try_candidate(candidate)
        if result is not None:
            return result

    logger.info(
        "place_extraction_no_match",
        extra={
            "event": "place_extraction",
            "result": "no_match",
            "candidates_tried": len(candidates),
        },
    )

    return None
