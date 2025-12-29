"""Scoring and confidence calculation for place matches.

This module handles calculating confidence scores for place matches
and ranking multiple results to select the best one.
"""

import unicodedata

from rapidfuzz import fuzz

from app.schemas.social_ingest import DetectedPlace
from app.services.place_extractor.location_hints import LocationHint

# Common words that don't add meaning for place name matching
# Pre-computed at module level for performance
STOPWORDS = frozenset(
    {
        "lake",
        "mount",
        "beach",
        "island",
        "the",
        "of",
    }
)

# Minimum word length for fuzzy matching (shorter words require exact match)
MIN_FUZZY_WORD_LENGTH = 4

# Similarity threshold for fuzzy word matching (0-100)
# Set to 70 to catch common transliterations like "Express" -> "Ekspres" (71.4%)
FUZZY_WORD_THRESHOLD = 70.0


def _words_similar(
    word1: str, word2: str, threshold: float = FUZZY_WORD_THRESHOLD
) -> bool:
    """Check if two words are similar using fuzzy matching.

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
    return fuzz.ratio(word1, word2) >= threshold


def _calculate_word_overlap(query_words: set[str], name_words: set[str]) -> int:
    """Calculate fuzzy word overlap between query and place name.

    Each query word is checked against all name words for fuzzy similarity.
    This handles transliteration differences like "Express" vs "Ekspres".

    Args:
        query_words: Set of words from the search query
        name_words: Set of words from the place name

    Returns:
        Number of query words that have a fuzzy match in name words
    """
    return sum(
        1 for qw in query_words if any(_words_similar(qw, nw) for nw in name_words)
    )


def normalize_for_comparison(text: str) -> str:
    """Normalize text for comparison by removing diacritics and lowercasing.

    This helps match transliterated names like "Kel Suu" to "Köl-Suu".
    """
    # NFD decomposition separates base characters from combining diacritics
    nfkd = unicodedata.normalize("NFKD", text.lower())
    # Keep only non-combining characters (removes accents, umlauts, etc.)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


# Confidence thresholds
HIGH_CONFIDENCE_THRESHOLD = 0.8
MEDIUM_CONFIDENCE_THRESHOLD = 0.5

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
        # Split on spaces and dashes for better word matching
        query_words = set(query_normalized.replace("-", " ").split())
        name_words = set(name_normalized.replace("-", " ").split())
        # Remove common words that don't add meaning
        query_words -= STOPWORDS
        name_words -= STOPWORDS
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
    if location_bias and location_bias.country_code and place.country_code:
        if place.country_code == location_bias.country_code:
            score += 0.2  # Boost for matching expected country
        else:
            score -= 0.3  # Strong penalty for wrong country

    # Penalize low-value place types (tour agencies, etc.)
    if place.primary_type and place.primary_type in LOW_VALUE_PLACE_TYPES:
        score -= 0.25

    # Boost high-value place types (restaurants, landmarks, etc.)
    if place.primary_type and place.primary_type in HIGH_VALUE_PLACE_TYPES:
        score += 0.1

    # Slight preference for earlier candidates
    score -= candidate_idx * 0.02

    return score
