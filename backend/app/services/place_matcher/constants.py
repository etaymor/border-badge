"""Constants for place matching operations."""

from enum import Enum

from app.services.photo_vision.constants import VISION_TO_PLACE_TYPES

# Concurrency limit for parallel Places API calls
MAX_CONCURRENT_PLACES_REQUESTS = 5

# Maximum length for place names/addresses (defense against absurdly long strings)
MAX_PLACE_NAME_LENGTH = 200
MAX_ADDRESS_LENGTH = 500

# Google Places API endpoints (New API v1)
NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby"
TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
# Place Details base; append "/{place_id}" to fetch a single place.
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places"

# Configuration
SEARCH_RADII_METERS = [
    15,
    50,
    125,
]  # Tiered: start tight for dense cities, widen if empty
MAX_PLACES_PER_SEARCH = 10
MAX_SUGGESTIONS_PER_CLUSTER = 3  # Top 3 by distance
# Note: Timeout is configurable via PLACES_API_TIMEOUT_SECONDS env var (see config.py)


# ============================================================================
# Density Detection
# ============================================================================


class DensityLevel(Enum):
    DENSE = "dense"
    MEDIUM = "medium"
    SPARSE = "sparse"


# Thresholds calibrated for type-filtered results (49 SEARCHABLE_PLACE_TYPES)
DENSITY_THRESHOLD_DENSE = 3  # 3+ results at first radius = dense
DENSITY_THRESHOLD_MEDIUM = 1  # 1-2 results = medium

# Density-adaptive search radii
# Sparse drops the 25m tier: it nearly duplicates the 15m probe's coverage and
# in empty areas it was a guaranteed wasted paid call before the useful radii.
DENSITY_SEARCH_RADII: dict[str, list[int]] = {
    "dense": [15, 35, 75],
    "medium": [15, 50, 125],
    "sparse": [100, 250],
}

# Tiered search keeps expanding until it has accumulated at least this many
# quality candidates (union across tiers, deduped) or runs out of radii. A bare
# "first radius with any hit" stop created a hard recall ceiling: with 20-80m of
# indoor GPS drift, the place actually visited often sits one tier out while a
# single nearer place satisfied the probe — and ranking can never recover a
# candidate that was never fetched.
MIN_QUALITY_RESULTS_BEFORE_STOP = 5


# ============================================================================
# Tourist Relevance Filter
# ============================================================================

# Hard filter: these place types are removed entirely before ranking.
# Our includedTypes in the API request already acts as allowlist (49 tourist types).
# This blocklist catches types that appear via secondary type tagging.
NON_TOURIST_TYPES: set[str] = {
    # Services
    "laundry",
    "dry_cleaner",
    "gas_station",
    "car_wash",
    "car_repair",
    "bank",
    "atm",
    "post_office",
    "local_government_office",
    "storage",
    # Medical (non-emergency)
    "doctor",
    "dentist",
    "pharmacy",
    # Professional offices
    "real_estate_agency",
    "insurance_agency",
    "accounting",
    "lawyer",
    # Parking
    "parking",
}


# ============================================================================
# Enhanced Ranking Constants
# ============================================================================

# Bayesian-adjusted rating (IMDB-style shrinkage estimator)
BAYESIAN_PRIOR_MEAN = 3.8  # Approximate global mean Google rating
BAYESIAN_CONFIDENCE = 50  # ~25th percentile of review counts in typical results

# Continuous fame bonus (replaces hard 1000-review threshold)
FAME_FLOOR_REVIEWS = 50  # Below this: no fame bonus
FAME_SCALE = 0.5  # Controls magnitude

# Dwell-tiered time bonus (stronger signal than time-of-day)
DWELL_BONUS_TIERS: list[tuple[float, float, float]] = [
    # (min_minutes, max_minutes, bonus)
    (120, float("inf"), 0.8),  # Long visit: strong attraction signal
    (60, 120, 0.5),  # Medium-long visit
    (20, 60, 0.3),  # Typical meal/quick attraction
    (0, 20, 0.2),  # Very short stop
]


# ============================================================================
# Time Hint Category Mappings
# ============================================================================

# Maps time_hint values to Google Places types that are boosted (soft bonus).
# Reuses VISION_TO_PLACE_TYPES where categories overlap to avoid duplication.
TIME_HINT_TYPE_MATCHES: dict[str, set[str]] = {
    "food": VISION_TO_PLACE_TYPES["food"]
    | {
        # Additional cuisine-specific types not in vision mapping
        "chinese_restaurant",
        "vietnamese_restaurant",
        "korean_restaurant",
        "greek_restaurant",
        "american_restaurant",
        "middle_eastern_restaurant",
        "spanish_restaurant",
        "turkish_restaurant",
        "ramen_restaurant",
    },
    "attraction": VISION_TO_PLACE_TYPES["landmark"]
    | VISION_TO_PLACE_TYPES["nature"]
    | {
        "amusement_park",
        "aquarium",
        "zoo",
    },
    "nightlife": VISION_TO_PLACE_TYPES["nightlife"],
    "quick_stop": {
        "cafe",
        "coffee_shop",
        "bakery",
        "ice_cream_shop",
        "market",
        "store",
        "shopping_mall",
    },
}

# Place types to search for in Nearby Search API (Table A types only)
# See: https://developers.google.com/maps/documentation/places/web-service/place-types#table-a
# Curated for travel recommendations - max 50 types allowed per API request
SEARCHABLE_PLACE_TYPES: list[str] = [
    # Food & Drink - Core (7)
    "restaurant",
    "cafe",
    "coffee_shop",
    "bar",
    "bakery",
    "fine_dining_restaurant",
    "seafood_restaurant",
    # Food & Drink - Popular cuisines (10)
    "italian_restaurant",
    "french_restaurant",
    "japanese_restaurant",
    "sushi_restaurant",
    "thai_restaurant",
    "indian_restaurant",
    "mexican_restaurant",
    "mediterranean_restaurant",
    "steak_house",
    "pizza_restaurant",
    # Food & Drink - Casual (3)
    "ice_cream_shop",
    "wine_bar",
    "pub",
    # Lodging (3)
    "hotel",
    "resort_hotel",
    "lodging",
    # Culture & Attractions (7)
    "museum",
    "art_gallery",
    "historical_landmark",
    "monument",
    "performing_arts_theater",
    "tourist_attraction",
    "cultural_landmark",
    # Entertainment & Recreation (13)
    "amusement_park",
    "aquarium",
    "zoo",
    "botanical_garden",
    "national_park",
    "park",
    "beach",
    "hiking_area",
    "ski_resort",
    "marina",
    "observation_deck",
    "garden",
    "wildlife_park",
    # Nightlife & Wellness (3)
    "spa",
    "night_club",
    "casino",
    # Shopping (3)
    "market",
    "store",
    "shopping_mall",
    # Note: place_of_worship is NOT supported by Nearby Search API (Table A)
    # Religious sites are typically tagged as tourist_attraction or historical_landmark
]  # Total: 49 types

# Place type to entry category mapping (includes types returned by API)
TYPE_TO_CATEGORY: dict[str, str] = {
    # Food & Drink
    "restaurant": "food",
    "cafe": "food",
    "coffee_shop": "food",
    "bar": "food",
    "bakery": "food",
    "fast_food_restaurant": "food",
    "fine_dining_restaurant": "food",
    "breakfast_restaurant": "food",
    "brunch_restaurant": "food",
    "ice_cream_shop": "food",
    "pizza_restaurant": "food",
    "seafood_restaurant": "food",
    "steak_house": "food",
    "sushi_restaurant": "food",
    "japanese_restaurant": "food",
    "italian_restaurant": "food",
    "chinese_restaurant": "food",
    "indian_restaurant": "food",
    "mexican_restaurant": "food",
    "thai_restaurant": "food",
    "vietnamese_restaurant": "food",
    "korean_restaurant": "food",
    "greek_restaurant": "food",
    "french_restaurant": "food",
    "american_restaurant": "food",
    "middle_eastern_restaurant": "food",
    "mediterranean_restaurant": "food",
    "spanish_restaurant": "food",
    "turkish_restaurant": "food",
    "ramen_restaurant": "food",
    "wine_bar": "food",
    "pub": "food",
    "tea_house": "food",
    # Lodging
    "hotel": "stay",
    "lodging": "stay",
    "motel": "stay",
    "resort_hotel": "stay",
    "extended_stay_hotel": "stay",
    "inn": "stay",
    # Experience - Culture & Attractions
    "museum": "experience",
    "art_gallery": "experience",
    "historical_landmark": "experience",
    "cultural_landmark": "experience",
    "monument": "experience",
    "performing_arts_theater": "experience",
    "tourist_attraction": "experience",
    "visitor_center": "experience",
    # Experience - Entertainment & Recreation
    "amusement_park": "experience",
    "aquarium": "experience",
    "zoo": "experience",
    "botanical_garden": "experience",
    "national_park": "experience",
    "state_park": "experience",
    "park": "experience",
    "beach": "experience",
    "hiking_area": "experience",
    "ski_resort": "experience",
    "marina": "experience",
    "water_park": "experience",
    "wildlife_park": "experience",
    "observation_deck": "experience",
    "garden": "experience",
    "stadium": "experience",
    # Experience - Wellness & Nightlife
    "spa": "experience",
    "night_club": "experience",
    "casino": "experience",
    "comedy_club": "experience",
    # Shopping
    "market": "experience",
    "store": "experience",
    "shopping_mall": "experience",
    # Religious
    "place_of_worship": "experience",
    "church": "experience",
    "hindu_temple": "experience",
    "mosque": "experience",
    "synagogue": "experience",
    # Generic types returned by API (map to "place" category)
    "point_of_interest": "place",
    "landmark": "place",
    "natural_feature": "place",
    "establishment": "place",
}

# Minimum review count for quality filtering
# Places must have at least this many reviews OR be an institutional type
MIN_REVIEW_COUNT = 5

# Well-known/institutional place types that pass quality filter even without reviews
# These are typically legitimate landmarks, parks, hotels that may have few Google reviews
INSTITUTIONAL_TYPES: set[str] = {
    "museum",
    "national_park",
    "state_park",
    "historical_landmark",
    "cultural_landmark",
    "monument",
    "hotel",
    "resort_hotel",
    "airport",
    "train_station",
    "university",
    "hospital",
    "place_of_worship",
    "embassy",
    "zoo",
    "aquarium",
    "botanical_garden",
    "stadium",
}

# Field mask for the WIDE Nearby/Text Search pass.
#
# Cost: the New Places API bills the WHOLE call at the most expensive tier of any
# requested field. ``rating``/``userRatingCount`` are Enterprise-tier ($35/1k),
# so requesting them on the bulk multi-tier search (up to 4 calls/cluster) forced
# every Nearby/Text Search to the Enterprise SKU. Dropping them keeps the wide
# pass at the Pro tier ($32/1k, with the monthly free cap at 5,000 instead of
# 1,000). ``businessStatus`` stays so the permanently-closed filter still works.
#
# The rating signals ride only on the handful of finalists via ENRICH_FIELD_MASK.
WIDE_FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.types",
        "places.primaryType",
        "places.businessStatus",
    ]
)

# Place Details field mask used to enrich the top finalists with the live rating
# signals the ranking needs. Requested per-place only for surfaced candidates.
ENRICH_FIELD_MASK = "id,rating,userRatingCount"
