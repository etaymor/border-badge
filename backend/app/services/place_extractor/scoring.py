"""Scoring and confidence calculation for place matches.

This module handles calculating confidence scores for place matches
and ranking multiple results to select the best one.
"""

import logging
import unicodedata

from rapidfuzz import fuzz

from app.schemas.social_ingest import DetectedPlace
from app.services.place_extractor.location_hints import LocationHint

logger = logging.getLogger(__name__)

# Common words that don't add meaning for place name matching
# Pre-computed at module level for performance
# NOTE: Geographic terms (lake, beach, island, mount) are intentionally NOT
# included as they're meaningful descriptors (e.g., "Lake Como" vs "Como")
STOPWORDS = frozenset(
    {
        "the",
        "of",
        "and",
        "a",
        "an",
    }
)

# Minimum word length for fuzzy matching (shorter words require exact match)
MIN_FUZZY_WORD_LENGTH: int = 4

# Similarity threshold for fuzzy word matching (0-100)
# Set to 70 to catch common transliterations like "Express" -> "Ekspres" (71.4%)
FUZZY_WORD_THRESHOLD: float = 70.0

# Maximum words to fuzzy match to prevent O(Q×N) explosion
# With 5×5 = 25 max comparisons, this keeps fuzzy matching bounded
# Place names rarely have more than 5 meaningful words anyway
MAX_WORDS_FOR_FUZZY: int = 5

# Maximum allowed word set size before truncation (DoS protection)
# Prevents malicious input with hundreds of words from causing excessive processing
MAX_INPUT_WORD_SIZE: int = 100


def _words_similar(
    word1: str, word2: str, threshold: float = FUZZY_WORD_THRESHOLD
) -> bool:
    """Check if two words are similar using fuzzy matching.

    Uses token_ratio which handles word order differences and extra tokens better
    than simple ratio. For example, "Tokyo Tower" vs "Tower Tokyo" scores 100%.

    Short words (< 4 chars) require exact match to avoid false positives
    like "bar" matching "car" or "the" matching "tea".

    Args:
        word1: First word to compare
        word2: Second word to compare
        threshold: Minimum similarity score (0-100) to consider a match

    Returns:
        True if words are similar enough
    """
    if word1 == word2:
        return True
    # Short words require exact match to avoid false positives
    if len(word1) < MIN_FUZZY_WORD_LENGTH or len(word2) < MIN_FUZZY_WORD_LENGTH:
        return False
    # token_ratio handles word order and extra tokens better for place names
    return fuzz.token_ratio(word1, word2) >= threshold


def _calculate_word_overlap(query_words: set[str], name_words: set[str]) -> int:
    """Calculate fuzzy word overlap between query and place name.

    Each query word is checked against all name words for fuzzy similarity.
    This handles transliteration differences like "Express" vs "Ekspres".

    Optimized with:
    1. Input validation: empty sets return 0, oversized sets are truncated
    2. Early exit: exact matches checked first via set intersection O(min(Q,N))
    3. Word limit: fuzzy matching capped at MAX_WORDS_FOR_FUZZY per side to
       prevent O(Q×N) explosion with very long names

    Args:
        query_words: Set of words from the search query
        name_words: Set of words from the place name

    Returns:
        Number of query words that have a fuzzy match in name words
    """
    # Validate inputs - empty sets have no overlap
    if not query_words or not name_words:
        return 0

    # Guard against excessively large input (DoS protection)
    # This is belt-and-suspenders with MAX_WORDS_FOR_FUZZY limit below
    if len(query_words) > MAX_INPUT_WORD_SIZE or len(name_words) > MAX_INPUT_WORD_SIZE:
        logger.warning(
            "Abnormally large word sets in overlap calculation",
            extra={
                "query_words_count": len(query_words),
                "name_words_count": len(name_words),
            },
        )
        # Truncate to reasonable size before processing
        query_words = set(list(query_words)[:MAX_INPUT_WORD_SIZE])
        name_words = set(list(name_words)[:MAX_INPUT_WORD_SIZE])

    # Fast path: count exact matches via set intersection
    exact_matches = query_words & name_words
    exact_count = len(exact_matches)

    # Only do expensive fuzzy matching for non-exact-match words
    remaining_query_words = query_words - exact_matches
    if not remaining_query_words:
        return exact_count

    # Fuzzy match remaining words (skip name words that were exact matches)
    remaining_name_words = name_words - exact_matches

    # Limit words to prevent quadratic explosion with very long names
    # Use sorted() for deterministic selection across runs
    if len(remaining_query_words) > MAX_WORDS_FOR_FUZZY:
        remaining_query_words = set(sorted(remaining_query_words)[:MAX_WORDS_FOR_FUZZY])
    if len(remaining_name_words) > MAX_WORDS_FOR_FUZZY:
        remaining_name_words = set(sorted(remaining_name_words)[:MAX_WORDS_FOR_FUZZY])

    fuzzy_count = sum(
        1
        for qw in remaining_query_words
        if any(_words_similar(qw, nw) for nw in remaining_name_words)
    )

    return exact_count + fuzzy_count


def normalize_for_comparison(text: str) -> str:
    """Normalize text for comparison by removing diacritics and lowercasing.

    This helps match transliterated names like "Kel Suu" to "Köl-Suu".
    """
    # NFD decomposition separates base characters from combining diacritics
    nfkd = unicodedata.normalize("NFKD", text.lower())
    # Keep only non-combining characters (removes accents, umlauts, etc.)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _normalized_words(text: str) -> set[str]:
    """Extract normalized words from text for comparison.

    Normalizes text (removes diacritics, lowercases), splits on spaces and dashes,
    and removes stopwords.

    Args:
        text: Input text to extract words from

    Returns:
        Set of normalized words with stopwords removed
    """
    normalized = normalize_for_comparison(text)
    words = set(normalized.replace("-", " ").split())
    return words - STOPWORDS


# Place types that are often false matches (e.g., tour agencies matching place names)
LOW_VALUE_PLACE_TYPES = {
    "travel_agency",
    "tour_operator",
    "insurance_agency",
    "real_estate_agency",
    "car_rental",
}

# Place types that are high-value matches (actual destinations)
HIGH_VALUE_PLACE_TYPES = {
    "restaurant",
    "cafe",
    "bar",
    "hotel",
    "lodging",
    "tourist_attraction",
    "museum",
    "park",
    "landmark",
    "natural_feature",
    "point_of_interest",
    "town_square",
    "beach",
    "lake",
    "mountain",
}


def calculate_confidence(
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

    # Also normalize for diacritics (e.g., "Kel Suu" matches "Köl-Suu")
    query_normalized = normalize_for_comparison(query)
    name_normalized = normalize_for_comparison(place_name)

    # Exact match is high confidence
    if query_lower == name_lower or query_normalized == name_normalized:
        confidence = 0.95

    # Query is substring of place name (or vice versa) - check both raw and normalized
    elif (
        query_lower in name_lower
        or name_lower in query_lower
        or query_normalized in name_normalized
        or name_normalized in query_normalized
    ):
        confidence = 0.75

    # Significant word overlap (using normalized words for better matching)
    else:
        # Extract normalized word sets for comparison
        query_words = _normalized_words(query)
        name_words = _normalized_words(place_name)
        # Use fuzzy matching for word overlap to handle transliterations
        # e.g., "Express" matches "Ekspres", "Tower" matches "Tauer"
        overlap = _calculate_word_overlap(query_words, name_words)
        total_words = max(len(query_words), len(name_words), 1)

        # Require at least some word overlap for meaningful confidence
        if overlap == 0:
            confidence = 0.1  # Low confidence for no word match
        else:
            # Scale confidence based on overlap ratio
            # Base of 0.2 + up to 0.55 from overlap ratio
            confidence = 0.2 + 0.55 * (overlap / total_words)

    # Boost for first result (Google's ranking is usually good)
    if is_first_result:
        confidence = min(confidence + 0.1, 1.0)

    return round(confidence, 2)


def score_place_result(
    place: DetectedPlace,
    location_bias: LocationHint | None,
    candidate_idx: int,
) -> float:
    """Score a place result for ranking when selecting the best match.

    Higher scores are better. Factors considered:
    - Base confidence from text matching
    - Country match with location hint (bonus for match, penalty for mismatch)
    - Place type quality (penalty for tour agencies, bonus for actual destinations)
    - Candidate position (slight preference for earlier candidates)

    Args:
        place: The detected place to score
        location_bias: Optional location hint that was used for the search
        candidate_idx: Index of the candidate in the search order (0-based)

    Returns:
        Score value (higher is better, can be negative for poor matches)
    """
    score = place.confidence

    # Country match with location hint: bonus if match, penalty if mismatch
    # Strong penalty for wrong country to prevent matches like "Oman" → place in Sudan
    if location_bias and location_bias.country_code and place.country_code:
        if place.country_code == location_bias.country_code:
            score += 0.25  # Boost for matching expected country
        else:
            score -= 0.25  # Moderate penalty — don't override strong text matches

    # Penalize low-value place types (tour agencies, etc.)
    if place.primary_type and place.primary_type in LOW_VALUE_PLACE_TYPES:
        score -= 0.25

    # Boost high-value place types (restaurants, landmarks, etc.)
    if place.primary_type and place.primary_type in HIGH_VALUE_PLACE_TYPES:
        score += 0.1

    # Slight preference for earlier candidates
    score -= candidate_idx * 0.02

    return score
