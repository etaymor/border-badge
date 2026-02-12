"""Cluster-processing flow for PlaceMatcher."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.services.photo_vision import VisionResult

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
        vision_results_task: asyncio.Task[dict[str, VisionResult]] | None = None,
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
        vision_map: dict[str, VisionResult] = {}
        if vision_results_task is not None:
            try:
                vision_map = await vision_results_task
            except Exception as e:
                logger.warning(f"Vision classification failed: {e}")

        # Collect successful search results and identify text search needs
        search_results: list[tuple[dict, list[dict], int]] = []
        failed_count = 0

        for r in results:
            if r is None or isinstance(r, BaseException):
                failed_count += 1
                continue
            search_results.append(r)

        # Run text searches concurrently for clusters with vision-detected names
        text_search_map: dict[str, list[dict]] = {}

        async def text_search_for_cluster(
            cluster_id: str,
            text_query: str,
            lat: float,
            lng: float,
        ) -> tuple[str, list[dict]]:
            try:
                places = await self._execute_text_search(text_query, lat, lng)
                if places:
                    places = self._filter_low_quality_places(places)
                    logger.info(
                        f"Cluster {cluster_id}: text search for "
                        f"'{text_query}' found {len(places)} quality places"
                    )
                return cluster_id, places
            except (RateLimitError, QuotaExhaustedError) as e:
                logger.warning(
                    f"Cluster {cluster_id}: text search unavailable "
                    f"({type(e).__name__}), falling back to nearby results"
                )
                return cluster_id, []

        text_search_tasks = []
        for cluster, _places, _radius_used in search_results:
            cluster_id = cluster["id"]
            vision_result = vision_map.get(cluster_id)
            if (
                vision_result is not None
                and vision_result.confidence != "low"
                and vision_result.has_business_name
            ):
                candidates = vision_result.business_name_candidates
                if candidates:
                    lat = cluster["centroid"]["latitude"]
                    lng = cluster["centroid"]["longitude"]
                    text_search_tasks.append(
                        text_search_for_cluster(cluster_id, candidates[0], lat, lng)
                    )

        if text_search_tasks:
            text_results = await asyncio.gather(
                *text_search_tasks, return_exceptions=True
            )
            for tr in text_results:
                if isinstance(tr, tuple):
                    text_search_map[tr[0]] = tr[1]

        # Rank and build suggestions with vision data + text search
        successful = []

        for cluster, places, _radius_used in search_results:
            cluster_id = cluster["id"]
            vision_result = vision_map.get(cluster_id)
            text_search_places = text_search_map.get(cluster_id, [])

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
