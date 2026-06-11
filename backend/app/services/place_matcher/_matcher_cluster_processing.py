"""Cluster-processing flow for PlaceMatcher."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.services.photo_vision import VisionResult

from ._matcher_search import TieredSearchResult
from .constants import (
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_SUGGESTIONS_PER_CLUSTER,
)
from .exceptions import QuotaExhaustedError, RateLimitError
from .utils import name_matches_candidate

logger = logging.getLogger(__name__)

# Greppable event name for the per-cluster diagnostic trace (U4). One JSON line
# per cluster is emitted at INFO, gated entirely behind PLACES_DIAGNOSTICS, so a
# diagnostic capture run can be sliced out of the logs with this prefix.
DIAGNOSTIC_TRACE_EVENT = "place_matcher_diagnostic_trace"


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
        diagnostics = self._settings.places_diagnostics

        async def search_with_timeout(
            cluster: dict[str, Any],
        ) -> tuple[dict[str, Any], list[dict], int, TieredSearchResult] | None:
            """Search for places with semaphore-bounded concurrency and timeout.

            Returns (cluster, places, radius_used, search_result) or None on
            timeout. The full TieredSearchResult is retained so the diagnostic
            trace (U4) can read its rich per-radius fields; the downstream
            unpacking loops only consume (cluster, places, radius_used).
            Ranking is deferred until vision results are available.
            """

            async def inner() -> TieredSearchResult:
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
                search_result = await asyncio.wait_for(
                    inner(),
                    timeout=cluster_timeout,
                )
                places = search_result.places
                radius_used = search_result.radius_used
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

            return cluster, places, radius_used, search_result

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

        # Collect successful search results and identify text search needs. The
        # downstream loops keep the lean (cluster, places, radius_used) shape; the
        # full TieredSearchResult per cluster is parked in a parallel dict so only
        # the diagnostic trace pays attention to it.
        search_results: list[tuple[dict, list[dict], int]] = []
        search_result_by_cluster: dict[str, TieredSearchResult] = {}
        failed_count = 0

        for r in results:
            if r is None or isinstance(r, BaseException):
                failed_count += 1
                continue
            cluster, places, radius_used, search_result = r
            search_results.append((cluster, places, radius_used))
            search_result_by_cluster[cluster["id"]] = search_result

        # Per-cluster diagnostic trace accumulator (KTD2). Built only when the
        # flag is on; mutated across the four passes and emitted once at the end.
        # Off => stays empty, so the hot loops do essentially zero extra work.
        traces: dict[str, dict[str, Any]] = {}
        if diagnostics:
            for cluster, places, _radius_used in search_results:
                cluster_id = cluster["id"]
                sr = search_result_by_cluster[cluster_id]
                # Full raw candidate world = every place at every radius, pre
                # filter, deduped by id (KTD1: the eval dataset's places[] world).
                raw_candidates: list[dict] = []
                seen_raw_ids: set[str] = set()
                for radius_places in sr.raw_places_per_radius.values():
                    for p in radius_places:
                        pid = p.get("id")
                        if pid in seen_raw_ids:
                            continue
                        seen_raw_ids.add(pid)
                        raw_candidates.append(p)
                # Reason-attributed search-phase drops (U3). Diagnostics-only and
                # API-cost-free: it re-filters the already-fetched raw dicts in
                # pure CPU. low_reviews is structurally 0 here (the wide pass
                # omits userRatingCount) — enrich-phase drops are folded in later.
                search_drops: dict[str, int] = {}
                self._filter_low_quality_places(
                    raw_candidates, drop_counts=search_drops
                )
                centroid = cluster["centroid"]
                traces[cluster_id] = {
                    "cluster_id": cluster_id,
                    # Full precision for manual Google Maps lookup (KTD/M4).
                    "centroid": {
                        "latitude": centroid["latitude"],
                        "longitude": centroid["longitude"],
                    },
                    "photo_count": len(cluster.get("photos", [])),
                    "density": sr.density.value,
                    "radii_searched": sorted(sr.radii_searched),
                    "stopped_early": sr.stopped_early,
                    "largest_radius_used": sr.radius_used,
                    "raw_count_per_radius": dict(sr.raw_count_per_radius),
                    "raw_candidates": raw_candidates,
                    "quality_count_after_filter": len(places),
                    # Phase-attributed drops (KTD3). low_reviews lives under
                    # "enrich" because the search phase cannot fire that gate.
                    "drop_counts": {
                        "search": search_drops,
                        "enrich": {},
                    },
                    "vision": {
                        # VisionResult has no had_images field; a cluster only
                        # appears in vision_map when it had vision images that
                        # classified successfully, so membership IS had_images.
                        "had_images": cluster_id in vision_map,
                        "category": None,
                        "business_name_candidates": [],
                        "confidence": None,
                        "text_search_triggered": False,
                        "text_search_hit": False,
                    },
                    "finalists": [],
                    "top_finalist_name_matched_vision": False,
                    "final_suggestion_count": 0,
                    "outcome": None,
                }
                vr = vision_map.get(cluster_id)
                if vr is not None:
                    traces[cluster_id]["vision"].update(
                        {
                            "category": vr.category,
                            "business_name_candidates": list(
                                vr.business_name_candidates
                            ),
                            "confidence": vr.confidence,
                        }
                    )

        # Run text searches concurrently for clusters with vision-detected names
        text_search_map: dict[str, list[dict]] = {}

        async def text_search_for_cluster(
            cluster_id: str,
            text_query: str,
            lat: float,
            lng: float,
        ) -> tuple[str, list[dict]]:
            async with semaphore:
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
        for cluster, nearby_places, _radius_used in search_results:
            cluster_id = cluster["id"]
            vision_result = vision_map.get(cluster_id)
            # Low vision confidence reflects scene clarity (dark/blurry), not OCR
            # validity — a dark nightlife photo can still carry a crisp neon sign.
            # Cost-bounded rescue: let low-confidence text trigger the search only
            # when Nearby found nothing, where it is the sole recall path.
            confidence_ok = vision_result is not None and (
                vision_result.confidence != "low" or not nearby_places
            )
            if (
                vision_result is not None
                and confidence_ok
                and vision_result.has_business_name
            ):
                candidates = vision_result.business_name_candidates
                if candidates:
                    # LLM-gating: suppress the (Enterprise-tier) Text Search when the
                    # Nearby result already contains a place whose name matches the
                    # vision-detected signage. The Text Search would only re-find
                    # what we already have, so skipping it is a pure cost saving with
                    # no quality loss.
                    already_found = any(
                        name_matches_candidate(
                            p.get("displayName", {}).get("text", ""), candidates[0]
                        )
                        for p in nearby_places
                    )
                    if already_found:
                        logger.info(
                            f"Cluster {cluster_id}: suppressing text search for "
                            f"'{candidates[0]}' — already in nearby results"
                        )
                        continue
                    lat = cluster["centroid"]["latitude"]
                    lng = cluster["centroid"]["longitude"]
                    text_search_tasks.append(
                        text_search_for_cluster(cluster_id, candidates[0], lat, lng)
                    )
                    if diagnostics and cluster_id in traces:
                        traces[cluster_id]["vision"]["text_search_triggered"] = True

        if text_search_tasks:
            text_results = await asyncio.gather(
                *text_search_tasks, return_exceptions=True
            )
            for tr in text_results:
                if isinstance(tr, tuple):
                    text_search_map[tr[0]] = tr[1]
                    if diagnostics and tr[0] in traces:
                        traces[tr[0]]["vision"]["text_search_hit"] = bool(tr[1])

        # First pass: rank each cluster on signals that don't need a live rating
        # (distance + vision + dwell/time-hint + closed/type filtering), then take
        # the top finalists. Only those finalists get enriched with the expensive
        # rating signals — the wide search deliberately omitted them.
        per_cluster_merged: dict[str, list[dict]] = {}
        per_cluster_first_pass: dict[str, list[dict]] = {}
        per_cluster_finalists: dict[str, list[dict]] = {}
        finalist_ids: set[str] = set()
        name_match_locked_clusters: set[str] = set()

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
            per_cluster_merged[cluster_id] = merged

            first_pass = self._rank_by_distance(
                places=merged,
                cluster=cluster,
                time_hint=cluster.get("time_hint"),
                vision_result=vision_result,
            )
            per_cluster_first_pass[cluster_id] = first_pass
            finalists = first_pass[:MAX_SUGGESTIONS_PER_CLUSTER]
            per_cluster_finalists[cluster_id] = finalists

            # When the top finalist matches vision-detected signage, the ranking
            # outcome is already decided: the name-match bonus exceeds the maximum
            # combined rating/review/fame advantage any neighbor could gain from
            # enrichment. Skip the (Enterprise-tier) Place Details calls for the
            # whole cluster — pure cost saving, identical top suggestion. Big trip
            # imports (hundreds of photos -> many clusters) make this significant.
            if (
                finalists
                and vision_result is not None
                and any(
                    name_matches_candidate(finalists[0]["name"], c)
                    for c in vision_result.business_name_candidates
                )
            ):
                name_match_locked_clusters.add(cluster_id)
                logger.info(
                    f"Cluster {cluster_id}: skipping rating enrichment — top "
                    f"finalist '{finalists[0]['name']}' matches detected signage"
                )
                continue

            finalist_ids.update(p["place_id"] for p in finalists)

        # Enrich only the surfaced finalists with rating/userRatingCount, then
        # re-rank so the rating/Bayesian/fame signals take effect on that set.
        # Best-effort: on failure we keep the un-enriched first-pass order.
        enriched_ratings: dict[str, dict[str, Any]] = {}
        if finalist_ids:
            try:
                enriched_ratings = await self._enrich_place_ratings(list(finalist_ids))
            except Exception as e:  # never crash the request on enrichment
                logger.warning(f"Rating enrichment unavailable: {e}")
                enriched_ratings = {}

        # Rank and build suggestions with vision data + text search
        successful = []

        for cluster, _places, _radius_used in search_results:
            cluster_id = cluster["id"]
            vision_result = vision_map.get(cluster_id)
            finalists = per_cluster_finalists.get(cluster_id, [])

            if enriched_ratings and cluster_id not in name_match_locked_clusters:
                # Merge live ratings back onto the original merged place dicts for
                # just the finalists, then re-rank that small enriched set.
                finalist_place_ids = {p["place_id"] for p in finalists}
                enriched_places = [
                    {**p, **enriched_ratings.get(p["id"], {})}
                    for p in per_cluster_merged.get(cluster_id, [])
                    if p["id"] in finalist_place_ids
                ]
                # Re-apply the deferred review-count quality gate now that the
                # finalists carry live rating counts (the wide pass omitted them,
                # so junk could reach the finalist set on distance alone). A
                # dropped finalist is backfilled from the first-pass order so the
                # user still sees a full suggestion list.
                enrich_drops: dict[str, int] | None = {} if diagnostics else None
                gated_places = self._filter_low_quality_places(
                    enriched_places, drop_counts=enrich_drops
                )
                if diagnostics and cluster_id in traces and enrich_drops is not None:
                    traces[cluster_id]["drop_counts"]["enrich"] = enrich_drops
                reranked = self._rank_by_distance(
                    places=gated_places,
                    cluster=cluster,
                    time_hint=cluster.get("time_hint"),
                    vision_result=vision_result,
                )
                if len(reranked) < MAX_SUGGESTIONS_PER_CLUSTER:
                    surviving_ids = {p["place_id"] for p in reranked}
                    backfill = [
                        p
                        for p in per_cluster_first_pass.get(cluster_id, [])[
                            MAX_SUGGESTIONS_PER_CLUSTER:
                        ]
                        if p["place_id"] not in surviving_ids
                    ]
                    reranked.extend(
                        backfill[: MAX_SUGGESTIONS_PER_CLUSTER - len(reranked)]
                    )
                suggestions = reranked or finalists
            else:
                suggestions = finalists

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

            if diagnostics and cluster_id in traces:
                self._finalize_cluster_trace(
                    trace=traces[cluster_id],
                    suggestions=suggestions,
                    enriched_ratings=enriched_ratings,
                    vision_result=vision_result,
                )

        if failed_count > 0:
            logger.warning(
                f"Failed to process {failed_count}/{len(clusters)} clusters "
                "(timeouts or errors)"
            )

        if diagnostics:
            for trace in traces.values():
                logger.info(
                    DIAGNOSTIC_TRACE_EVENT,
                    extra={"trace": trace},
                )
                # Also emit a greppable single-line JSON so a capture run can be
                # sliced out of plain text logs without a structured sink.
                logger.info(json.dumps({DIAGNOSTIC_TRACE_EVENT: trace}))

        return successful, failed_count

    @staticmethod
    def _finalize_cluster_trace(
        trace: dict[str, Any],
        suggestions: list[dict[str, Any]],
        enriched_ratings: dict[str, dict[str, Any]],
        vision_result: VisionResult | None,
    ) -> None:
        """Fill the per-cluster trace's finalist/outcome fields (KTD1/KTD3).

        Backfills the live enrichment ratings onto the matching ``raw_candidates``
        entries (KTD1) so a labeler folding the dumped world into the eval dataset
        gets ratings for at least the finalists; non-finalist candidates stay
        null-rated. Finalist ratings are nullable on purpose — name-match-locked /
        enrichment-skipped clusters never enrich, which is expected, NOT a bug.
        """
        # KTD1: backfill enrichment ratings onto the raw candidate world by id.
        if enriched_ratings:
            for candidate in trace["raw_candidates"]:
                live = enriched_ratings.get(candidate.get("id"))
                if live:
                    if live.get("rating") is not None:
                        candidate["rating"] = live["rating"]
                    if live.get("userRatingCount") is not None:
                        candidate["userRatingCount"] = live["userRatingCount"]

        finalists_trace: list[dict[str, Any]] = []
        for s in suggestions[:MAX_SUGGESTIONS_PER_CLUSTER]:
            place_id = s.get("place_id")
            # _rank_by_distance strips _rating/_rating_count from finalists, so
            # the live values must come from enriched_ratings (or stay null).
            live = enriched_ratings.get(place_id, {})
            finalists_trace.append(
                {
                    "name": s.get("name"),
                    "place_id": place_id,
                    "distance_m": s.get("distance_m"),
                    "rating": live.get("rating"),
                    "review_count": live.get("userRatingCount"),
                }
            )
        trace["finalists"] = finalists_trace
        trace["final_suggestion_count"] = len(suggestions)

        # Whether the top finalist's name matches a vision business-name candidate.
        # Recorded for every matched cluster; RANKING failures (matched-but-wrong-
        # top) are not knowable at trace time, so this boolean is the only signal.
        top_matched = False
        if suggestions and vision_result is not None:
            top_name = suggestions[0].get("name", "")
            top_matched = any(
                name_matches_candidate(top_name, c)
                for c in vision_result.business_name_candidates
            )
        trace["top_finalist_name_matched_vision"] = top_matched

        # Outcome classification (KTD3 flowchart — empty clusters only).
        #
        # The flowchart's "any raw candidates fetched?" is the Nearby world, but
        # a text-search rescue is itself a fetch: an empty cluster that triggered
        # text search is more precisely "empty_after_text_search" (the rescue path
        # ran and still failed) than "empty_no_candidates" (RECALL: nothing was
        # ever fetched). So text_search_triggered is checked first, then the
        # no-Nearby-candidates RECALL case, then the FILTER case — this matches
        # the U4 outcome scenarios.
        if suggestions:
            trace["outcome"] = "matched"
        elif trace["vision"]["text_search_triggered"]:
            trace["outcome"] = "empty_after_text_search"
        elif not trace["raw_candidates"]:
            trace["outcome"] = "empty_no_candidates"
        else:
            trace["outcome"] = "empty_after_filter"
