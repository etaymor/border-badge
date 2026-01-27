"""Place candidate extraction from social media content.

This module handles extracting potential place name candidates from
social media titles, captions, and author information.
"""

import logging
import re

from app.services.place_extractor.data import COUNTRIES, MAJOR_CITIES
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

# Pre-compile regex pattern for location emoji extraction (performance optimization)
# Built once at module load instead of on every function call
_ESCAPED_EMOJIS = [re.escape(emoji) for emoji in LOCATION_EMOJIS]
_EMOJI_PATTERN = "(?:" + "|".join(_ESCAPED_EMOJIS) + ")"
# Pattern to capture text after emoji until end of line, another emoji, or hashtag
# Emoji ranges excluded: U+1F300-U+1FAFF, U+1F1E0-U+1F1FF, U+2600-U+27BF, U+FE0F
_LOCATION_EMOJI_REGEX = re.compile(
    _EMOJI_PATTERN
    + r"\uFE0F?"  # Optional variation selector after emoji
    + r"\s*"  # Optional whitespace after emoji
    + r"([^\n#\U0001F300-\U0001FAFF\U0001F1E0-\U0001F1FF\u2600-\u27BF\uFE0F]{3,60})"
)


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

        # Use pre-compiled regex pattern for better performance
        matches = _LOCATION_EMOJI_REGEX.findall(text)

        for match in matches:
            # Clean up the match
            cleaned = match.strip()

            # Strip common prefixes like "Location:" BEFORE other processing
            # This handles patterns like "📍 Location: Temple of Poseidon"
            cleaned = re.sub(r"^[Ll]ocation\s*[:：]\s*", "", cleaned)
            cleaned = re.sub(r"^[Pp]lace\s*[:：]\s*", "", cleaned)
            cleaned = re.sub(r"^[Aa]t\s+", "", cleaned)

            # Remove trailing punctuation except apostrophes (for names like "Tirana's")
            cleaned = re.sub(r"[,.:;!?\-]+$", "", cleaned).strip()

            # Truncate at common delimiters that indicate additional info
            # e.g., "Saint Simon monastery or Cave Church in the Coptic district"
            # → "Saint Simon monastery" (the primary name before "or"/"in")
            # But preserve "Temple of Poseidon" (the "of" is part of the name)
            for delimiter in [" or ", " in the ", " near ", " and "]:
                if delimiter in cleaned.lower():
                    parts = re.split(
                        delimiter, cleaned, flags=re.IGNORECASE, maxsplit=1
                    )
                    if parts[0].strip() and len(parts[0].strip()) >= 5:
                        cleaned = parts[0].strip()
                        break

            # Skip if too short after cleaning
            if len(cleaned) < 3:
                continue

            # Skip if it's just common words/noise (checked AFTER stripping prefixes)
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
    # Action words
    "at",
    "in",
    "visit",
    "visiting",
    "visited",
    # Commercial venues
    "restaurant",
    "cafe",
    "coffee",
    "hotel",
    "bar",
    "club",
    "market",
    "shop",
    "store",
    # Religious/Historic landmarks
    "temple",
    "church",
    "mosque",
    "monastery",
    "cathedral",
    "shrine",
    "basilica",
    "chapel",
    "abbey",
    # Historic structures
    "palace",
    "castle",
    "fortress",
    "citadel",
    "ruins",
    "pyramid",
    "tomb",
    "mausoleum",
    "monument",
    "memorial",
    # Urban features
    "plaza",
    "square",
    "street",
    "avenue",
    "road",
    # Natural features
    "beach",
    "island",
    "waterfall",
    "falls",
    "canyon",
    "cave",
    "gorge",
    "valley",
    "viewpoint",
    "peak",
    "summit",
    "glacier",
    "oasis",
    "spring",
    "lake",
    "mountain",
    # Other POIs
    "museum",
    "park",
    "tower",
    "bridge",
    "gate",
    "wall",
    "garden",
    "zoo",
    "aquarium",
}

# Landmark type words that can follow a proper noun (e.g., "Karnak temple")
# Used to match "ProperNoun + landmark_type" patterns
LANDMARK_TYPES_PATTERN = (
    r"(?:temple|monastery|church|cathedral|mosque|palace|castle|ruins|tower|"
    r"museum|park|beach|shrine|basilica|abbey|fort|fortress|tomb|pyramid|"
    r"falls|waterfall|canyon|cave|bridge|memorial|monument|garden)s?"
)

# Pre-compile flag emoji pattern for efficiency
# Flag emojis are two regional indicator symbols (U+1F1E6 to U+1F1FF)
_FLAG_EMOJI_REGEX = re.compile(
    r"([\U0001F1E6-\U0001F1FF]{2})\s*([A-Za-z][A-Za-z\s''\-,]{2,50})?"
)

# Pre-compile "Location:" prefix pattern
_LOCATION_PREFIX_REGEX = re.compile(
    r"[Ll]ocation\s*[:：]\s*([A-Za-z][A-Za-z\s&''\-,]{2,50})"
)


def extract_location_prefix_places(text: str) -> list[str]:
    """Extract place names following 'Location:' prefix pattern.

    Handles patterns like:
    - "Location: Temple of Poseidon"
    - "location: Karnak Temple"

    Args:
        text: Caption or title text to search

    Returns:
        List of location strings found after Location: prefix
    """
    if not text:
        return []

    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    locations = []
    matches = _LOCATION_PREFIX_REGEX.findall(text)

    for match in matches:
        cleaned = match.strip()
        # Remove trailing punctuation
        cleaned = re.sub(r"[,.:;!?\-]+$", "", cleaned).strip()

        if len(cleaned) >= 3:
            locations.append(cleaned)

    return locations


def extract_flag_emoji_locations(text: str) -> tuple[list[str], str | None]:
    """Extract locations following flag emojis and detect country from flag.

    Flag emojis are two regional indicator letters (U+1F1E6-U+1F1FF).
    For example: 🇴🇲 = "O" + "M" = OM (Oman)

    Note: City names are filtered out as they're better used for location biasing
    rather than as search candidates. For example, "🇪🇬 Luxor | Tours" should
    use Luxor for biasing, not as a place candidate.

    Args:
        text: Caption or title text to search

    Returns:
        Tuple of (place_names, country_code) where country_code is derived from the flag
    """
    if not text:
        return [], None

    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    places: list[str] = []
    country_code: str | None = None

    matches = _FLAG_EMOJI_REGEX.findall(text)
    for flag, place_text in matches:
        # Decode flag to country code
        # Each flag char is 0x1F1E6 + letter_index (A=0, B=1, ...)
        letter1 = chr(ord(flag[0]) - 0x1F1E6 + ord("A"))
        letter2 = chr(ord(flag[1]) - 0x1F1E6 + ord("A"))
        detected_code = letter1 + letter2

        # Use first detected flag as country code
        if country_code is None:
            country_code = detected_code

        # Extract place text after flag (but filter out city names)
        if place_text:
            cleaned = re.sub(r"[,.:;!?\-]+$", "", place_text).strip()
            # Skip city names - they're used for location biasing, not as candidates
            # This avoids "🇪🇬 Luxor | Tours" extracting "Luxor" as a place
            if len(cleaned) >= 3 and cleaned.lower() not in MAJOR_CITIES:
                places.append(cleaned)

    return places, country_code


def extract_country_prefixed_places(text: str) -> list[str]:
    """Extract place names that follow a country name.

    Patterns: "Oman - Wadi Shab", "Egypt: Karnak Temple"
    Uses the existing COUNTRIES dictionary (150+ countries with aliases).

    Args:
        text: Caption or title text to search

    Returns:
        List of place names found after country names
    """
    if not text:
        return []

    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    places: list[str] = []

    for country_name in COUNTRIES.keys():
        # Pattern: "Country - Place" or "Country: Place" or "Country – Place"
        pattern = (
            r"\b"
            + re.escape(country_name)
            + r"\s*[-:–]\s*([A-Za-z][A-Za-z\s''\-]{2,40})"
        )
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            cleaned = re.sub(r"[,.:;!?\-]+$", "", match).strip()
            if len(cleaned) >= 3:
                places.append(cleaned)

    return places


def extract_landmark_patterns(text: str) -> list[str]:
    """Extract 'ProperNoun + landmark_type' patterns.

    Matches patterns like "Karnak temple", "Notre Dame cathedral".
    Handles lowercase landmark type words that follow capitalized proper nouns.
    Excludes patterns starting with articles (the, a, an) - those are handled
    by extract_the_landmark_pattern.

    Args:
        text: Title or caption text to search

    Returns:
        List of landmark names found
    """
    if not text:
        return []

    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    # Pattern: ProperNoun(s) + landmark_type (case-insensitive only for landmark type)
    # The [A-Z] must remain case-sensitive to require a capital letter at the start
    pattern = (
        r"([A-Z][A-Za-z''\-]+(?:\s+[A-Za-z''\-]+)*\s+(?i:" + LANDMARK_TYPES_PATTERN + r"))"
    )
    matches = re.findall(pattern, text)

    # Articles to exclude - these are handled by extract_the_landmark_pattern
    articles = {"the", "a", "an", "this", "that"}

    landmarks = []
    for match in matches:
        cleaned = match.strip()
        # Skip if starts with an article (e.g., "The Temple" should be handled by the_landmark_pattern)
        first_word = cleaned.split()[0].lower() if cleaned else ""
        if first_word in articles:
            continue
        if len(cleaned) >= 5:  # Minimum "X temple" = 7 chars, but be lenient
            landmarks.append(cleaned)

    return landmarks


def extract_the_landmark_pattern(text: str) -> list[str]:
    """Extract 'the [Landmark]' patterns.

    Many landmarks are referenced as "the Temple of Poseidon", "the Colosseum".

    Args:
        text: Title or caption text to search

    Returns:
        List of landmark names found (without "the" prefix)
    """
    if not text:
        return []

    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    # Pattern: "the" followed by capitalized phrase
    # Note: We require at least 2 words or 8+ chars to avoid nicknames like "the Tanner"
    pattern = r"\b[Tt]he\s+([A-Z][A-Za-z\s''\-]{2,40})"
    matches = re.findall(pattern, text)

    # Single words that are likely nicknames/titles, not places
    nickname_words = {
        "tanner",
        "baker",
        "builder",
        "maker",
        "hunter",
        "smith",
        "great",
        "wise",
        "elder",
        "younger",
        "baptist",
        "apostle",
    }

    landmarks = []
    for match in matches:
        cleaned = match.strip()
        # Remove trailing punctuation
        cleaned = re.sub(r"[,.:;!?\-]+$", "", cleaned).strip()

        # Skip short single-word matches - likely nicknames like "the Tanner"
        # Landmarks are typically multi-word ("Temple of Poseidon") or long ("Colosseum")
        words = cleaned.split()
        if len(words) == 1:
            if len(cleaned) < 8 or cleaned.lower() in nickname_words:
                continue

        if len(cleaned) >= 3:
            landmarks.append(cleaned)

    return landmarks


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
    1b. Flag emoji locations (🇴🇲) - country flag + place name
    2. "Location:" prefix patterns - explicit user labeling
    3. Country-prefixed places ("Oman - Wadi Shab")
    4. Landmark patterns ("Karnak temple", "the Temple of Poseidon")
    5. Quoted/parenthetical text
    6. Location indicator patterns ("at X", "in Y")
    7. Proper noun phrases
    8. Hashtags and mentions

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

    # Combine text for patterns that work on both
    combined_text = " ".join(filter(None, [title, caption]))

    # PRIORITY 1: Extract locations marked with 📍 or other location emojis
    # This is the most reliable signal as users explicitly mark places this way
    # Check caption first (user's own text), then title
    if caption:
        emoji_locations = extract_emoji_locations(caption)
        candidates.extend(emoji_locations)

    if title:
        emoji_locations = extract_emoji_locations(title)
        candidates.extend(emoji_locations)

    # PRIORITY 1b: Extract flag emoji locations (e.g., "🇴🇲 Wadi Shab")
    if caption:
        flag_places, _ = extract_flag_emoji_locations(caption)
        candidates.extend(flag_places)
    if title:
        flag_places, _ = extract_flag_emoji_locations(title)
        candidates.extend(flag_places)

    # PRIORITY 2: Extract "Location:" prefix patterns (explicit user labeling)
    if caption:
        location_prefix_places = extract_location_prefix_places(caption)
        candidates.extend(location_prefix_places)
    if title:
        location_prefix_places = extract_location_prefix_places(title)
        candidates.extend(location_prefix_places)

    # PRIORITY 3: Extract country-prefixed places ("Oman - Wadi Shab", "Egypt: Karnak")
    country_prefixed = extract_country_prefixed_places(combined_text)
    candidates.extend(country_prefixed)

    # PRIORITY 4a: Extract "the [Landmark]" patterns (e.g., "the Temple of Poseidon")
    # These are high-value because "the" typically precedes famous landmarks
    if title:
        the_landmarks = extract_the_landmark_pattern(title)
        candidates.extend(the_landmarks)
    if caption:
        the_landmarks = extract_the_landmark_pattern(caption)
        candidates.extend(the_landmarks)

    # PRIORITY 4b: Extract "ProperNoun + landmark_type" patterns (e.g., "Karnak temple")
    if title:
        landmark_matches = extract_landmark_patterns(title)
        candidates.extend(landmark_matches)
    if caption:
        landmark_matches = extract_landmark_patterns(caption)
        candidates.extend(landmark_matches)

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
