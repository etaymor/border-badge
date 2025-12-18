"""Traveler classification endpoint using OpenRouter LLM."""

import json
import logging
import re
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.postgrest import in_list
from app.db.session import get_supabase_client
from app.main import limiter
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

# LLM prompts for classification
SYSTEM_PROMPT = """You are a creative travel personality classifier. You MUST output only valid JSON matching the schema.
Do not include markdown, code fences, or extra keys.
Do not invent countries or facts.
Be creative and specific with traveler_type - make it memorable and fun!"""

USER_PROMPT_TEMPLATE = """Task: Analyze this traveler's visited countries and create a unique traveler identity.

Visited Countries: {countries}
Interest Tags (optional hints): {interest_tags}

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

3. Create a 2-4 word traveler_type that's:
   - Memorable and shareable on social media
   - Reflects the dominant pattern in their travels
   - Title Case, no punctuation

Output ONLY this JSON:
{{
  "traveler_type": "string (2-4 words, Title Case)",
  "signature_country": "string (MUST be from the visited list)",
  "confidence": 0.0,
  "rationale_short": "string (max 18 words)"
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


async def get_rarest_country_code(codes: list[str]) -> str:
    """Find the country with highest rarity_score from the given codes."""
    db = get_supabase_client()
    rows = await db.get(
        "country",
        {
            "code": in_list([c.upper() for c in codes]),
            "select": "code,rarity_score",
            "order": "rarity_score.desc",
            "limit": 1,
        },
    )
    if rows:
        return rows[0]["code"]
    # Fallback to first code if DB query fails
    return codes[0].upper() if codes else "US"


async def call_openrouter_llm(
    countries: list[str], interest_tags: list[str]
) -> dict[str, Any] | None:
    """Call OpenRouter API to classify the traveler. Returns parsed JSON or None on failure."""
    settings = get_settings()

    if not settings.openrouter_api_key:
        logger.warning("OpenRouter API key not configured")
        return None

    user_prompt = USER_PROMPT_TEMPLATE.format(
        countries=json.dumps(countries),
        interest_tags=json.dumps(interest_tags) if interest_tags else "[]",
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

    return {
        "traveler_type": traveler_type,
        "signature_country": signature_country,
        "confidence": conf_value,
        "rationale_short": rationale or "Classification based on travel patterns",
    }


@router.post("/traveler", response_model=TravelerClassificationResponse)
@limiter.limit("10/minute")
async def classify_traveler(
    request: Request,
    data: TravelerClassificationRequest,
    user: CurrentUser,
) -> TravelerClassificationResponse:
    """
    Classify a traveler based on their visited countries.

    Uses an LLM to analyze travel patterns and assign a creative traveler type
    along with a signature country that best represents their travel identity.
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

    # Call LLM
    llm_result = await call_openrouter_llm(country_names, data.interest_tags)

    if llm_result:
        # Validate the response
        validated = validate_llm_response(llm_result, country_names)
        if validated:
            # Convert country name back to code using case-insensitive lookup
            sig_name = validated["signature_country"]
            sig_code = lookup_country_code_case_insensitive(sig_name, name_to_code)

            # Final validation: ensure sig_code is in our valid codes
            if sig_code and sig_code.upper() in valid_codes:
                return TravelerClassificationResponse(
                    traveler_type=validated["traveler_type"],
                    signature_country=sig_code.upper(),
                    confidence=validated["confidence"],
                    rationale_short=validated["rationale_short"],
                )

    # Fallback: use rarest country and generic type
    logger.info("Using fallback classification for user %s", user.id)
    rarest_code = await get_rarest_country_code(valid_codes)

    return TravelerClassificationResponse(
        traveler_type="Global Explorer",
        signature_country=rarest_code,
        confidence=0.3,
        rationale_short="Unique travel experiences across the globe",
    )
