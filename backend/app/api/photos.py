"""Photo import API endpoints.

Provides place suggestions for photo GPS clusters using Google Places Nearby Search.
"""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, status

from app.core.security import CurrentUser
from app.main import limiter
from app.schemas.photos import (
    ClusterSuggestion,
    PlaceSuggestionRequest,
    PlaceSuggestionResponse,
)
from app.services.place_matcher import (
    PLACES_API_TIMEOUT_SECONDS,
    PlaceMatcher,
    RateLimitError,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/photos", tags=["photos"])


@router.post("/suggest-places", response_model=PlaceSuggestionResponse)
@limiter.limit("5/minute")  # Strict limit - heavy processing + external API
async def suggest_places(
    request: Request,  # Required by slowapi limiter
    data: PlaceSuggestionRequest,
    user: CurrentUser,
) -> PlaceSuggestionResponse:
    _ = request  # Used by slowapi limiter
    """
    Receive photo clusters, return place suggestions ranked by distance.

    Users see "15m away" and decide Yes/No - no confidence percentages.

    Rate limited to 5 requests/minute per user to control API costs.
    """
    logger.info(
        f"Processing {len(data.clusters)} clusters for user {user.id}",
        extra={"cluster_count": len(data.clusters), "user_id": str(user.id)},
    )

    # Caller owns client lifecycle
    async with httpx.AsyncClient(timeout=PLACES_API_TIMEOUT_SECONDS) as client:
        matcher = PlaceMatcher(http_client=client)
        try:
            suggestion_dicts = await matcher.find_places_for_clusters(
                [c.model_dump() for c in data.clusters]
            )
            # Convert dicts to ClusterSuggestion models for validation
            suggestions = [
                ClusterSuggestion.model_validate(s) for s in suggestion_dicts
            ]
            return PlaceSuggestionResponse(suggestions=suggestions)
        except RateLimitError as e:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests to places service. Please wait a moment and try again.",
                headers={"Retry-After": "60"},
            ) from e
        except Exception as e:
            logger.error(f"Place matching failed: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to find place suggestions",
            ) from e


# NOTE: No /confirm-entries endpoint - reuse existing entry creation at
# POST /trips/{trip_id}/entries. Client sends confirmed suggestions there.
