"""Photo import API endpoints.

Provides place suggestions for photo GPS clusters using Google Places Nearby Search.
"""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import get_settings
from app.core.security import CurrentUser
from app.main import limiter
from app.schemas.photos import (
    ClusterSuggestion,
    PlaceSuggestionRequest,
    PlaceSuggestionResponse,
)
from app.services.place_matcher import (
    ConfigurationError,
    PlaceMatcher,
    QuotaExhaustedError,
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
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.places_api_timeout_seconds) as client:
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
        except QuotaExhaustedError as e:
            # Daily quota exhausted - tell user to try again tomorrow
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Place suggestion service quota exceeded. Please try again tomorrow.",
                headers={"Retry-After": "3600"},  # Hint to wait longer
            ) from e
        except RateLimitError as e:
            # Temporary rate limit - can retry soon
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests to places service. Please wait a moment and try again.",
                headers={"Retry-After": "60"},
            ) from e
        except ConfigurationError as e:
            # Service not properly configured (missing API key)
            logger.error(f"Place matcher configuration error: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Place suggestion service is not configured. Please contact support.",
            ) from e
        except httpx.TimeoutException as e:
            # External service timeout
            logger.warning(f"Place matching timeout: {e}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Place suggestion service timed out. Please try again.",
            ) from e
        except httpx.RequestError as e:
            # Network/connection errors
            logger.error(f"Place matching network error: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to reach place suggestion service.",
            ) from e
        except Exception as e:
            logger.error(f"Place matching failed: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to find place suggestions",
            ) from e


# NOTE: No /confirm-entries endpoint - reuse existing entry creation at
# POST /trips/{trip_id}/entries. Client sends confirmed suggestions there.
