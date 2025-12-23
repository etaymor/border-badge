"""Traveler classification endpoint using OpenRouter LLM."""

import json
import logging
import random
import re
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import get_settings
from app.core.security import OptionalUser
from app.db.postgrest import in_list
from app.db.session import get_supabase_client
from app.main import get_request_context, limiter
from app.schemas.classification import (
    TravelerClassificationRequest,
    TravelerClassificationResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Regex to strip markdown code fences (handles ```json, ```javascript, etc.)
CODE_FENCE_PATTERN = re.compile(r"^```(?:\w+)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)


def _classification_rate_limit() -> str:
    """Return stricter rate limit for anonymous requests, lenient for authenticated.

    Anonymous users: 5 requests per hour (to protect LLM API costs)
    Authenticated users: 30 requests per minute

    Uses ContextVar to access the current request (set by middleware).
    """
    request = get_request_context()
    if request is None:
        # Fallback to strict limit if no request context (shouldn't happen)
        return "5/hour"

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer ") and len(auth_header) > 7:
        # Has a token - use lenient limit (token validity checked by endpoint)
        return "30/minute"
    # No token - strict limit to prevent LLM API abuse
    return "5/hour"


# LLM prompts for classification
SYSTEM_PROMPT = """You are a creative travel personality classifier. You MUST output only valid JSON matching the schema.
Do not include markdown, code fences, or extra keys.
Do not invent countries or facts.
Be creative and specific with traveler_type - make it memorable and fun!"""

USER_PROMPT_TEMPLATE = """Task: Analyze this traveler's visited countries and create a unique traveler identity.

Visited Countries: {countries}
Interest Tags (optional hints): {interest_tags}
Home Country (do NOT pick as signature): {home_country}

Instructions:
1. Look for PATTERNS in the countries:
   - Are they island-heavy? → "Island Hopper" / "Tropical Soul"
   - Africa-focused? → "Safari Seeker" / "African Explorer"
   - Rare/uncommon destinations? → "Off The Grid" / "Hidden Gem Hunter"
   - European classics? → "Continental Classic" / "Euro Wanderer"
   - Asian adventures? → "Eastern Spirit" / "Orient Express"
   - Mix of everything? → "Global Nomad" / "World Collector"
   - Latin America heavy? → "Salsa Soul" / "Latin Wanderer"

2. Pick the SINGLE country that best represents their travel identity - the one that tells their story.
   IMPORTANT: Do NOT pick the home country as signature country unless it's the ONLY country visited.

3. Create a 2-4 word traveler_type that's:
   - Memorable and shareable on social media
   - Reflects the dominant pattern in their travels
   - Title Case, no punctuation

Output ONLY this JSON:
{{
  "traveler_type": "string (2-4 words, Title Case)",
  "signature_country": "string (MUST be from visited list, NOT home country)",
  "confidence": 0.0,
  "rationale_short": "string (max 100 chars, ~15 words)"
}}"""


async def get_country_names_by_codes(codes: list[str]) -> dict[str, str]:
    """Fetch country names for a list of codes. Returns {code: name} mapping."""
    if not codes:
        return {}
    db = get_supabase_client()
    rows = await db.get(
        "country",
        {
            "code": in_list([c.upper() for c in codes]),
            "select": "code,name",
        },
    )
    return {row["code"]: row["name"] for row in rows}


def lookup_country_code_case_insensitive(
    name_or_code: str, name_to_code: dict[str, str]
) -> str | None:
    """
    Look up a country code from a name or code, case-insensitively.
    Returns the uppercase code if found, None otherwise.
    """
    # Direct lookup first
    if name_or_code in name_to_code:
        return name_to_code[name_or_code]

    # Case-insensitive lookup
    upper_key = name_or_code.upper()
    for name, code in name_to_code.items():
        if name.upper() == upper_key or code.upper() == upper_key:
            return code

    return None


async def get_rarest_country_code(
    codes: list[str], exclude_code: str | None = None
) -> str:
    """Find the country with highest rarity_score from the given codes.

    Args:
        codes: List of country codes to search
        exclude_code: Optional code to exclude (e.g., home country)
    """
    # Filter out excluded code if provided
    search_codes = [c.upper() for c in codes]
    if exclude_code:
        exclude_upper = exclude_code.upper()
        search_codes = [c for c in search_codes if c != exclude_upper]

    # If no codes left after exclusion, use original list (fallback)
    if not search_codes:
        search_codes = [c.upper() for c in codes]

    db = get_supabase_client()
    rows = await db.get(
        "country",
        {
            "code": in_list(search_codes),
            "select": "code,rarity_score",
            "order": "rarity_score.desc",
            "limit": 1,
        },
    )
    if rows:
        return rows[0]["code"]
    # Fallback to first code if DB query fails
    return search_codes[0] if search_codes else "US"


async def get_countries_with_regions(codes: list[str]) -> list[dict[str, Any]]:
    """Fetch countries with their region data for fallback classification."""
    if not codes:
        return []
    db = get_supabase_client()
    return await db.get(
        "country",
        {
            "code": in_list([c.upper() for c in codes]),
            "select": "code,name,region,subregion,rarity_score",
        },
    )


def generate_fallback_traveler_type(countries: list[dict[str, Any]]) -> tuple[str, str]:
    """Generate a creative fallback traveler type based on visited countries.

    Returns (traveler_type, rationale) tuple.
    """
    if not countries:
        return ("Global Explorer", "Ready to discover the world")

    # Count countries per region and subregion
    region_counts: dict[str, int] = {}
    subregion_counts: dict[str, int] = {}

    for c in countries:
        region = c.get("region", "")
        subregion = c.get("subregion", "")
        if region:
            region_counts[region] = region_counts.get(region, 0) + 1
        if subregion:
            subregion_counts[subregion] = subregion_counts.get(subregion, 0) + 1

    total_countries = len(countries)

    # Calculate average rarity
    rarity_scores = [c.get("rarity_score", 0) or 0 for c in countries]
    avg_rarity = sum(rarity_scores) / len(rarity_scores) if rarity_scores else 0

    # Region-based patterns
    region_traveler_types = {
        "Europe": [
            ("Euro Wanderer", "Exploring the continent of castles and culture"),
            ("Continental Classic", "A love affair with European charm"),
            ("Old World Explorer", "Drawn to history and heritage"),
        ],
        "Asia": [
            ("Eastern Spirit", "Finding meaning in the mysteries of the East"),
            ("Orient Express", "Journeying through ancient civilizations"),
            ("Silk Road Traveler", "Following footsteps of ancient traders"),
        ],
        "Africa": [
            ("Safari Seeker", "Chasing sunsets across the savanna"),
            ("African Explorer", "Captivated by the mother continent"),
            ("Wild Heart", "Where adventure meets authenticity"),
        ],
        "Oceania": [
            ("Island Hopper", "Collecting paradise one island at a time"),
            ("Pacific Drifter", "Following the ocean currents"),
            ("Down Under Devotee", "Exploring lands of wonder"),
        ],
        "Americas": [
            ("Americas Adventurer", "From Alaska to Patagonia"),
            ("New World Nomad", "Exploring the lands of opportunity"),
        ],
        "South America": [
            ("Latin Soul", "Dancing through South America"),
            ("Andes Adventurer", "Where mountains meet passion"),
        ],
        "North America": [
            ("North American Nomad", "Coast to coast exploration"),
        ],
        "Caribbean": [
            ("Caribbean Cruiser", "Island vibes and ocean waves"),
            ("Tropical Soul", "Living life in flip flops"),
        ],
    }

    # Check for dominant region (>60% of visited countries)
    for region, count in region_counts.items():
        if count / total_countries >= 0.6:
            types = region_traveler_types.get(region, [])
            if types:
                return random.choice(types)

    # Check for subregion specialization
    subregion_types = {
        "Southeast Asia": [
            ("Southeast Explorer", "Temples, beaches, and street food"),
            ("Backpacker Soul", "Living the Southeast Asia dream"),
        ],
        "Western Europe": [
            ("Western Wanderer", "Classic European adventures"),
        ],
        "Eastern Europe": [
            ("Eastern Explorer", "Discovering hidden European gems"),
        ],
        "Northern Europe": [
            ("Nordic Soul", "Chasing northern lights and fjords"),
        ],
        "Southern Europe": [
            ("Mediterranean Heart", "Sun, sea, and la dolce vita"),
        ],
        "Middle East": [
            ("Desert Wanderer", "Where ancient meets modern"),
        ],
        "Central America": [
            ("Central American Spirit", "Between two great oceans"),
        ],
    }

    for subregion, count in subregion_counts.items():
        if count / total_countries >= 0.5:
            types = subregion_types.get(subregion, [])
            if types:
                return random.choice(types)

    # Check for high rarity (off-the-beaten-path traveler)
    if avg_rarity >= 6:
        return ("Hidden Gem Hunter", "Seeking paths less traveled")
    if avg_rarity >= 4:
        return ("Off The Grid", "Beyond the tourist trail")

    # Check for diversity (many regions = world traveler)
    if len(region_counts) >= 4:
        return ("World Collector", "Stamps from every corner")
    if len(region_counts) >= 3:
        return ("Global Nomad", "Home is wherever you wander")

    # Default fallbacks based on count
    if total_countries >= 20:
        return ("Seasoned Wanderer", "A well-stamped passport tells stories")
    if total_countries >= 10:
        return ("Curious Explorer", "Every journey sparks a new dream")
    if total_countries >= 5:
        return ("Rising Adventurer", "Just getting started")

    return ("World Curious", "The adventure is just beginning")


async def call_openrouter_llm(
    countries: list[str],
    interest_tags: list[str],
    home_country: str | None = None,
) -> dict[str, Any] | None:
    """Call OpenRouter API to classify the traveler. Returns parsed JSON or None on failure."""
    settings = get_settings()

    if not settings.openrouter_api_key:
        logger.warning("OpenRouter API key not configured")
        return None

    user_prompt = USER_PROMPT_TEMPLATE.format(
        countries=json.dumps(countries),
        interest_tags=json.dumps(interest_tags) if interest_tags else "[]",
        home_country=home_country or "None specified",
    )

    payload = {
        "model": settings.openrouter_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 200,
    }

    # SECURITY NOTE: Authorization header contains the OpenRouter API key.
    # Ensure no middleware or logging configuration exposes request headers.
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.base_url,
        "X-Title": "Border Badge",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                OPENROUTER_API_URL, json=payload, headers=headers
            )

        if response.status_code != 200:
            logger.error(
                "OpenRouter API error: status=%d, body=%s",
                response.status_code,
                response.text[:500],
            )
            return None

        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        # Parse JSON from the response content
        # Strip markdown code fences if present (handles ```json, ``` etc.)
        content = content.strip()
        fence_match = CODE_FENCE_PATTERN.match(content)
        if fence_match:
            content = fence_match.group(1).strip()

        return json.loads(content)

    except httpx.TimeoutException:
        logger.warning("OpenRouter API timeout")
        return None
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse LLM response as JSON: %s", e)
        return None
    except Exception as e:
        logger.exception("OpenRouter API call failed: %s", e)
        return None


def validate_llm_response(
    llm_result: dict[str, Any], valid_countries: list[str]
) -> dict[str, Any] | None:
    """Validate the LLM response. Returns validated dict or None if invalid."""
    if not isinstance(llm_result, dict):
        return None

    traveler_type = llm_result.get("traveler_type")
    signature_country = llm_result.get("signature_country")
    confidence = llm_result.get("confidence")
    rationale = llm_result.get("rationale_short")

    # Validate required fields
    if not traveler_type or not isinstance(traveler_type, str):
        return None
    if not signature_country or not isinstance(signature_country, str):
        return None
    if confidence is None:
        confidence = 0.5

    # Validate signature_country is in the provided list
    # Check both the returned name and the code
    valid_names_upper = [c.upper() for c in valid_countries]
    signature_upper = signature_country.upper()

    if signature_upper not in valid_names_upper:
        # LLM returned an invalid country
        logger.warning(
            "LLM returned invalid signature_country: %s (valid: %s)",
            signature_country,
            valid_countries[:5],
        )
        return None

    # Clamp confidence to valid range [0.0, 1.0]
    if isinstance(confidence, (int, float)):  # noqa: UP038
        conf_value = max(0.0, min(1.0, float(confidence)))
    else:
        conf_value = 0.5

    # Truncate rationale to max 100 chars (schema limit)
    rationale_text = rationale or "Classification based on travel patterns"
    if len(rationale_text) > 100:
        rationale_text = rationale_text[:97] + "..."

    return {
        "traveler_type": traveler_type,
        "signature_country": signature_country,
        "confidence": conf_value,
        "rationale_short": rationale_text,
    }


@router.post("/traveler", response_model=TravelerClassificationResponse)
@limiter.limit(_classification_rate_limit)
async def classify_traveler(
    request: Request,
    data: TravelerClassificationRequest,
    user: OptionalUser,
) -> TravelerClassificationResponse:
    """
    Classify a traveler based on their visited countries.

    Uses an LLM to analyze travel patterns and assign a creative traveler type
    along with a signature country that best represents their travel identity.

    Authentication is optional - this endpoint is used during onboarding
    before the user is fully authenticated.
    """
    # Normalize country codes
    country_codes = [c.upper() for c in data.countries_visited]

    # Get country names for LLM (it works better with full names)
    code_to_name = await get_country_names_by_codes(country_codes)

    # Filter to only valid codes that exist in DB
    valid_codes = [c for c in country_codes if c in code_to_name]
    if not valid_codes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid country codes provided",
        )

    # Get country names for LLM prompt
    country_names = [code_to_name[c] for c in valid_codes]

    # Create name to code mapping for reverse lookup
    name_to_code = {v: k for k, v in code_to_name.items()}

    # Validate and get home country name for LLM (if provided)
    home_country_code = data.home_country.upper() if data.home_country else None
    home_country_name = None
    if home_country_code:
        # Fetch home country from DB to validate it exists
        db = get_supabase_client()
        home_country_rows = await db.get(
            "country",
            {"code": f"eq.{home_country_code}", "select": "code,name", "limit": 1},
        )
        if not home_country_rows:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid home country code: {data.home_country}",
            )
        home_country_name = home_country_rows[0]["name"]

    # Call LLM
    llm_result = await call_openrouter_llm(
        country_names, data.interest_tags, home_country_name
    )

    if llm_result:
        logger.debug("LLM result: %s", llm_result)
        # Validate the response
        validated = validate_llm_response(llm_result, country_names)
        if validated:
            # Convert country name back to code using case-insensitive lookup
            sig_name = validated["signature_country"]
            sig_code = lookup_country_code_case_insensitive(sig_name, name_to_code)

            # Check if LLM returned home country as signature (and there are alternatives)
            if (
                sig_code
                and home_country_code
                and sig_code.upper() == home_country_code
                and len(valid_codes) > 1
            ):
                # LLM picked home country despite instruction - use fallback for signature
                logger.info(
                    "LLM picked home country %s as signature, using fallback",
                    home_country_code,
                )
                rarest_code = await get_rarest_country_code(
                    valid_codes, exclude_code=home_country_code
                )
                return TravelerClassificationResponse(
                    traveler_type=validated["traveler_type"],
                    signature_country=rarest_code,
                    confidence=validated["confidence"],
                    rationale_short=validated["rationale_short"],
                )

            # Final validation: ensure sig_code is in our valid codes
            if sig_code and sig_code.upper() in valid_codes:
                return TravelerClassificationResponse(
                    traveler_type=validated["traveler_type"],
                    signature_country=sig_code.upper(),
                    confidence=validated["confidence"],
                    rationale_short=validated["rationale_short"],
                )
        else:
            logger.warning("LLM response validation failed: %s", llm_result)

    # Fallback: use smart pattern-based classification
    logger.info(
        "Using fallback classification for user %s", user.id if user else "anonymous"
    )

    # Get full country data for smart fallback
    countries_data = await get_countries_with_regions(valid_codes)

    # Generate creative traveler type based on patterns
    traveler_type, rationale = generate_fallback_traveler_type(countries_data)

    # Get signature country (rarest, excluding home country if provided)
    # home_country_code was already computed above
    rarest_code = await get_rarest_country_code(
        valid_codes, exclude_code=home_country_code
    )

    # Truncate rationale to max 100 chars (schema limit)
    if len(rationale) > 100:
        rationale = rationale[:97] + "..."

    return TravelerClassificationResponse(
        traveler_type=traveler_type,
        signature_country=rarest_code,
        confidence=0.5,
        rationale_short=rationale,
    )
