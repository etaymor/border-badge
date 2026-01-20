"""Place matcher service for photo-to-place suggestions.

Matches photo GPS clusters to nearby places using Google Places Nearby Search API.
Uses tiered radius search (10m → 30m → 75m) for optimal precision.
"""

from .cache import PlacesCache, places_cache
from .constants import (
    FIELD_MASK,
    MAX_ADDRESS_LENGTH,
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_PLACE_NAME_LENGTH,
    MAX_PLACES_PER_SEARCH,
    MAX_SUGGESTIONS_PER_CLUSTER,
    NEARBY_SEARCH_URL,
    SEARCH_RADII_METERS,
    SEARCHABLE_PLACE_TYPES,
    TYPE_TO_CATEGORY,
)
from .exceptions import (
    ConfigurationError,
    PlaceMatcherError,
    QuotaExhaustedError,
    RateLimitError,
)
from .matcher import PlaceMatcher
from .utils import haversine, sanitize_address, sanitize_place_name, sanitize_place_text

__all__ = [
    # Main class
    "PlaceMatcher",
    # Cache
    "PlacesCache",
    "places_cache",
    # Exceptions
    "PlaceMatcherError",
    "RateLimitError",
    "QuotaExhaustedError",
    "ConfigurationError",
    # Constants
    "TYPE_TO_CATEGORY",
    "SEARCHABLE_PLACE_TYPES",
    "SEARCH_RADII_METERS",
    "MAX_PLACES_PER_SEARCH",
    "MAX_SUGGESTIONS_PER_CLUSTER",
    "MAX_CONCURRENT_PLACES_REQUESTS",
    "MAX_PLACE_NAME_LENGTH",
    "MAX_ADDRESS_LENGTH",
    "NEARBY_SEARCH_URL",
    "FIELD_MASK",
    # Utils
    "sanitize_place_text",
    "sanitize_place_name",
    "sanitize_address",
    "haversine",
]
