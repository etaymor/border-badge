"""Cluster-processing flow for PlaceMatcher."""

import asyncio
import logging
from typing import Any

from .constants import (
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_SUGGESTIONS_PER_CLUSTER,
)
from .exceptions import QuotaExhaustedError, RateLimitError

logger = logging.getLogger(__name__)


class ClusterProcessingMixin:
    """Orchestration logic for processing many clusters."""

    async def find_places_for_clusters(
        self,
        clusters: list[dict[str, Any]],
        vision_results_task: Any | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Find place suggestions for photo clusters.

        Uses parallel execution with bounded concurrency to respect rate limits
        while improving performance for multiple clusters.

        Each cluster has a per-cluster timeout to prevent long-running requests
        from blocking when the semaphore queue is deep (e.g., 50 clusters with
        semaphore=5 means 45 waiting tasks).

        Args:
            clusters: List of cluster dicts with centroid and photos
            vision_results_task: Optional asyncio.Task that resolves to
                dict[str, VisionResult] mapping cluster_id -> vision result

        Returns:
            Tuple of (cluster_suggestions, failed_cluster_count)
        """
        logger.info(
            f"Processing {len(clusters)} clusters",
            extra={"cluster_ids": [c.get("id") for c in clusters]},
        )
        for c in clusters:
            logger.debug(
                f"Cluster {c.get('id')}: centroid=({c['centroid']['latitude']:.4f}, "
                f"{c['centroid']['longitude']:.4f}), photos={len(c.get('photos', []))}"
            )

        # Bounded concurrency to respect Google Places API rate limits
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_PLACES_REQUESTS)
        cluster_timeout = self._settings.places_cluster_timeout_seconds

        async def search_with_timeout(
            cluster: dict[str, Any],
        ) -> tuple[dict[str, Any], list[dict], int] | None:
            """Search for places with semaphore-bounded concurrency and timeout.

            Returns (cluster, places, radius_used) or None on timeout.
            Ranking is deferred until vision results are available.
            """

            async def inner() -> tuple[list[dict], int]:
                """Acquire semaphore and run search, releasing in finally."""
                await semaphore.acquire()
                try:
                    return await self._search_nearby_tiered(
                        latitude=cluster["centroid"]["latitude"],
                        longitude=cluster["centroid"]["longitude"],
                    )
                finally:
                    semaphore.release()

            try:
                places, radius_used = await asyncio.wait_for(
                    inner(),
                    timeout=cluster_timeout,
                )
            except TimeoutError:
                logger.warning(
                    f"Cluster search timed out after {cluster_timeout}s",
                    extra={"cluster_id": cluster.get("id")},
                )
                return None

            lat = cluster["centroid"]["latitude"]
            lng = cluster["centroid"]["longitude"]
            logger.info(
                f"Cluster {cluster['id']}: centroid=({lat:.5f}, {lng:.5f}), "
                f"found {len(places)} quality places at radius={radius_used}m"
            )

            return cluster, places, radius_used

        # Execute all searches in parallel with bounded concurrency and per-cluster timeout
        results = await asyncio.gather(
            *[search_with_timeout(c) for c in clusters],
            return_exceptions=True,
        )

        # Await vision results (non-blocking if already done, empty dict on failure)
        vision_map: dict[str, Any] = {}
        if vision_results_task is not None:
            try:
                vision_map = await vision_results_task
            except Exception as e:
                logger.warning(f"Vision classification failed: {e}")

        # Rank and build suggestions with vision data + text search
        successful = []
        failed_count = 0

        for r in results:
            if r is None or isinstance(r, BaseException):
                failed_count += 1
                continue

            cluster, places, _radius_used = r
            cluster_id = cluster["id"]
            vision_result = vision_map.get(cluster_id)

            # Text Search: if vision detected a business name, search by text
            text_search_places: list[dict] = []
            if (
                vision_result is not None
                and vision_result.confidence != "low"
                and vision_result.has_business_name
            ):
                candidates = vision_result.business_name_candidates
                # Use the first (longest/most specific) candidate
                if candidates:
                    text_query = candidates[0]
                    lat = cluster["centroid"]["latitude"]
                    lng = cluster["centroid"]["longitude"]
                    try:
                        text_search_places = await self._execute_text_search(
                            text_query, lat, lng
                        )
                    except (RateLimitError, QuotaExhaustedError) as e:
                        # Text search is an optional enhancement, so keep nearby
                        # results when text search is temporarily unavailable.
                        logger.warning(
                            f"Cluster {cluster_id}: text search unavailable "
                            f"({type(e).__name__}), falling back to nearby results"
                        )
                        text_search_places = []
                    if text_search_places:
                        text_search_places = self._filter_low_quality_places(
                            text_search_places
                        )
                        logger.info(
                            f"Cluster {cluster_id}: text search for "
                            f"'{text_query}' found {len(text_search_places)} "
                            f"quality places"
                        )

            # Merge text search results with nearby search results
            # Text search results are prepended (higher priority)
            if text_search_places:
                seen_ids = {p["id"] for p in text_search_places}
                merged = text_search_places + [
                    p for p in places if p["id"] not in seen_ids
                ]
            else:
                merged = places

            ranked_places = self._rank_by_distance(
                places=merged,
                cluster=cluster,
                time_hint=cluster.get("time_hint"),
                vision_result=vision_result,
            )

            suggestions = (
                ranked_places[:MAX_SUGGESTIONS_PER_CLUSTER] if ranked_places else []
            )
            logger.info(
                f"Cluster {cluster_id}: returning {len(suggestions)} suggestions"
                + (f", top={suggestions[0]['name']}" if suggestions else "")
            )
            successful.append(
                {
                    "cluster_id": cluster_id,
                    "photo_ids": [p["asset_id"] for p in cluster.get("photos", [])],
                    "places": suggestions,
                }
            )

        if failed_count > 0:
            logger.warning(
                f"Failed to process {failed_count}/{len(clusters)} clusters "
                "(timeouts or errors)"
            )

        return successful, failed_count
