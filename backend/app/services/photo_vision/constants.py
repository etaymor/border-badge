"""Constants for photo vision classification."""

# Valid vision categories
VISION_CATEGORIES = {
    "food",
    "landmark",
    "stay",
    "shopping",
    "nature",
    "nightlife",
    "transport",
    "unknown",
}

# Confidence levels
VISION_CONFIDENCE_LEVELS = {"high", "medium", "low"}

# Map vision categories to Google Places type families for filtering/boosting
VISION_TO_PLACE_TYPES: dict[str, set[str]] = {
    "food": {
        "restaurant",
        "cafe",
        "coffee_shop",
        "bar",
        "bakery",
        "fine_dining_restaurant",
        "seafood_restaurant",
        "steak_house",
        "pizza_restaurant",
        "sushi_restaurant",
        "ice_cream_shop",
        "wine_bar",
        "pub",
        "tea_house",
        "italian_restaurant",
        "french_restaurant",
        "japanese_restaurant",
        "thai_restaurant",
        "indian_restaurant",
        "mexican_restaurant",
        "mediterranean_restaurant",
        "fast_food_restaurant",
        "breakfast_restaurant",
        "brunch_restaurant",
    },
    "landmark": {
        "museum",
        "art_gallery",
        "historical_landmark",
        "monument",
        "tourist_attraction",
        "cultural_landmark",
        "performing_arts_theater",
        "observation_deck",
    },
    "stay": {
        "hotel",
        "lodging",
        "resort_hotel",
        "motel",
        "extended_stay_hotel",
        "inn",
    },
    "shopping": {
        "market",
        "store",
        "shopping_mall",
    },
    "nature": {
        "national_park",
        "park",
        "beach",
        "hiking_area",
        "garden",
        "botanical_garden",
        "wildlife_park",
    },
    "nightlife": {
        "bar",
        "night_club",
        "casino",
        "wine_bar",
        "pub",
        "comedy_club",
    },
}

# OpenRouter structured output schema for classification
CLASSIFICATION_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "photo_classification",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": [
                        "food",
                        "landmark",
                        "stay",
                        "shopping",
                        "nature",
                        "nightlife",
                        "transport",
                        "unknown",
                    ],
                },
                "detected_text": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "All visible text: signs, menus, logos, plaques, building names.",
                },
                "confidence": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation (max 50 words)",
                },
            },
            "required": [
                "category",
                "detected_text",
                "confidence",
                "reasoning",
            ],
            "additionalProperties": False,
        },
    },
}

# System prompt for photo classification
CLASSIFICATION_SYSTEM_PROMPT = """You are a travel photo classifier. Analyze the photo and classify it.

Categories:
- food: Restaurant, cafe, bar, food stall, food close-up
- landmark: Museum, monument, historical site, temple, church, famous building
- stay: Hotel, resort, hostel, accommodation
- shopping: Market, mall, store, souk
- nature: Park, beach, mountain, garden, lake, trail
- nightlife: Bar, club, casino at night
- transport: Airport, train station, transit hub
- unknown: Cannot determine

Also extract ALL visible text (signs, menus, logos, plaques, building names).
Report confidence: high (clear scene), medium (somewhat ambiguous), low (dark/blurry/unclear)."""

CLASSIFICATION_USER_PROMPT = (
    "Classify this travel photo. What category is it and what text is visible?"
)

# Generic text patterns to filter out before triggering text search
GENERIC_TEXT_WORDS: set[str] = {
    "exit",
    "open",
    "closed",
    "welcome",
    "push",
    "pull",
    "enter",
    "restroom",
    "bathroom",
    "wifi",
    "menu",
    "no smoking",
    "caution",
    "danger",
    "stop",
    "free",
    "sale",
    "hours",
}
