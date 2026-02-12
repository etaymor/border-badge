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
from app.services.photo_vision import PhotoClassifier, VisionResult
from app.services.place_matcher import (
    ConfigurationError,
    PlaceMatcher,
    QuotaExhaustedError,
    RateLimitError,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/photos", tags=["photos"])


async def _classify_cluster_photos(
    clusters: list[dict],
) -> dict[str, VisionResult]:
    """Run vision classification for clusters with vision image payloads.

    Returns a dict mapping cluster_id -> VisionResult.
    Failures are silently ignored (returns empty dict for failed clusters).
    """
    classifier = PhotoClassifier(timeout=5.0)
    vision_clusters = [
        c
        for c in clusters
        if c.get("vision_images_base64") or c.get("vision_image_base64")
    ]

    if not vision_clusters:
        return {}

    async def classify_one(cluster: dict) -> tuple[str, VisionResult | None]:
        images: list[str] = []
        if cluster.get("vision_images_base64"):
            images = list(cluster["vision_images_base64"][:3])
        elif cluster.get("vision_image_base64"):
            images = [cluster["vision_image_base64"]]

        if not images:
            return cluster["id"], None

        single_results = await asyncio.gather(
            *[classifier.classify(image_base64) for image_base64 in images],
            return_exceptions=True,
        )

        parsed_results: list[VisionResult | None] = []
        for item in single_results:
            if isinstance(item, VisionResult):
                parsed_results.append(item)
            else:
                parsed_results.append(None)

        return cluster["id"], PhotoClassifier.aggregate_results(parsed_results)

    results = await asyncio.gather(
        *[classify_one(c) for c in vision_clusters],
        return_exceptions=True,
    )

    vision_map: dict[str, VisionResult] = {}
    for r in results:
        if isinstance(r, tuple) and r[1] is not None:
            vision_map[r[0]] = r[1]

    if vision_map:
        logger.info(
            f"Vision classification: {len(vision_map)}/{len(vision_clusters)} "
            f"clusters classified successfully"
        )

    return vision_map


@router.post("/suggest-places", response_model=PlaceSuggestionResponse)
@limiter.limit("30/minute")  # Allow burst usage for users with many clusters
async def suggest_places(
    request: Request,  # Required for rate limiter
    data: PlaceSuggestionRequest,
    user: CurrentUser,
) -> PlaceSuggestionResponse:
    """
    Receive photo clusters, return place suggestions ranked by distance.

    Users see "15m away" and decide Yes/No - no confidence percentages.

    When vision image payloads are provided per cluster (single legacy image or
    up to 3 representative images), runs vision classification in parallel with
    place matching to improve accuracy.

    Rate limited to 30 requests/minute per user to allow reasonable batch imports.
    """
    logger.info(
        f"Processing {len(data.clusters)} clusters for user {user.id}",
        extra={"cluster_count": len(data.clusters), "user_id": str(user.id)},
    )

    cluster_dicts = [c.model_dump() for c in data.clusters]

    # Run vision classification in parallel with place matching setup
    # Vision results are used during ranking (not blocking search)
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.places_api_timeout_seconds) as client:
        matcher = PlaceMatcher(http_client=client)

        try:
            # Run vision + place matching in parallel
            vision_task = asyncio.create_task(_classify_cluster_photos(cluster_dicts))

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


# NOTE: No /confirm-entries endpoint - reuse existing entry creation at
# POST /trips/{trip_id}/entries. Client sends confirmed suggestions there.
