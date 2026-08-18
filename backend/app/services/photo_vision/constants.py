"""Constants for photo vision classification."""

# Vision categories optimized for travel photo classification.
# These 8 categories map directly to the place types returned by Google Places
# Nearby Search (see VISION_TO_PLACE_TYPES below), enabling the matcher to
# boost places whose type matches the visual content. "transport" and "unknown"
# have no place-type mapping and act as fallback/no-signal categories.
VISION_CATEGORIES: set[str] = {
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
VISION_CONFIDENCE_LEVELS: set[str] = {"high", "medium", "low"}

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
                "landmark_name": {
                    "type": "string",
                    "description": (
                        "Common name of the famous landmark shown, if you "
                        "recognize one visually (e.g. 'Eiffel Tower'). Empty "
                        "string if none."
                    ),
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
                "landmark_name",
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
Prioritize the name of the establishment the photo was taken AT (storefront sign, awning, menu header, receipt) over background or ambient text, and list it first.
If text is in a non-Latin script, include BOTH the original text and its romanized (Latin-alphabet) transliteration as separate entries.
If the photo shows a famous landmark you recognize visually, give its common name in landmark_name (e.g. "Eiffel Tower"); otherwise leave it empty.
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

# Venue-category nouns that are generic when they appear ALONE on signage
# ("RESTAURANT", "CAFE", "BAR" neon signs). They block single-word business-name
# candidates only — multi-word phrases like "Hotel Okura" must keep qualifying,
# so these deliberately do NOT live in GENERIC_TEXT_WORDS (whose per-word check
# rejects whole phrases).
GENERIC_VENUE_WORDS: set[str] = {
    "restaurant",
    "cafe",
    "café",
    "coffee",
    "espresso",
    "bar",
    "pub",
    "hotel",
    "hostel",
    "motel",
    "museum",
    "gallery",
    "park",
    "beach",
    "market",
    "shop",
    "store",
    "bakery",
    "grill",
    "diner",
    "bistro",
    "pizzeria",
    "pizza",
    "ramen",
    "sushi",
    "tacos",
    "beer",
    "wine",
    "cocktails",
    "drinks",
    "food",
    "kitchen",
    "spa",
    "casino",
    "club",
    "lounge",
    "temple",
    "shrine",
    "church",
    "breakfast",
    "lunch",
    "dinner",
    # Non-English venue generics — a Paris import produced single-word OCR
    # candidates like 'MUSÉE' that suppressed the useful Text Search. These
    # block SINGLE-word candidates only; "Musée d'Orsay" keeps qualifying.
    "musée",
    "musee",
    "église",
    "eglise",
    "plage",
    "jardin",
    "marché",
    "marche",
    "boulangerie",
    "brasserie",
    "gare",
    "pont",
    "museo",
    "iglesia",
    "playa",
    "jardín",
    "mercado",
    "chiesa",
    "spiaggia",
    "giardino",
    "mercato",
    "kirche",
    "markt",
    "strand",
    "praia",
    "igreja",
}


# ---------------------------------------------------------------------------
# Vision-null outcome vocabulary
# ---------------------------------------------------------------------------
# Lives here rather than in place_matcher.instrumentation so that the vision
# classifier can name its own failure modes without importing the matcher.
# That import closed a cycle (photo_vision -> place_matcher -> photo_vision)
# which broke every entry point that reached photo_vision first.
# instrumentation.py re-exports these, so its public API is unchanged.
# U12 vision-null outcomes. A classification that returns nothing costs the
# cluster its business-name and landmark signals and drops it back to a
# distance-ranked result — a silent degradation that a bare null COUNT cannot
# explain. These say WHY the null happened, so a rise after the concurrency
# bound is widened is attributable (timeouts) rather than merely visible.
# Static strings only — no coordinate, cluster id, or place id (R27).
VISION_NULL_TIMEOUT = "timeout"
VISION_NULL_HTTP_ERROR = "http_error"
VISION_NULL_REQUEST_ERROR = "request_error"
VISION_NULL_EMPTY_RESPONSE = "empty_response"
VISION_NULL_NO_API_KEY = "no_api_key"
VISION_NULL_EXCEPTION = "exception"
# Our OWN process-wide vision bound was saturated, so the image was never sent.
# Distinct from `timeout` on purpose: a timeout says the model was slow, this
# says we throttled ourselves. Conflating them would make a self-inflicted
# capacity limit look like an upstream regression on the dashboard.
VISION_NULL_SLOT_UNAVAILABLE = "slot_unavailable"
VISION_NULL_UNKNOWN = "unknown"
VISION_NULL_REASONS: tuple[str, ...] = (
    VISION_NULL_TIMEOUT,
    VISION_NULL_HTTP_ERROR,
    VISION_NULL_REQUEST_ERROR,
    VISION_NULL_EMPTY_RESPONSE,
    VISION_NULL_NO_API_KEY,
    VISION_NULL_EXCEPTION,
    VISION_NULL_SLOT_UNAVAILABLE,
    VISION_NULL_UNKNOWN,
)
