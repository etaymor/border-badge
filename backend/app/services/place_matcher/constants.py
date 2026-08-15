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
# Retry / rate-limit resilience (U3)
# ============================================================================

# Google's own retry guidance for the Places API: 0.1s initial, doubling, 5s
# ceiling. Three attempts total (the first plus two retries) keeps the worst
# case bounded well inside a cluster's budget.
GOOGLE_RETRY_MAX_ATTEMPTS = 3
GOOGLE_RETRY_INITIAL_DELAY_SECONDS = 0.1
GOOGLE_RETRY_MAX_DELAY_SECONDS = 5.0
# Jitter is NOT in Google's guidance, but synchronized retries across
# concurrently rate-limited clusters are exactly the pattern that guidance
# warns about. Each delay is spread over +/- 50% of its nominal value.
GOOGLE_RETRY_JITTER_RATIO = 0.5

# THE BUDGET SPLIT: retry backoff and the per-cluster timeout are one budget,
# not two. Sleeping between retries may consume at most this fraction of
# `places_cluster_timeout_seconds` across ALL of a cluster's calls (40% => 6s
# of the default 15s), leaving the majority of the budget for outbound work.
RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT = 0.4
# Fallback used only when settings carry no usable per-cluster timeout; mirrors
# the `places_cluster_timeout_seconds` default in app.core.config.
DEFAULT_CLUSTER_TIMEOUT_SECONDS = 15.0

# Process-wide circuit breaker. Under sustained throttling every concurrent
# cluster is an independent retry multiplier, so a shared window of upstream
# 429s short-circuits new attempts for a cooldown instead.
RATE_LIMIT_BREAKER_THRESHOLD = 8
RATE_LIMIT_BREAKER_WINDOW_SECONDS = 10.0
RATE_LIMIT_BREAKER_COOLDOWN_SECONDS = 5.0


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

# Density-adaptive search radii.
# Sparse restores a 50m mid-range tier (C6/U12): the old [100, 250] jumped
# straight from the 15m density probe to 100m, missing a venue at 30-80m in a
# sparse area — a real recall gap with only ~20-80m of typical indoor GPS drift.
# The 50m tier costs one extra Nearby call only in sparse areas where the 15m
# probe already found nothing, so the worst case is a few cents per such cluster.
DENSITY_SEARCH_RADII: dict[str, list[int]] = {
    "dense": [15, 35, 75],
    "medium": [15, 50, 125],
    "sparse": [50, 100, 250],
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
# Name-Match Tiering (U2)
# ============================================================================

# Articles/particles ignored when tokenizing names for matching. Deliberately
# small: only glue words that Google prepends/drops freely ("Le Musée d'Orsay"
# vs "Musée d'Orsay"). Content words must keep distinguishing names.
NAME_MATCH_STOPWORDS: set[str] = {
    "the",
    "le",
    "la",
    "les",
    "l",
    "du",
    "de",
    "des",
    "d",
    "da",
    "el",
    "il",
}

# Short-term-rental marketing vocabulary. A brand-prefix match whose extra
# tokens include any of these is a listing NAMED AFTER the detected venue
# ("Eiffel Tower Apartment"), not the venue itself — cap it at weak.
LODGING_MARKETING_TOKENS: set[str] = {
    "apartment",
    "apartments",
    "appartement",
    "apt",
    "flat",
    "studio",
    "bedroom",
    "bedrooms",
    "br",
    "loft",
    "suite",
    "penthouse",
    "chambre",
    "logement",
    "airbnb",
    "condo",
    "entire",
}

# A brand-prefix match ("Blue Bottle" ⊑ "Blue Bottle Coffee Omotesando") stays
# strong only up to this many extra trailing tokens; beyond that the longer
# name is treated as a different (merely related) venue.
NAME_MATCH_MAX_EXTRA_TOKENS = 2


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
# Curated for travel recommendations - max 50 types allowed per API request.
#
# ``includedTypes`` matches against a place's FULL types array, and every
# cuisine-specific restaurant also carries the umbrella "restaurant" type (same
# for hotel/resort_hotel under "lodging"). The redundant subtypes were removed
# to free slots for whole missing categories — religious sites, wineries,
# plazas, stadiums — each of which was previously unrecallable.
SEARCHABLE_PLACE_TYPES: list[str] = [
    # Food & Drink (11) — "restaurant" covers all cuisine subtypes.
    # food_court swapped out (C5/U15): a niche type rarely logged as the place
    # visited; restaurant/market cover its travel-food cases. Its slot funds a
    # higher-value entertainment/shopping type below.
    "restaurant",
    "cafe",
    "coffee_shop",
    "bar",
    "bakery",
    "ice_cream_shop",
    "wine_bar",
    "pub",
    "dessert_shop",
    "tea_house",
    "winery",
    # Drinks production / tours (2)
    "brewery",
    "vineyard",
    # Lodging (1) — "lodging" covers hotel, resort_hotel, motel, inn, hostel
    "lodging",
    # Culture & Attractions (8)
    "museum",
    "art_gallery",
    "historical_landmark",
    "monument",
    "performing_arts_theater",
    "tourist_attraction",
    "cultural_landmark",
    "visitor_center",
    # Religious sites (4) — place_of_worship is Table B only; concrete types work
    "church",
    "hindu_temple",
    "mosque",
    "synagogue",
    # Entertainment & Recreation (18)
    "amusement_park",
    "aquarium",
    "zoo",
    "botanical_garden",
    "national_park",
    "state_park",
    "park",
    "plaza",
    "beach",
    "hiking_area",
    "ski_resort",
    "marina",
    "observation_deck",
    "garden",
    "wildlife_park",
    "water_park",
    "stadium",
    # comedy_club added (C5/U15): a real nightlife/entertainment venue type with
    # no prior coverage (Table A verified).
    "comedy_club",
    # Nightlife & Wellness (3)
    "spa",
    "night_club",
    "casino",
    # Shopping (3) — "store" swapped for "book_store" (C5/U15): "store" is a
    # generic catch-all that mostly surfaces retail noise (and the quality filter
    # already drops non-tourist stores), whereas iconic bookstores are genuine
    # travel destinations previously only reachable via that noisy generic type.
    "market",
    "book_store",
    "shopping_mall",
]  # Total: 50 types (API maximum)

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
    "food_court": "food",
    "dessert_shop": "food",
    "winery": "food",
    "brewery": "food",
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
    "plaza": "experience",
    "vineyard": "experience",
    # Experience - Wellness & Nightlife
    "spa": "experience",
    "night_club": "experience",
    "casino": "experience",
    "comedy_club": "experience",
    # Shopping
    "market": "experience",
    "store": "experience",
    "book_store": "experience",
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

# Minimum review count for quality filtering (default for
# places_min_review_count; the gate is config-driven, C3/U13).
# Places must have at least this many reviews OR be an institutional type.
# Lowered 5 -> 3: the gate only re-applies to enriched finalists (the wide pass
# omits userRatingCount), then a dropped finalist is backfilled — so the worst
# case at 5 was a small/new real place demoted below a backfill. 3 keeps those
# hidden gems while still rejecting near-zero-review noise.
MIN_REVIEW_COUNT = 3

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
