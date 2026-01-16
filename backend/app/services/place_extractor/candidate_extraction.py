"""Place candidate extraction from social media content.

This module handles extracting potential place name candidates from
social media titles, captions, and author information.
"""

import logging
import re

from app.services.place_extractor.text_utils import (
    MAX_TEXT_LENGTH,
    clean_instagram_title,
    clean_text_for_search,
    run_with_timeout,
)

logger = logging.getLogger(__name__)

# Location-indicating emojis used on social media to mark places
# Primary: 📍 (round pushpin) - most common on Instagram/TikTok
# Secondary: Other location-related emojis as fallbacks
LOCATION_EMOJIS_PRIMARY = [
    "\U0001f4cd",  # 📍 Round Pushpin - most common for locations
]

LOCATION_EMOJIS_SECONDARY = [
    "\U0001f4cc",  # 📌 Pushpin
    "\U0001f5fa",  # 🗺️ World Map (with variation selector)
    "\U0001f30d",  # 🌍 Earth Globe Europe-Africa
    "\U0001f30e",  # 🌎 Earth Globe Americas
    "\U0001f30f",  # 🌏 Earth Globe Asia-Australia
]

# All location emojis in priority order
LOCATION_EMOJIS = LOCATION_EMOJIS_PRIMARY + LOCATION_EMOJIS_SECONDARY


def extract_emoji_locations(text: str) -> list[str]:
    """Extract location text following location-indicating emojis.

    On Instagram and TikTok, users commonly use 📍 to mark specific locations,
    e.g., "📍 Cafe Central, Vienna" or "📍Bangkok, Thailand".

    This function extracts the text immediately following location emojis,
    which is typically the place name.

    Uses timeout protection to prevent ReDoS attacks on untrusted input.

    Args:
        text: Caption or title text to search

    Returns:
        List of location strings found after emojis, in order of appearance
    """
    if not text:
        return []

    # Truncate to prevent ReDoS attacks
    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    def _extract() -> list[str]:
        locations: list[str] = []

        # Build regex pattern for all location emojis using alternation
        # (not character class) to properly match multi-codepoint sequences
        # like 🗺️ which includes variation selector FE0F
        escaped_emojis = [re.escape(emoji) for emoji in LOCATION_EMOJIS]
        emoji_pattern = "(?:" + "|".join(escaped_emojis) + ")"

        # Pattern to capture text after emoji until:
        # - End of line
        # - Another emoji (any emoji, not just location ones)
        # - A hashtag
        # - Multiple newlines
        # Captures the location text which typically follows the emoji
        #
        # Emoji ranges to exclude:
        # - U+1F300-U+1FAFF: Miscellaneous Symbols, Emoticons, Dingbats, etc.
        # - U+1F1E0-U+1F1FF: Regional Indicator Symbols (flag emojis like 🇮🇹)
        # - U+2600-U+26FF: Miscellaneous Symbols (☀️, ⚡, etc.)
        # - U+2700-U+27BF: Dingbats
        # - U+FE0F: Variation selector (strip from captured text)
        pattern = (
            emoji_pattern
            + r"\uFE0F?"  # Optional variation selector after emoji
            + r"\s*"  # Optional whitespace after emoji
            + r"([^\n#\U0001F300-\U0001FAFF\U0001F1E0-\U0001F1FF\u2600-\u27BF\uFE0F]{3,60})"
        )

        matches = re.findall(pattern, text)

        for match in matches:
            # Clean up the match
            cleaned = match.strip()

            # Remove trailing punctuation except apostrophes (for names like "Tirana's")
            cleaned = re.sub(r"[,.:;!?\-]+$", "", cleaned).strip()

            # Skip if too short after cleaning
            if len(cleaned) < 3:
                continue

            # Skip if it's just common words/noise
            lower_cleaned = cleaned.lower()
            if lower_cleaned in {"here", "location", "place", "spot", "check", "this"}:
                continue

            locations.append(cleaned)

        return locations

    try:
        return run_with_timeout(_extract)
    except TimeoutError:
        logger.warning("emoji_extraction_timeout: returning empty list")
        return []


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

    Extraction priority:
    1. Emoji-marked locations (📍) - highest confidence, users explicitly mark places
    2. Quoted/parenthetical text
    3. Location indicator patterns ("at X", "in Y")
    4. Proper noun phrases
    5. Hashtags and mentions

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

    # PRIORITY 1: Extract locations marked with 📍 or other location emojis
    # This is the most reliable signal as users explicitly mark places this way
    # Check caption first (user's own text), then title
    if caption:
        emoji_locations = extract_emoji_locations(caption)
        candidates.extend(emoji_locations)

    if title:
        emoji_locations = extract_emoji_locations(title)
        candidates.extend(emoji_locations)

    # Process title - often contains the best place info
    if title:
        # Look for quoted place names (handles straight and smart quotes)
        # Includes: " " " ' ' ' (straight double, smart double, straight single, smart single)
        quoted = re.findall(
            r'[""\u201c\u201d\'\u2018\u2019]([^""\u201c\u201d\'\u2018\u2019]{3,50})[""\u201c\u201d\'\u2018\u2019]',
            title,
        )
        candidates.extend(quoted)

        # Look for parenthetical place names like "(Tirana's Rock)"
        parenthetical = re.findall(r"\(([A-Za-z][A-Za-z\s''-]{2,40})\)", title)
        candidates.extend(parenthetical)

        # Look for location patterns like "at Place Name" or "in City"
        location_matches = re.findall(
            r"\b(?:at|in|visit(?:ing)?)\s+([A-Z][A-Za-z\s&''-]{2,40})", title
        )
        candidates.extend(location_matches)

        # Look for capitalized multi-word phrases (likely proper nouns/place names)
        # Handles apostrophes in names like "Tirana's Rock"
        proper_nouns = re.findall(
            r"([A-Z][a-z]+(?:[''][a-z]+)?(?:\s+[A-Z][a-z]+(?:[''][a-z]+)?)+)", title
        )
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
