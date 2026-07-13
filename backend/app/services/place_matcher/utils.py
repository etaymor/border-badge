"""Utility functions for place matching operations."""

import math
import re
import unicodedata
from typing import Literal

from .constants import (
    LODGING_MARKETING_TOKENS,
    MAX_ADDRESS_LENGTH,
    MAX_PLACE_NAME_LENGTH,
    NAME_MATCH_MAX_EXTRA_TOKENS,
    NAME_MATCH_STOPWORDS,
)

NameMatchStrength = Literal["strong", "weak", "none"]


def sanitize_place_text(text: str, max_length: int) -> str:
    """
    Sanitize text from external API for safe display.

    Since this is rendered in React Native Text components (not HTML),
    we don't HTML-escape (which would show &amp; literally). We only:
    1. Remove control characters that could cause display issues
    2. Truncate unexpectedly long strings

    Args:
        text: Raw text from external API
        max_length: Maximum allowed length

    Returns:
        Sanitized text safe for display
    """
    if not text:
        return ""

    # Remove control characters (except common whitespace like space, tab, newline)
    sanitized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)

    # Truncate to max length
    if len(sanitized) > max_length:
        sanitized = sanitized[: max_length - 3] + "..."

    return sanitized.strip()


def sanitize_place_name(text: str) -> str:
    """Sanitize a place name for display."""
    return sanitize_place_text(text, MAX_PLACE_NAME_LENGTH)


def sanitize_address(text: str) -> str:
    """Sanitize an address for display."""
    return sanitize_place_text(text, MAX_ADDRESS_LENGTH)


def _normalize_name(text: str) -> str:
    """Lowercase, fold accents, strip punctuation, and collapse whitespace.

    Accent folding (NFKD + drop combining marks) lets unaccented OCR match
    accented display names ("Pantheon" vs "Panthéon") and vice versa.
    """
    decomposed = unicodedata.normalize("NFKD", text.lower())
    folded = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = re.sub(r"[^\w\s]", " ", folded)
    return " ".join(cleaned.split())


def _significant_tokens(normalized: str) -> list[str]:
    """Tokenize a normalized name, dropping article/particle stopwords."""
    return [t for t in normalized.split() if t not in NAME_MATCH_STOPWORDS]


def _contains_token_run(haystack: list[str], needle: list[str]) -> bool:
    """Whether ``needle`` appears as a contiguous token run inside ``haystack``."""
    if not needle or len(needle) > len(haystack):
        return False
    return any(
        haystack[i : i + len(needle)] == needle
        for i in range(len(haystack) - len(needle) + 1)
    )


def name_match_strength(place_name: str, candidate: str) -> NameMatchStrength:
    """Tiered match between a place's display name and a detected signage name.

    - ``strong``: the two names denote the SAME venue — token-sequence equality,
      or a brand-prefix match where one token sequence starts the other with at
      most ``NAME_MATCH_MAX_EXTRA_TOKENS`` extra trailing tokens, none of which
      is short-term-rental marketing vocabulary or contains a digit
      ("Blue Bottle" ⊑ "Blue Bottle Coffee Omotesando").
    - ``weak``: the detected name appears inside a longer, DIFFERENT name as a
      whole-token run ("Eiffel Tower" inside "Gorgeous 3 Bedroom Flat at Eiffel
      Tower - Apartment", "Musée d'Orsay" inside "Batobus- Musée d'Orsay").
      Suggestive, but not evidence the place IS the detected venue.
    - ``none``: no whole-token relationship. Partial-word coincidences
      ("Roma" ⊂ "Trattoria Romano") land here by construction.

    Only ``strong`` may drive high-stakes decisions (the dominant ranking
    bonus, the enrichment-skip lock, Text-Search suppression); the Paris
    import showed containment alone misawards all three to lodging listings
    named after nearby landmarks.
    """
    if not place_name or not candidate:
        return "none"
    name = _normalize_name(place_name)
    cand = _normalize_name(candidate)
    if not name or not cand or len(cand) < 3:
        return "none"

    name_tokens = _significant_tokens(name)
    cand_tokens = _significant_tokens(cand)
    if not name_tokens or not cand_tokens:
        # All-stopword name(s): fall back to whole-string equality.
        return "strong" if name == cand else "none"

    if name_tokens == cand_tokens:
        return "strong"

    shorter, longer = sorted([name_tokens, cand_tokens], key=len)
    if longer[: len(shorter)] == shorter:
        extra = longer[len(shorter) :]
        extra_is_venue_suffix = len(extra) <= NAME_MATCH_MAX_EXTRA_TOKENS and not any(
            t in LODGING_MARKETING_TOKENS or any(c.isdigit() for c in t) for t in extra
        )
        if extra_is_venue_suffix:
            return "strong"
        return "weak"

    if _contains_token_run(longer, shorter):
        return "weak"

    # Space-less scripts (CJK) never tokenize; fall back to raw containment,
    # capped at weak — token evidence is unavailable. Latin text must NOT take
    # this path or partial-word coincidences ("Roma" ⊂ "Romano") would match.
    def _is_spaceless_script(s: str) -> bool:
        return " " not in s and not any(c.isascii() and c.isalpha() for c in s)

    if (_is_spaceless_script(name) or _is_spaceless_script(cand)) and (
        cand in name or name in cand
    ):
        return "weak"

    return "none"


def name_matches_candidate(place_name: str, candidate: str) -> bool:
    """Boolean view of :func:`name_match_strength` (weak or strong).

    Kept for callers where any whole-token relationship is signal enough
    (diagnostic traces, eval tooling). Decision points that must not fire on
    containment coincidences use :func:`name_match_strength` directly.
    """
    return name_match_strength(place_name, candidate) != "none"


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance in meters between two coordinates using Haversine formula.

    Args:
        lat1, lon1: First coordinate
        lat2, lon2: Second coordinate

    Returns:
        Distance in meters, or infinity if coordinates are invalid
    """
    # Validate coordinate bounds (defense in depth - Pydantic validates inputs
    # but this prevents nonsense results from edge cases or data corruption)
    if not (-90 <= lat1 <= 90 and -90 <= lat2 <= 90):
        return float("inf")
    if not (-180 <= lon1 <= 180 and -180 <= lon2 <= 180):
        return float("inf")

    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c
