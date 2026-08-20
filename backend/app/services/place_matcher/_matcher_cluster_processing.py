"""Cluster-processing flow for PlaceMatcher."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from app.services.photo_vision import VisionResult
from app.services.photo_vision.constants import VISION_TO_PLACE_TYPES

from ._matcher_search import (
    TieredSearchResult,
    places_request_scope,
    resolve_places_concurrency,
)
from .constants import (
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_SUGGESTIONS_PER_CLUSTER,
)
from .exceptions import QuotaExhaustedError, RateLimitError, SlotUnavailableError
from .instrumentation import (
    PHASE_BACKFILL,
    PHASE_ENRICHMENT,
    PHASE_SEARCH,
    PHASE_VISION_WAIT,
    phase_timer,
    record_clusters,
    request_metrics,
)
from .rate_limit import (
    budget_seconds_for,
    cluster_timeout_for,
    request_budget_for,
    retry_budget_scope,
)
from .utils import name_match_strength, name_matches_candidate

logger = logging.getLogger(__name__)

# Greppable event name for the per-cluster diagnostic trace (U4). One JSON line
# per cluster is emitted at INFO, gated entirely behind PLACES_DIAGNOSTICS, so a
# diagnostic capture run can be sliced out of the logs with this prefix.
DIAGNOSTIC_TRACE_EVENT = "place_matcher_diagnostic_trace"


def _guarded_setting[T](
    settings: Any, name: str, default: T, types: type | tuple[type, ...]
) -> T:
    """Read a tuning flag off settings, falling back on a wrong-typed value.

    The isinstance guard is load-bearing, not defensive noise: a ``MagicMock``
    settings stand-in answers every attribute, so a bare ``getattr`` would hand
    the flow a Mock — truthy, and arithmetic-capable — wherever settings are
    mocked. Same reasoning as ``_positive_int`` in ``_matcher_search``.
    """
    value = getattr(settings, name, default)
    return value if isinstance(value, types) else default


class ClusterProcessingMixin:
    """Orchestration logic for processing many clusters."""

    #: Clusters this request failed for a CAPACITY reason (upstream throttling,
    #: our own circuit breaker, an exhausted outbound-slot bound, or a saturated
    #: connection pool) rather than because the cluster legitimately found
    #: nothing.
    #:
    #: Read it after `find_places_for_clusters` returns. It exists because
    #: `failed_cluster_count` cannot distinguish the two, and the difference
    #: decides the right answer: an ordinary per-cluster failure is retryable
    #: immediately, whereas a capacity failure means "Retry all" dispatches
    #: straight back into the still-open breaker. The route SHOULD answer a
    #: mostly-capacity-failed request with a busy signal (503 + Retry-After
    #: covering the breaker cooldown) instead of a 200 whose failed clusters the
    #: client will re-send at once. Owned by `app/api/photos.py`; exposed here
    #: rather than changing this method's return shape, which that route reads.
    last_capacity_failed_cluster_count: int = 0

    async def find_places_for_clusters(
        self,
        clusters: list[dict[str, Any]],
        vision_results_task: asyncio.Task[dict[str, VisionResult]] | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """Find place suggestions for photo clusters.

        Thin wrapper that joins (or, for a service-level caller that entered
        none, owns) the request-scoped metrics context so the four phase
        durations, the cache composition and the outbound dispatch shape are
        emitted once per request. See ``instrumentation``.

        Also registers the request for the duration so the per-request share of
        the process-wide outbound bound can be divided among concurrent
        importers instead of being sized for exactly one (see
        ``resolve_places_concurrency``).
        """
        self.last_capacity_failed_cluster_count = 0
        with request_metrics(), places_request_scope():
            return await self._find_places_for_clusters(clusters, vision_results_task)

    async def _find_places_for_clusters(
        self,
        clusters: list[dict[str, Any]],
        vision_results_task: asyncio.Task[dict[str, VisionResult]] | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Find place suggestions for photo clusters.

        Uses parallel execution with bounded concurrency to respect rate limits
        while improving performance for multiple clusters.

        Each cluster has a per-cluster timeout bounding its own search work. The
        timeout deliberately does NOT cover the wait for a semaphore slot: with
        many clusters (e.g. 50 clusters against a semaphore of 5) every task is
        created up front, so a budget that included the queue wait would expire on
        the clusters at the back of the line before they ever called Google.

        Because of that, the per-cluster timeout bounds a CLUSTER and says
        nothing about the request: 25 clusters against a share of 5 is five
        sequential waves in the search phase alone. ``request_budget_for``
        supplies the request-level ceiling and is enforced as a DISPATCH gate on
        the three per-cluster outbound phases (Nearby, text rescue, popularity
        probe): once it is spent, work that has not started does not start.
        Deliberately NOT gated are (a) work already in flight, which is allowed
        to finish rather than waste a paid call, and (b) the two enrichment
        batches, which are one bounded global call each and whose omission would
        change ranking. The real ceiling is therefore the budget plus one
        cluster's remaining phase timeout plus enrichment — which is why the
        budget sits well below the client's 90s rather than at it.

        Args:
            clusters: List of cluster dicts with centroid and photos
            vision_results_task: Optional asyncio.Task that resolves to
                dict[str, VisionResult] mapping cluster_id -> vision result

        Returns:
            Tuple of (cluster_suggestions, failed_cluster_count)
        """
        # R27: cluster ids are never attached to an always-on log line.
        logger.info(f"Processing {len(clusters)} clusters")
        for c in clusters:
            logger.debug(
                f"Cluster {c.get('id')}: centroid=({c['centroid']['latitude']:.4f}, "
                f"{c['centroid']['longitude']:.4f}), photos={len(c.get('photos', []))}"
            )

        # This request's SHARE of the global outbound bound (U7). It is the
        # OUTER of two bounds: the process-wide ceiling is acquired inside, in
        # `places_outbound_slot`, around the outbound call itself. Sizing the
        # share below that ceiling is what stops one large request from holding
        # every global slot while another request's clusters make no progress.
        # The module constant remains the fallback when settings carry no
        # usable value (and remains patchable in tests).
        per_request_limit, _process_limit = resolve_places_concurrency(
            self._settings, default_per_request=MAX_CONCURRENT_PLACES_REQUESTS
        )
        semaphore = asyncio.Semaphore(per_request_limit)
        # Guarded read: this value is handed to `asyncio.wait_for` in four
        # places now, and a MagicMock settings stand-in would fail there in a
        # way that has nothing to do with the code under test.
        cluster_timeout = cluster_timeout_for(self._settings)
        # Share of the per-cluster budget that jittered retry backoff may spend
        # (U3). Stated in constants as RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT.
        retry_budget = budget_seconds_for(self._settings)
        diagnostics = self._settings.places_diagnostics

        # THE REQUEST-LEVEL CEILING (U8). The per-cluster timeout above bounds
        # ONE CLUSTER; this bounds the whole request. See
        # DEFAULT_REQUEST_BUDGET_SECONDS for the arithmetic that separates the
        # two. Enforced as a DISPATCH gate below -- never as a cancellation, so
        # a paid call already in flight is always allowed to finish.
        loop = asyncio.get_running_loop()
        request_deadline = loop.time() + request_budget_for(self._settings)

        def _remaining_budget() -> float:
            return request_deadline - loop.time()

        async def search_with_timeout(
            cluster: dict[str, Any],
        ) -> tuple[dict[str, Any], list[dict], int, TieredSearchResult] | None:
            """Search for places with semaphore-bounded concurrency and timeout.

            Returns (cluster, places, radius_used, search_result) or None on
            timeout. The full TieredSearchResult is retained so the diagnostic
            trace (U4) can read its rich per-radius fields; the downstream
            unpacking loops only consume (cluster, places, radius_used).
            Ranking is deferred until vision results are available.

            The semaphore is acquired OUTSIDE the timeout on purpose. asyncio.gather
            starts a task per cluster immediately, so a timeout that also covered the
            queue wait would start every cluster's clock at once: with concurrency of
            N, everything past the first N burns its budget waiting rather than
            working, and a tiered search that legitimately needs most of the budget
            leaves no slack to absorb that. The timeout is meant to bound a slow
            *search*, not to punish a cluster for its position in the queue.

            THREE BUDGETS, composed in this order (U7):

            1. **Per-request share wait** — queuing on the semaphore below.
               Unbounded in time and charged to NOBODY's clock, because it is
               charged BEFORE the per-cluster timeout starts (this line).
            2. **Process-wide slot wait** — inside each outbound call, bounded
               by ``PLACES_SLOT_WAIT_CEILING_SECONDS`` (2s). On expiry the call
               raises ``SlotUnavailableError``: the cluster fails FAST and
               retryable instead of spending its whole budget queuing.
            3. **Retry backoff + outbound work** — the per-cluster timeout,
               within which jittered backoff may spend at most
               ``RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT`` (40%, U3).

            (2) is the only one of the three that consumes (3), and it is
            deliberately small relative to it.

            SCOPE OF THE 40% CLAIM (U8). That composition describes THIS phase —
            the Nearby path — only. A cluster can run up to four phases, and
            each opens its own ``retry_budget_scope``: this search, the text
            rescue, the popularity probe, and finalist enrichment. Every one of
            them is separately wrapped in an ``asyncio.wait_for`` of the same
            per-cluster timeout, so ONE CLUSTER's worst case is
            ``4 x places_cluster_timeout_seconds`` (60s at the default 15s).

            THAT BOUND IS PER CLUSTER, NOT PER REQUEST, and the two are far
            apart. The per-cluster clock starts AFTER the semaphore is acquired
            (see above), so queue time is charged to nobody: with
            ``MAX_CLUSTERS_PER_REQUEST`` = 25 clusters against a per-request
            share of 5, this phase alone is 5 sequential WAVES — up to
            ``5 x 15s = 75s`` — before the vision join, text rescue, popularity
            probe and enrichment phases begin. Stated honestly, a full request's
            phase-composed worst case is ``waves x phases``, i.e. several
            minutes, which is far past the mobile client's 90s
            ``SUGGEST_PLACES_TIMEOUT_MS`` — and a client timeout fails the
            WHOLE chunk, discarding results already paid for.

            ``request_deadline`` (U8) is the ceiling that actually holds. It is
            a DISPATCH gate, not a cancellation: a cluster that has not started
            when the budget is spent is reported as failed (retryable) and the
            request returns inside the client's window with everything that did
            complete. It cannot bound work already in flight, so the true
            ceiling is the budget PLUS one cluster's remaining phase timeout —
            which is why the budget is set well below 90s rather than at it.
            """
            # Past the request budget: do not start a paid call whose answer
            # the client will not be around to receive.
            if _remaining_budget() <= 0:
                # R27: no cluster id on an always-on log line.
                logger.warning(
                    "Request budget spent before a cluster's search started; "
                    "reporting it as failed rather than overrunning the client"
                )
                return None

            async with semaphore:
                # Re-checked after the queue wait, which is where a large
                # request actually spends its time.
                if _remaining_budget() <= 0:
                    logger.warning(
                        "Request budget spent while a cluster queued for its "
                        "share of the outbound bound; reporting it as failed"
                    )
                    return None
                # Retry backoff and this timeout are ONE budget (U3): the scope
                # caps how much of the cluster's clock jittered backoff may burn
                # across every radius it searches. wait_for's inner task copies
                # the context but shares the budget object.
                try:
                    with retry_budget_scope(retry_budget):
                        search_result = await asyncio.wait_for(
                            self._search_nearby_tiered(
                                latitude=cluster["centroid"]["latitude"],
                                longitude=cluster["centroid"]["longitude"],
                            ),
                            timeout=cluster_timeout,
                        )
                    places = search_result.places
                    radius_used = search_result.radius_used
                except TimeoutError:
                    # R27: no cluster id on an always-on log line.
                    logger.warning(f"Cluster search timed out after {cluster_timeout}s")
                    return None

            # R27: coordinates only behind the diagnostics gate.
            if diagnostics:
                lat = cluster["centroid"]["latitude"]
                lng = cluster["centroid"]["longitude"]
                logger.info(
                    f"Cluster {cluster['id']}: centroid=({lat:.5f}, {lng:.5f}), "
                    f"found {len(places)} quality places at radius={radius_used}m"
                )

            return cluster, places, radius_used, search_result

        # Execute all searches in parallel with bounded concurrency and per-cluster
        # timeout. Timed as the SEARCH phase (U15): the half of the request that
        # KTD16's ordering argument weighs against the vision wait below.
        with phase_timer(PHASE_SEARCH):
            results = await asyncio.gather(
                *[search_with_timeout(c) for c in clusters],
                return_exceptions=True,
            )

        # Await vision results (non-blocking if already done, empty dict on failure).
        # Timed as the VISION_WAIT phase: this is the RESIDUAL wait vision adds on
        # top of search (the two run concurrently), which is exactly the quantity
        # that decides whether widening vision concurrency is the first lever. The
        # classifier separately records its own total wall time under `vision`.
        #
        # The join is bounded (U8). Starlette does not cancel a server-side
        # coroutine when the client gives up at 90s, so an unbounded join let an
        # abandoned request sit here forever while its vision work kept holding
        # process-wide slots. wait_for cancels the task on expiry, which is also
        # what the route's own `finally` does — the work is best-effort, and an
        # empty vision map degrades to distance-ranked results.
        vision_map: dict[str, VisionResult] = {}
        if vision_results_task is not None:
            try:
                with phase_timer(PHASE_VISION_WAIT):
                    vision_map = await asyncio.wait_for(
                        vision_results_task, timeout=cluster_timeout
                    )
            except TimeoutError:
                # R27: no cluster id on an always-on log line.
                logger.warning(
                    "Vision classification exceeded its join budget; "
                    "continuing without vision signals"
                )
            except Exception as e:
                logger.warning(f"Vision classification failed: {e}")

        # Collect successful search results and identify text search needs. The
        # downstream loops keep the lean (cluster, places, radius_used) shape; the
        # full TieredSearchResult per cluster is parked in a parallel dict so only
        # the diagnostic trace pays attention to it.
        search_results: list[tuple[dict, list[dict], int]] = []
        search_result_by_cluster: dict[str, TieredSearchResult] = {}
        failed_count = 0
        # CAPACITY failures, counted apart from ordinary ones (U8). A cluster
        # that timed out or errored is retryable right now; a cluster refused by
        # the circuit breaker, by upstream throttling, or by our own outbound
        # bound is not — retrying it immediately dispatches straight back into
        # the condition that refused it. `failed_cluster_count` alone cannot
        # tell the caller which of the two it is holding.
        #
        # `httpx.PoolTimeout` belongs in this set for exactly the reason
        # `SlotUnavailableError`'s docstring gives: it is the same purely LOCAL
        # saturation signal, differing only in which bound ran out (the
        # connection pool rather than the outbound-slot semaphore). This is a
        # COUNT only — it does not make the pool timeout retryable, nor an
        # upstream rate-limit/timeout signal; `with_google_retry` still excludes
        # it from both, ahead of `TimeoutException`, which it subclasses.
        capacity_failed_count = 0
        capacity_failures = (
            RateLimitError,
            QuotaExhaustedError,
            SlotUnavailableError,
            httpx.PoolTimeout,
        )

        for r in results:
            if r is None or isinstance(r, BaseException):
                failed_count += 1
                if isinstance(r, capacity_failures):
                    capacity_failed_count += 1
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
            radius: float = 200.0,
        ) -> tuple[str, list[dict]]:
            # Same request-budget dispatch gate as the Nearby phase (U8). The
            # rescue already degrades to "fall back to nearby results" on a
            # timeout or a capacity refusal; an overrun budget is one more
            # reason not to start it.
            if _remaining_budget() <= 0:
                logger.warning("Request budget spent; skipping a text rescue")
                return cluster_id, []
            async with semaphore:
                if _remaining_budget() <= 0:
                    logger.warning("Request budget spent; skipping a text rescue")
                    return cluster_id, []
                try:
                    # Bounded by the same per-cluster timeout as the Nearby
                    # phase (U8). The retry budget caps only backoff SLEEPING;
                    # without this the rescue had no wall clock at all.
                    with retry_budget_scope(retry_budget):
                        places = await asyncio.wait_for(
                            self._execute_text_search(
                                text_query, lat, lng, radius=radius
                            ),
                            timeout=cluster_timeout,
                        )
                    if places:
                        places = self._filter_low_quality_places(places)
                        logger.debug(
                            f"Cluster {cluster_id}: text search for "
                            f"'{text_query}' found {len(places)} quality places"
                        )
                    return cluster_id, places
                except TimeoutError:
                    # R27: no cluster id on an always-on log line.
                    logger.warning(
                        f"Text search timed out after {cluster_timeout}s, "
                        "falling back to nearby results"
                    )
                    return cluster_id, []
                except (
                    RateLimitError,
                    QuotaExhaustedError,
                    SlotUnavailableError,
                ) as e:
                    # R27: no cluster id on an always-on log line.
                    logger.warning(
                        f"Text search unavailable ({type(e).__name__}), "
                        "falling back to nearby results"
                    )
                    return cluster_id, []

        broaden_rescue = self._settings.places_text_rescue_on_empty
        landmark_rescue = _guarded_setting(
            self._settings, "places_landmark_text_rescue", True, bool
        )
        landmark_bias_radius = float(
            _guarded_setting(
                self._settings,
                "places_landmark_rescue_bias_radius_m",
                500,
                (int, float),
            )
        )
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

            # C2/U14 broadened rescue (opt-in, default OFF — Enterprise-tier cost).
            # When Nearby returned NOTHING and vision has SOME detected text that
            # is not a strong business-name candidate (e.g. non-Latin signage the
            # strict OCR filter rejects), fire a Text Search on the raw text — it
            # is the only recall path left. Gated to empty Nearby so it can never
            # add cost on top of a populated result, and skipped when the normal
            # business-name path below will already handle it. A cluster with no
            # vision at all has no text to query (the SIGNAL limit, U16).
            if (
                broaden_rescue
                and not nearby_places
                and vision_result is not None
                and vision_result.detected_text
                and not vision_result.has_business_name
            ):
                query = vision_result.detected_text[0].strip()
                if query:
                    lat = cluster["centroid"]["latitude"]
                    lng = cluster["centroid"]["longitude"]
                    text_search_tasks.append(
                        text_search_for_cluster(cluster_id, query, lat, lng)
                    )
                    if diagnostics and cluster_id in traces:
                        traces[cluster_id]["vision"]["text_search_triggered"] = True
                    continue

            # U5 landmark rescue: monument photos usually carry no readable
            # signage, so the business-name path below never fires — yet the
            # venue's Google point often sits beyond the dense-city Nearby
            # radii and is simply never fetched. When vision RECOGNIZES the
            # landmark visually, its name is a free Text Search query. The
            # bias center is quantized to ~110m so every cluster inside the
            # same big venue (Champ de Mars, the Louvre...) shares ONE cached
            # paid search; the wider bias radius reflects large footprints.
            if (
                landmark_rescue
                and vision_result is not None
                and vision_result.category == "landmark"
                and vision_result.confidence != "low"
                and not vision_result.has_business_name
                and getattr(vision_result, "landmark_name", None)
            ):
                query = vision_result.landmark_name.strip()
                already_present = any(
                    name_match_strength(p.get("displayName", {}).get("text", ""), query)
                    == "strong"
                    for p in nearby_places
                )
                if query and not already_present:
                    lat = round(cluster["centroid"]["latitude"], 3)
                    lng = round(cluster["centroid"]["longitude"], 3)
                    text_search_tasks.append(
                        text_search_for_cluster(
                            cluster_id, query, lat, lng, radius=landmark_bias_radius
                        )
                    )
                    if diagnostics and cluster_id in traces:
                        traces[cluster_id]["vision"]["text_search_triggered"] = True
                    continue

            if (
                vision_result is not None
                and confidence_ok
                and vision_result.has_business_name
            ):
                candidates = vision_result.business_name_candidates
                if candidates:
                    # LLM-gating: suppress the (Enterprise-tier) Text Search when the
                    # Nearby result already contains a place whose name STRONG-matches
                    # the vision-detected signage — same venue, so the Text Search
                    # would only re-find it. A weak (containment) match must NOT
                    # suppress: in a real Paris import, 'Eiffel Tower' containment-
                    # matched a nearby Airbnb's marketing name and the search that
                    # would have fetched the actual tower never fired.
                    already_found = any(
                        name_match_strength(
                            p.get("displayName", {}).get("text", ""), candidates[0]
                        )
                        == "strong"
                        for p in nearby_places
                    )
                    if already_found:
                        logger.debug(
                            f"Cluster {cluster_id}: suppressing text search for "
                            f"'{candidates[0]}' — already in nearby results"
                        )
                        continue
                    if (
                        landmark_rescue
                        and vision_result.category == "landmark"
                        and vision_result.confidence != "low"
                    ):
                        # Landmark signage ("EIFFEL TOWER" on a plaque): use the
                        # same coarse-center/wide-radius treatment as the
                        # visual-recognition rescue so big-venue clusters share
                        # one cached search that can actually reach the venue.
                        lat = round(cluster["centroid"]["latitude"], 3)
                        lng = round(cluster["centroid"]["longitude"], 3)
                        radius = landmark_bias_radius
                    else:
                        lat = cluster["centroid"]["latitude"]
                        lng = cluster["centroid"]["longitude"]
                        radius = 200.0
                    text_search_tasks.append(
                        text_search_for_cluster(
                            cluster_id, candidates[0], lat, lng, radius=radius
                        )
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

        # U6 POPULARITY probe (flag-gated, default OFF): last resort for
        # landmark clusters with NO text signal at all — nothing for the U5
        # rescue to query — whose candidate world contains no landmark-family
        # place. One extra Nearby ranked by POPULARITY surfaces the prominent
        # venue the distance-ranked tiers structurally cannot reach.
        probe_map: dict[str, list[dict]] = {}
        popularity_probe = _guarded_setting(
            self._settings, "places_popularity_probe", False, bool
        )
        if popularity_probe:
            landmark_family = VISION_TO_PLACE_TYPES["landmark"]

            async def probe_for_cluster(
                cluster_id: str, lat: float, lng: float
            ) -> tuple[str, list[dict]]:
                # Request-budget dispatch gate (U8), as above. The probe is a
                # last-resort extra call, so it is the first thing to skip.
                if _remaining_budget() <= 0:
                    logger.warning("Request budget spent; skipping a probe")
                    return cluster_id, []
                async with semaphore:
                    if _remaining_budget() <= 0:
                        logger.warning("Request budget spent; skipping a probe")
                        return cluster_id, []
                    try:
                        # Same per-cluster wall clock as the other phases (U8).
                        with retry_budget_scope(retry_budget):
                            places = await asyncio.wait_for(
                                self._execute_popularity_probe(lat, lng),
                                timeout=cluster_timeout,
                            )
                        if places:
                            places = self._filter_low_quality_places(places)
                        return cluster_id, places
                    except TimeoutError:
                        logger.warning(
                            f"Popularity probe timed out after {cluster_timeout}s"
                        )
                        return cluster_id, []
                    except (
                        RateLimitError,
                        QuotaExhaustedError,
                        SlotUnavailableError,
                    ) as e:
                        # R27: no cluster id on an always-on log line.
                        logger.warning(
                            f"Popularity probe unavailable ({type(e).__name__})"
                        )
                        return cluster_id, []

            probe_tasks = []
            for cluster, nearby_places, _radius_used in search_results:
                cluster_id = cluster["id"]
                vision_result = vision_map.get(cluster_id)
                if (
                    vision_result is None
                    or vision_result.category != "landmark"
                    or vision_result.confidence == "low"
                    or vision_result.has_business_name
                    or getattr(vision_result, "landmark_name", None)
                ):
                    continue
                world = text_search_map.get(cluster_id, []) + nearby_places
                if any(landmark_family & set(p.get("types", [])) for p in world):
                    continue
                probe_tasks.append(
                    probe_for_cluster(
                        cluster_id,
                        cluster["centroid"]["latitude"],
                        cluster["centroid"]["longitude"],
                    )
                )

            if probe_tasks:
                probe_results = await asyncio.gather(
                    *probe_tasks, return_exceptions=True
                )
                for pr in probe_results:
                    if isinstance(pr, tuple):
                        probe_map[pr[0]] = pr[1]

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
            # Popularity-probe results are appended: they compete through
            # ranking (the U3 landmark boost lifts the right ones), with no
            # text-result-style priority.
            probe_places = probe_map.get(cluster_id, [])
            if probe_places:
                seen_ids = {p["id"] for p in merged}
                merged = merged + [p for p in probe_places if p["id"] not in seen_ids]
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

            # When the top finalist STRONG-matches vision-detected signage, the
            # ranking outcome is already decided: the full name-match bonus exceeds
            # the maximum combined rating/review/fame advantage any neighbor could
            # gain from enrichment. Skip the (Enterprise-tier) Place Details calls
            # for the whole cluster — pure cost saving, identical top suggestion.
            # A weak (containment) match must NOT lock: its bonus is small enough
            # for enrichment to overturn, and locking would also skip the review
            # re-gate that filters zero-review listings.
            if (
                finalists
                and vision_result is not None
                and any(
                    name_match_strength(finalists[0]["name"], c) == "strong"
                    for c in vision_result.business_name_candidates
                )
            ):
                name_match_locked_clusters.add(cluster_id)
                logger.debug(
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
                with phase_timer(PHASE_ENRICHMENT):
                    enriched_ratings = await self._enrich_place_ratings(
                        list(finalist_ids)
                    )
            except Exception as e:  # never crash the request on enrichment
                logger.warning(f"Rating enrichment unavailable: {e}")
                enriched_ratings = {}

        # Rank and build suggestions with vision data + text search.
        #
        # Two passes (U4). Pass A re-applies the deferred review-count gate to
        # the enriched finalists per cluster and collects the shortfall's
        # backfill candidates; ONE additional global enrichment batch prices
        # those; Pass B gates the enriched backfill and only then tops up with
        # un-gated candidates, so a gate-passing tail place always outranks
        # junk the gate would reject.

        def _with_live_ratings(
            raw: dict[str, Any], ratings_map: dict[str, dict[str, Any]]
        ) -> dict[str, Any]:
            """Merge enriched rating fields onto a raw place dict.

            A resolved Details response with the count field absent means the
            place has NO reviews (Google omits zeros) — normalize to 0 so the
            review gate can evaluate it instead of re-skipping on the absent
            field. Places whose enrichment failed stay untouched (uncertain,
            keep-recallable).
            """
            ratings = ratings_map.get(raw["id"])
            if ratings is None:
                return raw
            merged = {**raw, **ratings}
            if merged.get("userRatingCount") is None:
                merged["userRatingCount"] = 0
            if merged.get("rating") is None:
                merged["rating"] = 0
            return merged

        backfill_limit = _guarded_setting(
            self._settings, "places_enrich_backfill_limit", 3, int
        )

        # None = this cluster skips the enriched path (locked / enrichment down).
        per_cluster_reranked: dict[str, list[dict[str, Any]] | None] = {}
        per_cluster_backfill: dict[str, list[dict[str, Any]]] = {}
        backfill_ids: set[str] = set()

        for cluster, _places, _radius_used in search_results:
            cluster_id = cluster["id"]
            vision_result = vision_map.get(cluster_id)
            finalists = per_cluster_finalists.get(cluster_id, [])

            if not enriched_ratings or cluster_id in name_match_locked_clusters:
                per_cluster_reranked[cluster_id] = None
                continue

            # Merge live ratings back onto the original merged place dicts for
            # just the finalists, then re-rank that small enriched set.
            finalist_place_ids = {p["place_id"] for p in finalists}
            enriched_places = [
                _with_live_ratings(p, enriched_ratings)
                for p in per_cluster_merged.get(cluster_id, [])
                if p["id"] in finalist_place_ids
            ]
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
            per_cluster_reranked[cluster_id] = reranked

            if len(reranked) < MAX_SUGGESTIONS_PER_CLUSTER and backfill_limit > 0:
                surviving_ids = {p["place_id"] for p in reranked}
                tail = [
                    p
                    for p in per_cluster_first_pass.get(cluster_id, [])[
                        MAX_SUGGESTIONS_PER_CLUSTER:
                    ]
                    if p["place_id"] not in surviving_ids
                ][:backfill_limit]
                if tail:
                    per_cluster_backfill[cluster_id] = tail
                    backfill_ids.update(p["place_id"] for p in tail)

        # One bounded global batch for every cluster's backfill candidates —
        # only finalists were enriched, and gating tail places blind would
        # re-open the absent-count bypass this unit closes.
        backfill_ratings: dict[str, dict[str, Any]] = {}
        if backfill_ids:
            try:
                with phase_timer(PHASE_BACKFILL):
                    backfill_ratings = await self._enrich_place_ratings(
                        list(backfill_ids)
                    )
            except Exception as e:  # never crash the request on enrichment
                logger.warning(f"Backfill rating enrichment unavailable: {e}")
                backfill_ratings = {}

        successful = []

        for cluster, _places, _radius_used in search_results:
            cluster_id = cluster["id"]
            vision_result = vision_map.get(cluster_id)
            finalists = per_cluster_finalists.get(cluster_id, [])
            reranked = per_cluster_reranked.get(cluster_id)

            if reranked is None:
                suggestions = finalists
            else:
                if len(reranked) < MAX_SUGGESTIONS_PER_CLUSTER:
                    used_ids = {p["place_id"] for p in reranked}
                    backfill_candidates = per_cluster_backfill.get(cluster_id, [])
                    if backfill_candidates and backfill_ratings:
                        # Gate-approved backfill first, in first-pass order.
                        raw_by_id = {
                            p["id"]: p for p in per_cluster_merged.get(cluster_id, [])
                        }
                        backfill_drops: dict[str, int] | None = (
                            {} if diagnostics else None
                        )
                        gated_backfill = self._filter_low_quality_places(
                            [
                                _with_live_ratings(
                                    raw_by_id[p["place_id"]], backfill_ratings
                                )
                                for p in backfill_candidates
                                if p["place_id"] in raw_by_id
                            ],
                            drop_counts=backfill_drops,
                        )
                        if diagnostics and cluster_id in traces and backfill_drops:
                            enrich_counts = traces[cluster_id][
                                "drop_counts"
                            ].setdefault("enrich", {})
                            for reason, count in backfill_drops.items():
                                enrich_counts[reason] = (
                                    enrich_counts.get(reason, 0) + count
                                )
                        gated_ids = {p["id"] for p in gated_backfill}
                        for candidate in backfill_candidates:
                            if len(reranked) >= MAX_SUGGESTIONS_PER_CLUSTER:
                                break
                            if (
                                candidate["place_id"] in gated_ids
                                and candidate["place_id"] not in used_ids
                            ):
                                reranked.append(candidate)
                                used_ids.add(candidate["place_id"])
                    if len(reranked) < MAX_SUGGESTIONS_PER_CLUSTER:
                        # Un-gated top-up keeps the list full; it can never
                        # displace a gate-approved place above it.
                        filler = [
                            p
                            for p in per_cluster_first_pass.get(cluster_id, [])[
                                MAX_SUGGESTIONS_PER_CLUSTER:
                            ]
                            if p["place_id"] not in used_ids
                        ]
                        reranked.extend(
                            filler[: MAX_SUGGESTIONS_PER_CLUSTER - len(reranked)]
                        )
                if not reranked and finalists:
                    # Terminal guarantee: a cluster non-empty before the gate
                    # is never emptied by it. R27: no cluster id in the message.
                    logger.info(
                        "A cluster's candidates all failed review "
                        "gate; returning un-gated finalists"
                    )
                suggestions = reranked or finalists

            logger.debug(
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

        record_clusters(len(clusters), failed_count)
        self.last_capacity_failed_cluster_count = capacity_failed_count

        if failed_count > 0:
            logger.warning(
                f"Failed to process {failed_count}/{len(clusters)} clusters "
                "(timeouts or errors)"
            )
        if capacity_failed_count > 0:
            # R27: counts only. This is the line that says the failures were
            # OURS (breaker / bound / upstream throttle), not the clusters'.
            logger.warning(
                "%d/%d clusters failed for a capacity reason (rate limit, "
                "circuit breaker, outbound slot bound, or connection pool); an "
                "immediate retry will hit the same condition",
                capacity_failed_count,
                len(clusters),
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
