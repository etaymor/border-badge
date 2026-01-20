"""Constants for place matching operations."""

# Concurrency limit for parallel Places API calls
MAX_CONCURRENT_PLACES_REQUESTS = 5

# Maximum length for place names/addresses (defense against absurdly long strings)
MAX_PLACE_NAME_LENGTH = 200
MAX_ADDRESS_LENGTH = 500

# Google Places API endpoint (New API v1)
NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby"

# Configuration
SEARCH_RADII_METERS = [
    10,
    30,
    75,
]  # Tiered: start tight for dense cities, widen if empty
MAX_PLACES_PER_SEARCH = 10
MAX_SUGGESTIONS_PER_CLUSTER = 3  # Top 3 by distance
# Note: Timeout is configurable via PLACES_API_TIMEOUT_SECONDS env var (see config.py)

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
    # Religious (1)
    "place_of_worship",
]  # Total: 50 types

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

# Minimal field mask to reduce API costs (Essentials tier)
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.types",
        "places.primaryType",
    ]
)
