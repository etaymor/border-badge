"""Place extraction from social media content using Google Places API."""

import asyncio
import concurrent.futures
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

import httpx

from app.core.config import get_settings
from app.schemas.social_ingest import DetectedPlace, OEmbedResponse

logger = logging.getLogger(__name__)

# Google Places API endpoints (New API v1)
PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places"
PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# API timeouts
API_TIMEOUT_SECONDS = 5.0

# Input length limits to prevent ReDoS attacks
MAX_TEXT_LENGTH = 5000  # Maximum length of text to process for place extraction

# Regex operation timeout (seconds)
REGEX_TIMEOUT_SECONDS = 2.0

T = TypeVar("T")


def _run_with_timeout(
    func: Callable[[], T], timeout: float = REGEX_TIMEOUT_SECONDS
) -> T:
    """Run a function with a timeout to prevent ReDoS attacks.

    Args:
        func: Function to execute
        timeout: Maximum execution time in seconds

    Returns:
        Function result

    Raises:
        TimeoutError: If function exceeds timeout
    """
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(func)
        try:
            return future.result(timeout=timeout)
        except concurrent.futures.TimeoutError as err:
            logger.warning("regex_timeout: operation exceeded timeout")
            raise TimeoutError("Regex operation timed out") from err


# Confidence thresholds
HIGH_CONFIDENCE_THRESHOLD = 0.8
MEDIUM_CONFIDENCE_THRESHOLD = 0.5


@dataclass
class LocationHint:
    """A location hint extracted from text for biasing place search."""

    name: str  # City or country name
    latitude: float | None = None
    longitude: float | None = None
    country_code: str | None = None


# Major world cities with coordinates for location biasing
# Format: {"city_name": (lat, lng, country_code)}
MAJOR_CITIES: dict[str, tuple[float, float, str]] = {
    # Europe
    "london": (51.5074, -0.1278, "GB"),
    "paris": (48.8566, 2.3522, "FR"),
    "rome": (41.9028, 12.4964, "IT"),
    "barcelona": (41.3851, 2.1734, "ES"),
    "madrid": (40.4168, -3.7038, "ES"),
    "amsterdam": (52.3676, 4.9041, "NL"),
    "berlin": (52.5200, 13.4050, "DE"),
    "munich": (48.1351, 11.5820, "DE"),
    "vienna": (48.2082, 16.3738, "AT"),
    "prague": (50.0755, 14.4378, "CZ"),
    "lisbon": (38.7223, -9.1393, "PT"),
    "dublin": (53.3498, -6.2603, "IE"),
    "copenhagen": (55.6761, 12.5683, "DK"),
    "stockholm": (59.3293, 18.0686, "SE"),
    "oslo": (59.9139, 10.7522, "NO"),
    "helsinki": (60.1699, 24.9384, "FI"),
    "athens": (37.9838, 23.7275, "GR"),
    "istanbul": (41.0082, 28.9784, "TR"),
    "moscow": (55.7558, 37.6173, "RU"),
    "zurich": (47.3769, 8.5417, "CH"),
    "geneva": (46.2044, 6.1432, "CH"),
    "brussels": (50.8503, 4.3517, "BE"),
    "milan": (45.4642, 9.1900, "IT"),
    "florence": (43.7696, 11.2558, "IT"),
    "venice": (45.4408, 12.3155, "IT"),
    "naples": (40.8518, 14.2681, "IT"),
    "edinburgh": (55.9533, -3.1883, "GB"),
    "manchester": (53.4808, -2.2426, "GB"),
    "budapest": (47.4979, 19.0402, "HU"),
    "warsaw": (52.2297, 21.0122, "PL"),
    "krakow": (50.0647, 19.9450, "PL"),
    # Asia
    "tokyo": (35.6762, 139.6503, "JP"),
    "osaka": (34.6937, 135.5023, "JP"),
    "kyoto": (35.0116, 135.7681, "JP"),
    "seoul": (37.5665, 126.9780, "KR"),
    "busan": (35.1796, 129.0756, "KR"),
    "beijing": (39.9042, 116.4074, "CN"),
    "shanghai": (31.2304, 121.4737, "CN"),
    "hong kong": (22.3193, 114.1694, "HK"),
    "taipei": (25.0330, 121.5654, "TW"),
    "singapore": (1.3521, 103.8198, "SG"),
    "bangkok": (13.7563, 100.5018, "TH"),
    "phuket": (7.8804, 98.3923, "TH"),
    "chiang mai": (18.7883, 98.9853, "TH"),
    "hanoi": (21.0278, 105.8342, "VN"),
    "ho chi minh": (10.8231, 106.6297, "VN"),
    "saigon": (10.8231, 106.6297, "VN"),
    "bali": (-8.3405, 115.0920, "ID"),
    "jakarta": (-6.2088, 106.8456, "ID"),
    "kuala lumpur": (3.1390, 101.6869, "MY"),
    "manila": (14.5995, 120.9842, "PH"),
    "mumbai": (19.0760, 72.8777, "IN"),
    "delhi": (28.7041, 77.1025, "IN"),
    "new delhi": (28.6139, 77.2090, "IN"),
    "bangalore": (12.9716, 77.5946, "IN"),
    "dubai": (25.2048, 55.2708, "AE"),
    "abu dhabi": (24.4539, 54.3773, "AE"),
    "tel aviv": (32.0853, 34.7818, "IL"),
    "jerusalem": (31.7683, 35.2137, "IL"),
    "doha": (25.2854, 51.5310, "QA"),
    # Americas
    "new york": (40.7128, -74.0060, "US"),
    "nyc": (40.7128, -74.0060, "US"),
    "los angeles": (34.0522, -118.2437, "US"),
    "la": (34.0522, -118.2437, "US"),
    "san francisco": (37.7749, -122.4194, "US"),
    "sf": (37.7749, -122.4194, "US"),
    "chicago": (41.8781, -87.6298, "US"),
    "miami": (25.7617, -80.1918, "US"),
    "las vegas": (36.1699, -115.1398, "US"),
    "seattle": (47.6062, -122.3321, "US"),
    "boston": (42.3601, -71.0589, "US"),
    "austin": (30.2672, -97.7431, "US"),
    "denver": (39.7392, -104.9903, "US"),
    "nashville": (36.1627, -86.7816, "US"),
    "new orleans": (29.9511, -90.0715, "US"),
    "portland": (45.5152, -122.6784, "US"),
    "san diego": (32.7157, -117.1611, "US"),
    "honolulu": (21.3069, -157.8583, "US"),
    "toronto": (43.6532, -79.3832, "CA"),
    "vancouver": (49.2827, -123.1207, "CA"),
    "montreal": (45.5017, -73.5673, "CA"),
    "mexico city": (19.4326, -99.1332, "MX"),
    "cancun": (21.1619, -86.8515, "MX"),
    "buenos aires": (-34.6037, -58.3816, "AR"),
    "rio de janeiro": (-22.9068, -43.1729, "BR"),
    "sao paulo": (-23.5505, -46.6333, "BR"),
    "lima": (-12.0464, -77.0428, "PE"),
    "bogota": (4.7110, -74.0721, "CO"),
    "medellin": (6.2476, -75.5658, "CO"),
    "cartagena": (10.3910, -75.4794, "CO"),
    "santiago": (-33.4489, -70.6693, "CL"),
    # Africa
    "cairo": (30.0444, 31.2357, "EG"),
    "cape town": (-33.9249, 18.4241, "ZA"),
    "johannesburg": (-26.2041, 28.0473, "ZA"),
    "marrakech": (31.6295, -7.9811, "MA"),
    "casablanca": (33.5731, -7.5898, "MA"),
    "nairobi": (-1.2921, 36.8219, "KE"),
    "lagos": (6.5244, 3.3792, "NG"),
    "accra": (5.6037, -0.1870, "GH"),
    "tunis": (36.8065, 10.1815, "TN"),
    # Oceania
    "sydney": (-33.8688, 151.2093, "AU"),
    "melbourne": (-37.8136, 144.9631, "AU"),
    "brisbane": (-27.4698, 153.0251, "AU"),
    "perth": (-31.9505, 115.8605, "AU"),
    "auckland": (-36.8509, 174.7645, "NZ"),
    "queenstown": (-45.0312, 168.6626, "NZ"),
    "fiji": (-17.7134, 178.0650, "FJ"),
}

# Country name to ISO code and approximate center coordinates
COUNTRIES: dict[str, tuple[float, float, str]] = {
    # Popular travel destinations
    "japan": (36.2048, 138.2529, "JP"),
    "france": (46.2276, 2.2137, "FR"),
    "italy": (41.8719, 12.5674, "IT"),
    "spain": (40.4637, -3.7492, "ES"),
    "germany": (51.1657, 10.4515, "DE"),
    "united kingdom": (55.3781, -3.4360, "GB"),
    "uk": (55.3781, -3.4360, "GB"),
    "england": (52.3555, -1.1743, "GB"),
    "greece": (39.0742, 21.8243, "GR"),
    "portugal": (39.3999, -8.2245, "PT"),
    "netherlands": (52.1326, 5.2913, "NL"),
    "thailand": (15.8700, 100.9925, "TH"),
    "vietnam": (14.0583, 108.2772, "VN"),
    "indonesia": (-0.7893, 113.9213, "ID"),
    "philippines": (12.8797, 121.7740, "PH"),
    "singapore": (1.3521, 103.8198, "SG"),
    "malaysia": (4.2105, 101.9758, "MY"),
    "south korea": (35.9078, 127.7669, "KR"),
    "korea": (35.9078, 127.7669, "KR"),
    "china": (35.8617, 104.1954, "CN"),
    "taiwan": (23.6978, 120.9605, "TW"),
    "india": (20.5937, 78.9629, "IN"),
    "australia": (-25.2744, 133.7751, "AU"),
    "new zealand": (-40.9006, 174.8860, "NZ"),
    "mexico": (23.6345, -102.5528, "MX"),
    "canada": (56.1304, -106.3468, "CA"),
    "brazil": (-14.2350, -51.9253, "BR"),
    "argentina": (-38.4161, -63.6167, "AR"),
    "peru": (-9.1900, -75.0152, "PE"),
    "colombia": (4.5709, -74.2973, "CO"),
    "chile": (-35.6751, -71.5430, "CL"),
    "morocco": (31.7917, -7.0926, "MA"),
    "egypt": (26.8206, 30.8025, "EG"),
    "south africa": (-30.5595, 22.9375, "ZA"),
    "kenya": (-0.0236, 37.9062, "KE"),
    "tanzania": (-6.3690, 34.8888, "TZ"),
    "united arab emirates": (23.4241, 53.8478, "AE"),
    "uae": (23.4241, 53.8478, "AE"),
    "dubai": (25.2048, 55.2708, "AE"),  # City but often used for country
    "qatar": (25.3548, 51.1839, "QA"),
    "turkey": (38.9637, 35.2433, "TR"),
    "israel": (31.0461, 34.8516, "IL"),
    "iceland": (64.9631, -19.0208, "IS"),
    "norway": (60.4720, 8.4689, "NO"),
    "sweden": (60.1282, 18.6435, "SE"),
    "denmark": (56.2639, 9.5018, "DK"),
    "finland": (61.9241, 25.7482, "FI"),
    "ireland": (53.1424, -7.6921, "IE"),
    "scotland": (56.4907, -4.2026, "GB"),
    "switzerland": (46.8182, 8.2275, "CH"),
    "austria": (47.5162, 14.5501, "AT"),
    "czech republic": (49.8175, 15.4730, "CZ"),
    "czechia": (49.8175, 15.4730, "CZ"),
    "poland": (51.9194, 19.1451, "PL"),
    "hungary": (47.1625, 19.5033, "HU"),
    "croatia": (45.1, 15.2, "HR"),
    "russia": (61.5240, 105.3188, "RU"),
    "costa rica": (9.7489, -83.7534, "CR"),
    "cuba": (21.5218, -77.7812, "CU"),
    "jamaica": (18.1096, -77.2975, "JM"),
    "bahamas": (25.0343, -77.3963, "BS"),
    "puerto rico": (18.2208, -66.5901, "PR"),
    "hawaii": (19.8968, -155.5828, "US"),  # State but often searched as destination
    "maldives": (3.2028, 73.2207, "MV"),
    "sri lanka": (7.8731, 80.7718, "LK"),
    "nepal": (28.3949, 84.1240, "NP"),
    "cambodia": (12.5657, 104.9910, "KH"),
    "laos": (19.8563, 102.4955, "LA"),
    "myanmar": (21.9162, 95.9560, "MM"),
    "burma": (21.9162, 95.9560, "MM"),
}

# Common location indicator words to help identify place names in text
LOCATION_INDICATORS = {
    "at",
    "in",
    "visit",
    "visiting",
    "visited",
    "restaurant",
    "cafe",
    "coffee",
    "hotel",
    "beach",
    "bar",
    "club",
    "museum",
    "park",
    "market",
    "shop",
    "store",
    "temple",
    "church",
    "mosque",
    "plaza",
    "square",
    "street",
    "avenue",
    "road",
    "island",
}

# Words to filter out from potential place names
NOISE_WORDS = {
    "the",
    "a",
    "an",
    "this",
    "that",
    "my",
    "your",
    "best",
    "top",
    "amazing",
    "incredible",
    "beautiful",
    "stunning",
    "delicious",
    "yummy",
    "perfect",
    "must",
    "try",
    "check",
    "out",
    "link",
    "bio",
    "fyp",
    "viral",
    "trending",
    "follow",
    "like",
    "share",
    "comment",
}


def _is_configured() -> bool:
    """Check if Google Places API is configured with a non-empty key."""
    settings = get_settings()
    key = settings.google_places_api_key
    return bool(key and key.strip())


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
            f"LOCATION HINTS extracted: {[h.name for h in hints[:3]]} "
            f"from text_len={len(text)}"
        )

    return hints


def extract_place_candidates(
    title: str | None,
    caption: str | None,
    author_name: str | None,
) -> list[str]:
    """Extract potential place name candidates from social media content.

    Uses heuristics to identify likely place names from:
    - Video/post title
    - User caption
    - Author name (sometimes contains location)

    Input is truncated to prevent ReDoS attacks.

    Args:
        title: The video/post title from oEmbed
        caption: User-provided caption when sharing
        author_name: Content creator's name/handle

    Returns:
        List of potential place name candidates, ordered by likelihood
    """
    candidates: list[str] = []

    # Truncate inputs to prevent ReDoS attacks
    if title and len(title) > MAX_TEXT_LENGTH:
        title = title[:MAX_TEXT_LENGTH]
    if caption and len(caption) > MAX_TEXT_LENGTH:
        caption = caption[:MAX_TEXT_LENGTH]
    if author_name and len(author_name) > 500:  # Author names are shorter
        author_name = author_name[:500]

    # Process title - often contains the best place info
    if title:
        # Look for quoted place names
        quoted = re.findall(r'["\']([^"\']{3,50})["\']', title)
        candidates.extend(quoted)

        # Look for location patterns like "at Place Name" or "in City"
        location_matches = re.findall(
            r"\b(?:at|in|visit(?:ing)?)\s+([A-Z][A-Za-z\s&\'-]{2,40})", title
        )
        candidates.extend(location_matches)

        # Look for capitalized multi-word phrases (likely proper nouns/place names)
        proper_nouns = re.findall(r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)", title)
        candidates.extend(proper_nouns)

        # Add the full title as a fallback candidate (cleaned up)
        cleaned_title = _clean_text_for_search(title)
        if cleaned_title and len(cleaned_title) > 3:
            candidates.append(cleaned_title)

    # Process caption
    if caption:
        # Look for hashtag locations (common pattern: #PlaceName)
        hashtag_locations = re.findall(r"#([A-Z][A-Za-z]{2,30})", caption)
        candidates.extend(hashtag_locations)

        # Look for @ mentions that might be place handles
        at_mentions = re.findall(r"@([A-Za-z][A-Za-z0-9_]{2,30})", caption)
        # Filter to likely business names (not personal accounts)
        for mention in at_mentions:
            # Business handles often contain keywords
            lower_mention = mention.lower()
            if any(
                word in lower_mention
                for word in [
                    "restaurant",
                    "cafe",
                    "hotel",
                    "bar",
                    "beach",
                    "resort",
                    "club",
                ]
            ):
                candidates.append(mention.replace("_", " "))

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_candidates: list[str] = []
    for candidate in candidates:
        normalized = candidate.strip().lower()
        if normalized and normalized not in seen and len(normalized) > 2:
            seen.add(normalized)
            unique_candidates.append(candidate.strip())

    return unique_candidates[:10]  # Limit to top 10 candidates


def _clean_text_for_search(text: str) -> str:
    """Clean text for use in place search.

    Removes hashtags, mentions, emojis, and other noise.
    Truncates input to prevent ReDoS attacks and uses timeout for regex ops.

    Args:
        text: Raw text to clean

    Returns:
        Cleaned text suitable for search
    """
    # Truncate to prevent ReDoS attacks on regex operations
    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    def _do_clean() -> str:
        cleaned = text

        # Remove hashtags and mentions
        cleaned = re.sub(r"[#@]\w+", " ", cleaned)

        # Remove URLs
        cleaned = re.sub(r"https?://\S+", " ", cleaned)

        # Remove emojis (basic pattern - character class is efficient)
        cleaned = re.sub(
            r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF\U00002702-\U000027B0\U0001F900-\U0001F9FF]",
            " ",
            cleaned,
        )

        # Remove special characters except basic punctuation
        cleaned = re.sub(r"[^\w\s\'-]", " ", cleaned)

        # Collapse whitespace
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        return cleaned

    try:
        cleaned = _run_with_timeout(_do_clean)
    except TimeoutError:
        # On timeout, return truncated original without regex processing
        logger.warning("clean_text_timeout: returning truncated original")
        cleaned = text[:200].strip()

    # Remove noise words from beginning
    words = cleaned.split()
    while words and words[0].lower() in NOISE_WORDS:
        words.pop(0)

    return " ".join(words)


async def search_places(
    query: str,
    country_code: str | None = None,
    location_bias: LocationHint | None = None,
) -> list[dict]:
    """Search for places using Google Places Autocomplete API.

    Args:
        query: Search query string
        country_code: Optional ISO country code to scope results
        location_bias: Optional location hint to bias results towards a geographic area

    Returns:
        List of place predictions with id, name, address
    """
    if not _is_configured():
        logger.debug("google_places_not_configured: skipping search")
        return []

    if not query or len(query) < 2:
        return []

    settings = get_settings()

    # Don't restrict types - we want to find any kind of place
    # (landmarks, parks, buildings, establishments, etc.)
    body: dict = {
        "input": query,
    }

    if country_code:
        body["includedRegionCodes"] = [country_code.lower()]

    # Add location bias if provided - this tells Google Places to prefer results
    # near this location instead of using IP-based biasing (which would use
    # the user's current location, not where the content was created)
    if location_bias and location_bias.latitude and location_bias.longitude:
        # Use a circle with 50km radius for city-level biasing
        # or 200km for country-level (when we only have country coords)
        radius = 50000 if location_bias.name in MAJOR_CITIES else 200000
        body["locationBias"] = {
            "circle": {
                "center": {
                    "latitude": location_bias.latitude,
                    "longitude": location_bias.longitude,
                },
                "radius": radius,
            }
        }
        logger.info(
            f"PLACES SEARCH with location bias: {location_bias.name} "
            f"({location_bias.latitude}, {location_bias.longitude}), radius={radius}m"
        )

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.post(
                PLACES_AUTOCOMPLETE_URL,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": settings.google_places_api_key,
                },
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code != 200:
                logger.warning(
                    "places_autocomplete_error",
                    extra={
                        "event": "places_error",
                        "query": query[:50],
                        "status_code": response.status_code,
                        "elapsed_ms": round(elapsed_ms, 2),
                    },
                )
                return []

            data = response.json()
            suggestions = data.get("suggestions", [])

            results = []
            for suggestion in suggestions:
                place_prediction = suggestion.get("placePrediction")
                if place_prediction:
                    results.append(
                        {
                            "place_id": place_prediction.get("placeId"),
                            "name": place_prediction.get("structuredFormat", {})
                            .get("mainText", {})
                            .get("text", ""),
                            "address": place_prediction.get("structuredFormat", {})
                            .get("secondaryText", {})
                            .get("text", ""),
                            "description": place_prediction.get("text", {}).get(
                                "text", ""
                            ),
                        }
                    )

            # Log the actual results for debugging
            result_names = [r.get("name", "?") for r in results[:3]]
            logger.info(
                f"PLACES AUTOCOMPLETE query={query!r} -> {len(results)} results: {result_names}"
            )

            return results

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "places_autocomplete_timeout",
            extra={
                "event": "places_error",
                "error_type": "timeout",
                "query": query[:50],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return []

    except (httpx.RequestError, ValueError) as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(
            "places_autocomplete_error",
            extra={
                "event": "places_error",
                "error_type": type(e).__name__,
                "query": query[:50],
                "error": str(e)[:200],
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return []


async def get_place_details(place_id: str) -> dict | None:
    """Get detailed information about a place.

    Args:
        place_id: Google Places place ID

    Returns:
        Place details dict, or None on failure
    """
    if not _is_configured():
        return None

    settings = get_settings()
    url = f"{PLACES_DETAILS_URL}/{place_id}"
    logger.info(f"PLACES DETAILS: fetching {url}")

    start_time = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.get(
                url,
                headers={
                    "X-Goog-Api-Key": settings.google_places_api_key,
                    "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents,photos,websiteUri,primaryType,types",
                },
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000

            if response.status_code != 200:
                logger.warning(
                    f"PLACES DETAILS ERROR: status={response.status_code}, "
                    f"place_id={place_id}, response={response.text[:500]}"
                )
                return None

            data = response.json()

            # Extract city and country from address components
            city = None
            country = None
            country_code = None

            for component in data.get("addressComponents", []):
                types = component.get("types", [])
                if "locality" in types:
                    city = component.get("longText")
                elif "country" in types:
                    country = component.get("longText")
                    country_code = component.get("shortText")

            location = data.get("location", {})

            # Get primary type for category inference
            primary_type = data.get("primaryType")
            types = data.get("types", [])

            result = {
                "place_id": data.get("id"),
                "name": data.get("displayName", {}).get("text", ""),
                "address": data.get("formattedAddress"),
                "latitude": location.get("latitude"),
                "longitude": location.get("longitude"),
                "city": city,
                "country": country,
                "country_code": country_code,
                "website": data.get("websiteUri"),
                "photos": data.get("photos", []),
                "primary_type": primary_type,
                "types": types,
            }

            logger.info(
                f"PLACES DETAILS SUCCESS: {result['name']}, country={country_code}, primary_type={primary_type}"
            )

            return result

    except httpx.TimeoutException:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(
            "places_details_timeout",
            extra={
                "event": "places_error",
                "error_type": "timeout",
                "place_id": place_id,
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return None

    except (httpx.RequestError, ValueError) as e:
        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.error(f"PLACES DETAILS EXCEPTION: {type(e).__name__}: {e}")
        return None
    except Exception as e:
        logger.error(f"PLACES DETAILS UNEXPECTED EXCEPTION: {type(e).__name__}: {e}")
        return None


def _calculate_confidence(
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

    # Exact match is high confidence
    if query_lower == name_lower:
        confidence = 0.95

    # Query is substring of place name (or vice versa)
    elif query_lower in name_lower or name_lower in query_lower:
        confidence = 0.75

    # Significant word overlap
    else:
        query_words = set(query_lower.split())
        name_words = set(name_lower.split())
        overlap = len(query_words & name_words)
        total_words = max(len(query_words), len(name_words))
        if total_words > 0:
            confidence = 0.5 * (overlap / total_words)

    # Boost for first result
    if is_first_result:
        confidence = min(confidence + 0.1, 1.0)

    return round(confidence, 2)


async def _try_candidate(
    candidate: str,
    location_bias: LocationHint | None = None,
) -> DetectedPlace | None:
    """Try to resolve a single place candidate.

    Args:
        candidate: Place name candidate to search
        location_bias: Optional location hint to bias search results

    Returns:
        DetectedPlace if found, None otherwise
    """
    results = await search_places(candidate, location_bias=location_bias)

    if not results:
        logger.info(f"_try_candidate: no results for {candidate!r}")
        return None

    # Take the first result
    first_result = results[0]
    place_id = first_result.get("place_id")
    logger.debug(f"_try_candidate: first_result place_id={place_id!r}")

    if not place_id:
        logger.info(f"_try_candidate: no place_id in result for {candidate!r}")
        return None

    # Fetch full details
    details = await get_place_details(place_id)
    logger.debug(f"_try_candidate: got details for place_id={place_id!r}")

    if not details:
        logger.info(f"_try_candidate: get_place_details failed for {place_id!r}")
        return None

    # Calculate confidence
    confidence = _calculate_confidence(
        query=candidate,
        place_name=details.get("name", ""),
        is_first_result=True,
    )

    detected = DetectedPlace(
        google_place_id=details.get("place_id"),
        name=details.get("name", candidate),
        address=details.get("address"),
        latitude=details.get("latitude"),
        longitude=details.get("longitude"),
        city=details.get("city"),
        country=details.get("country"),
        country_code=details.get("country_code"),
        confidence=confidence,
        primary_type=details.get("primary_type"),
        types=details.get("types", []),
    )

    logger.info(
        "place_extraction_success",
        extra={
            "event": "place_extraction",
            "result": "found",
            "query": candidate[:50],
            "place_name": detected.name[:50] if detected.name else None,
            "country_code": detected.country_code,
            "confidence": confidence,
        },
    )

    return detected


# Maximum candidates to try in parallel (limits API calls)
MAX_PARALLEL_CANDIDATES = 5

# Overall timeout for place extraction (seconds)
PLACE_EXTRACTION_TIMEOUT = 10.0


async def _extract_place_impl(
    oembed: OEmbedResponse | None,
    caption: str | None = None,
) -> DetectedPlace | None:
    """Internal implementation of place extraction.

    Args:
        oembed: oEmbed response from the social media provider
        caption: Optional user-provided caption

    Returns:
        DetectedPlace if a place was found, None otherwise
    """
    if not _is_configured():
        logger.debug("place_extraction_skipped: google_places_not_configured")
        return None

    # Extract candidate place names from content
    title = oembed.title if oembed else None
    author_name = oembed.author_name if oembed else None

    candidates = extract_place_candidates(title, caption, author_name)

    if not candidates:
        logger.info(
            "place_extraction_no_candidates",
            extra={
                "event": "place_extraction",
                "result": "no_candidates",
                "title": title[:50] if title else None,
            },
        )
        return None

    # Extract location hints from title and caption to bias the search
    # This helps find places in the right geographic area when the content
    # mentions a city or country (e.g., "Best coffee in Tokyo" -> bias to Tokyo)
    combined_text = " ".join(filter(None, [title, caption]))
    location_hints = extract_location_hints(combined_text)
    location_bias = location_hints[0] if location_hints else None

    # Log candidate count without exposing content (privacy)
    logger.info(
        f"PLACE EXTRACTION: {len(candidates)} candidates from title_len="
        f"{len(title) if title else 0}, location_bias={location_bias.name if location_bias else None}"
    )
    # Log first candidate only (truncated) for debugging - avoid exposing full user content
    if candidates:
        first_candidate = (
            candidates[0][:30] + "..." if len(candidates[0]) > 30 else candidates[0]
        )
        logger.debug(f"PLACE EXTRACTION first candidate: {first_candidate!r}")

    # Try all candidates in parallel for better performance (limited by MAX_PARALLEL_CANDIDATES)
    top_candidates = candidates[:MAX_PARALLEL_CANDIDATES]
    tasks = [_try_candidate(c, location_bias=location_bias) for c in top_candidates]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Return first successful result (order preserved)
    for result in results:
        if result is not None and not isinstance(result, Exception):
            return result

    logger.info(
        "place_extraction_no_match",
        extra={
            "event": "place_extraction",
            "result": "no_match",
            "candidates_tried": len(top_candidates),
        },
    )

    return None


async def extract_place(
    oembed: OEmbedResponse | None,
    caption: str | None = None,
) -> DetectedPlace | None:
    """Extract a place from social media content.

    Attempts to identify and resolve a place from the oEmbed metadata
    and user caption using Google Places API. Tries top candidates in
    parallel for better performance.

    Args:
        oembed: oEmbed response from the social media provider
        caption: Optional user-provided caption

    Returns:
        DetectedPlace if a place was found, None otherwise
    """
    try:
        return await asyncio.wait_for(
            _extract_place_impl(oembed, caption),
            timeout=PLACE_EXTRACTION_TIMEOUT,
        )
    except TimeoutError:
        logger.warning(
            "place_extraction_timeout",
            extra={
                "event": "place_extraction",
                "result": "timeout",
                "timeout_seconds": PLACE_EXTRACTION_TIMEOUT,
            },
        )
        return None
