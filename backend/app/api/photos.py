"""Photo import API endpoints.

Provides place suggestions for photo GPS clusters using Google Places Nearby Search.
Optionally uses vision classification (Gemini Flash Lite) to improve accuracy.
"""

import asyncio
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
from app.services.photo_vision import classify_cluster_photos
from app.services.place_matcher import (
    ConfigurationError,
    PlaceMatcher,
    QuotaExhaustedError,
    RateLimitError,
)
from app.services.place_matcher.instrumentation import request_metrics

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/photos", tags=["photos"])


@router.post("/suggest-places", response_model=PlaceSuggestionResponse)
# Vision-enabled endpoint: the limit caps API cost exposure, but it has to clear
# one legitimate import. A big trip is 50-100 clusters and the client chunks them
# 5 at a time, so a single honest import spends 10-20 requests -- at 10/minute it
# rate-limited itself partway through and the remaining clusters surfaced as
# "Couldn't check this location" with retry disabled. Cost is bounded per cluster
# (not per request), so a higher request ceiling does not raise the ceiling on spend.
@limiter.limit("40/minute")
async def suggest_places(
    request: Request,  # Required for rate limiter
    data: PlaceSuggestionRequest,
    user: CurrentUser,
) -> PlaceSuggestionResponse:
    """
    Receive photo clusters, return place suggestions ranked by distance.

    Users see "15m away" and decide Yes/No - no confidence percentages.

    When vision image payloads are provided per cluster (up to 3 representative
    images), runs vision classification in parallel with place matching to
    improve accuracy.

    Rate limited to 10 requests/minute per user to control vision API costs.
    """
    logger.info(
        f"Processing {len(data.clusters)} clusters for user {user.id}",
        extra={"cluster_count": len(data.clusters), "user_id": str(user.id)},
    )

    # Enter the request-scoped metrics context HERE rather than inside the
    # matcher: the vision task below copies the current context at
    # `create_task` time, so a context entered later would leave the vision
    # aggregates recording into nothing. Emits one metrics line on exit (U15).
    with request_metrics():
        return await _suggest_places(data)


async def _suggest_places(data: PlaceSuggestionRequest) -> PlaceSuggestionResponse:
    """Run vision + place matching for the request's clusters."""
    cluster_dicts = [c.model_dump() for c in data.clusters]

    # Run vision classification in parallel with place matching setup
    # Vision results are used during ranking (not blocking search)
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.places_api_timeout_seconds) as client:
        matcher = PlaceMatcher(http_client=client)

        # Run vision + place matching in parallel
        vision_task: asyncio.Task | None = None
        try:
            vision_task = asyncio.create_task(classify_cluster_photos(cluster_dicts))
            suggestion_dicts, failed_count = await matcher.find_places_for_clusters(
                cluster_dicts, vision_results_task=vision_task
            )

            # Convert dicts to ClusterSuggestion models for validation
            suggestions = [
                ClusterSuggestion.model_validate(s) for s in suggestion_dicts
            ]
            return PlaceSuggestionResponse(
                suggestions=suggestions,
                failed_cluster_count=failed_count,
            )
        except QuotaExhaustedError as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Place suggestion service quota exceeded. Please try again tomorrow.",
                headers={"Retry-After": "3600"},
            ) from e
        except RateLimitError as e:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests to places service. Please wait a moment and try again.",
                headers={"Retry-After": "60"},
            ) from e
        except ConfigurationError as e:
            logger.error(f"Place matcher configuration error: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Place suggestion service is not configured. Please contact support.",
            ) from e
        except httpx.TimeoutException as e:
            logger.warning(f"Place matching timeout: {e}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Place suggestion service timed out. Please try again.",
            ) from e
        except httpx.RequestError as e:
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
        finally:
            if vision_task is not None and not vision_task.done():
                vision_task.cancel()


# NOTE: No /confirm-entries endpoint - reuse existing entry creation at
# POST /trips/{trip_id}/entries. Client sends confirmed suggestions there.
