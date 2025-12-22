"""Place candidate extraction from social media content.

This module handles extracting potential place name candidates from
social media titles, captions, and author information.
"""

import re

from app.services.place_extractor.text_utils import (
    MAX_TEXT_LENGTH,
    clean_instagram_title,
    clean_text_for_search,
)

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

    # Clean Instagram-specific noise from title (e.g., "@user on Instagram: ")
    if title:
        title = clean_instagram_title(title)

    # Process title - often contains the best place info
    if title:
        # Look for quoted place names
        quoted = re.findall(r'["\'"]([^"\']{3,50})["\'"]', title)
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
        cleaned_title = clean_text_for_search(title)
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
