"""Location hint extraction and filtering logic.

This module handles extracting geographic hints from text (cities/countries)
and filtering conflicting hints to improve place search accuracy.
"""

import logging
import re
from dataclasses import dataclass

from app.services.place_extractor.data import COUNTRIES, MAJOR_CITIES
from app.services.place_extractor.text_utils import MAX_TEXT_LENGTH

logger = logging.getLogger(__name__)


@dataclass
class LocationHint:
    """A location hint extracted from text for biasing place search."""

    name: str  # City or country name
    latitude: float | None = None
    longitude: float | None = None
    country_code: str | None = None


def filter_conflicting_hints(hints: list[LocationHint]) -> list[LocationHint]:
    """Remove location hints that conflict geographically with the majority.

    When multiple location hints are found from different countries, this function
    identifies the "dominant" country (the one with the most hints) and filters out
    hints from other countries that likely represent false positives (e.g., hashtags
    mentioning random cities like #tokyo in an Albanian post).

    Args:
        hints: List of location hints to filter

    Returns:
        Filtered list keeping only hints from the dominant country/region
    """
    if len(hints) <= 1:
        return hints

    # Group hints by country code
    by_country: dict[str, list[LocationHint]] = {}
    for h in hints:
        if h.country_code:
            by_country.setdefault(h.country_code, []).append(h)

    if not by_country:
        return hints

    # Find the dominant country (most hints)
    dominant_country = max(by_country.keys(), key=lambda c: len(by_country[c]))
    dominant_count = len(by_country[dominant_country])

    # Keep hints from dominant country + any countries with equal representation
    filtered: list[LocationHint] = []
    filtered_out: list[str] = []

    for h in hints:
        country_count = len(by_country.get(h.country_code, []))
        if country_count >= dominant_count:
            filtered.append(h)
        else:
            filtered_out.append(h.name)

    if filtered_out:
        logger.info(
            f"LOCATION HINTS filtered out conflicting: {filtered_out} "
            f"(dominant country: {dominant_country})"
        )

    return filtered if filtered else hints


def extract_location_hints(text: str | None) -> list[LocationHint]:
    """Extract location hints (cities/countries) from text.

    Scans text for known city and country names that can be used to bias
    the Google Places search towards the correct geographic area.

    Args:
        text: Text to scan for location names

    Returns:
        List of LocationHint objects with coordinates for biasing
    """
    if not text:
        return []

    # Truncate to prevent performance issues
    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    text_lower = text.lower()
    hints: list[LocationHint] = []

    # Check for city names first (more specific = higher priority)
    for city_name, (lat, lng, country_code) in MAJOR_CITIES.items():
        # Match whole word only (with word boundaries)
        pattern = r"\b" + re.escape(city_name) + r"\b"
        if re.search(pattern, text_lower):
            hints.append(
                LocationHint(
                    name=city_name,
                    latitude=lat,
                    longitude=lng,
                    country_code=country_code,
                )
            )

    # Check for country names
    for country_name, (lat, lng, country_code) in COUNTRIES.items():
        pattern = r"\b" + re.escape(country_name) + r"\b"
        if re.search(pattern, text_lower):
            # Don't add if we already have a city from this country
            if not any(h.country_code == country_code for h in hints):
                hints.append(
                    LocationHint(
                        name=country_name,
                        latitude=lat,
                        longitude=lng,
                        country_code=country_code,
                    )
                )

    if hints:
        logger.info(
            f"LOCATION HINTS extracted (raw): {[h.name for h in hints]} "
            f"from text_len={len(text)}"
        )
        # Filter out conflicting hints (e.g., #tokyo hashtag in an Albanian post)
        hints = filter_conflicting_hints(hints)

    return hints
