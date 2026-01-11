"""Place endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter  # Shared limiter registered with FastAPI app
from app.schemas.entries import Place
from app.services.place_extractor.google_places_client import (
    is_configured as google_places_configured,
)
from app.services.place_extractor.google_places_client import (
    search_places,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# --- Autocomplete schemas ---


class PlaceAutocompleteRequest(BaseModel):
    """Request for place autocomplete search."""

    query: str = Field(..., min_length=2, max_length=200)
    country_code: str | None = Field(None, min_length=2, max_length=2)

    @field_validator("query")
    @classmethod
    def sanitize_query(cls, v: str) -> str:
        """Sanitize query by removing control characters and normalizing whitespace."""
        import unicodedata

        # Remove control characters (C0, C1, and other control categories)
        # Keep printable characters, spaces, and common punctuation
        sanitized = "".join(
            char
            for char in v
            if unicodedata.category(char)[0] not in ("C",)  # Control characters
            or char in ("\t", "\n")  # Allow tabs/newlines (will be normalized)
        )
        # Normalize whitespace: collapse multiple spaces, strip leading/trailing
        sanitized = " ".join(sanitized.split())
        if len(sanitized) < 2:
            raise ValueError("Query must contain at least 2 printable characters")
        return sanitized

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, v: str | None) -> str | None:
        """Normalize country code to uppercase and validate format."""
        if v is None:
            return None
        v = v.upper()
        if not v.isalpha():
            raise ValueError("Country code must contain only letters")
        return v


class PlacePrediction(BaseModel):
    """Autocomplete prediction result."""

    place_id: str
    main_text: str
    secondary_text: str | None = None
    types: list[str] = Field(default_factory=list)


@router.get("/{place_id}", response_model=Place)
async def get_place(
    request: Request,
    place_id: UUID,
    user: CurrentUser,
) -> Place:
    """Get place metadata by ID."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    places = await db.get("place", {"id": f"eq.{place_id}"})
    if not places:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Place not found",
        )

    return Place(**places[0])


@router.post("/autocomplete", response_model=list[PlacePrediction])
@limiter.limit("30/minute")
async def autocomplete_places(
    request: Request,
    body: PlaceAutocompleteRequest,
    user: CurrentUser,
) -> list[PlacePrediction]:
    """Search for places using Google Places Autocomplete.

    This endpoint is used by the iOS share extension for location search.
    It wraps the Google Places API to keep the API key server-side.

    Args:
        body: Search query and optional country code bias

    Returns:
        List of place predictions with IDs for later details lookup
    """
    if not google_places_configured():
        logger.warning("places_autocomplete_not_configured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place search is temporarily unavailable",
        )

    try:
        results = await search_places(
            query=body.query,
            country_code=body.country_code,
        )

        predictions = []
        for result in results:
            place_id = result.get("place_id")
            if not place_id:
                continue

            predictions.append(
                PlacePrediction(
                    place_id=place_id,
                    main_text=result.get("name", ""),
                    secondary_text=result.get("address"),
                    types=[],  # Types not available in autocomplete, get from details
                )
            )

        return predictions

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"places_autocomplete_error: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place search is temporarily unavailable",
        ) from None
