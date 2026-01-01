"""Google Places API client for place search and details.

This module provides async functions for interacting with the Google Places API (v1).
"""

import logging
import time

import httpx

from app.core.config import get_settings
from app.services.place_extractor.data import MAJOR_CITIES
from app.services.place_extractor.location_hints import LocationHint

logger = logging.getLogger(__name__)

# Google Places API endpoints (New API v1)
PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places"
PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# API timeouts
API_TIMEOUT_SECONDS = 5.0


def is_configured() -> bool:
    """Check if Google Places API is configured with a non-empty key."""
    settings = get_settings()
    key = settings.google_places_api_key
    return bool(key and key.strip())


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
    if not is_configured():
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
        # Google Places API max radius is 50,000 meters (50km)
        # Use smaller radius for cities (more precise), max for countries
        radius = 25000 if location_bias.name in MAJOR_CITIES else 50000
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
                    f"places_autocomplete_error: status={response.status_code} "
                    f"query={query[:50]!r} response={response.text[:300]}"
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
    if not is_configured():
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
