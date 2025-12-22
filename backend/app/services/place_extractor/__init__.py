"""Place extraction from social media content using Google Places API.

This package provides functionality to extract place information from
social media content (TikTok, Instagram, etc.) using the Google Places API.

Usage:
    from app.services.place_extractor import extract_place

    place = await extract_place(oembed_response, user_caption)
    if place:
        print(f"Found: {place.name} in {place.country}")

Package Structure:
    - data/: Location data (cities, countries) organized by region
    - text_utils.py: Text cleaning and processing utilities
    - location_hints.py: Location hint extraction from text
    - candidate_extraction.py: Place name candidate extraction
    - google_places_client.py: Google Places API client
    - scoring.py: Confidence calculation and result scoring
    - extractor.py: Main extraction orchestration
"""

from app.services.place_extractor.candidate_extraction import (
    LOCATION_INDICATORS,
    extract_place_candidates,
)
from app.services.place_extractor.data import COUNTRIES, MAJOR_CITIES
from app.services.place_extractor.extractor import extract_place
from app.services.place_extractor.google_places_client import (
    get_place_details,
    is_configured,
    search_places,
)
from app.services.place_extractor.location_hints import (
    LocationHint,
    extract_location_hints,
    filter_conflicting_hints,
)
from app.services.place_extractor.scoring import (
    HIGH_CONFIDENCE_THRESHOLD,
    HIGH_VALUE_PLACE_TYPES,
    LOW_VALUE_PLACE_TYPES,
    MEDIUM_CONFIDENCE_THRESHOLD,
    calculate_confidence,
    score_place_result,
)
from app.services.place_extractor.text_utils import (
    MAX_TEXT_LENGTH,
    NOISE_WORDS,
    clean_instagram_title,
    clean_text_for_search,
    truncate_text,
)

__all__ = [
    # Main extraction function
    "extract_place",
    # Location data
    "MAJOR_CITIES",
    "COUNTRIES",
    "LocationHint",
    # Candidate extraction
    "extract_place_candidates",
    "LOCATION_INDICATORS",
    # Location hints
    "extract_location_hints",
    "filter_conflicting_hints",
    # Google Places client
    "search_places",
    "get_place_details",
    "is_configured",
    # Scoring
    "calculate_confidence",
    "score_place_result",
    "HIGH_CONFIDENCE_THRESHOLD",
    "MEDIUM_CONFIDENCE_THRESHOLD",
    "HIGH_VALUE_PLACE_TYPES",
    "LOW_VALUE_PLACE_TYPES",
    # Text utilities
    "clean_instagram_title",
    "clean_text_for_search",
    "truncate_text",
    "MAX_TEXT_LENGTH",
    "NOISE_WORDS",
]
