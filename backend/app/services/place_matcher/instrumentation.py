"""Request-scoped instrumentation for the photo place-matching path (U15).

Nothing on this path measured itself before this module: the split between the
vision wait and the Places search — the number the concurrency work is sized
against — could only be guessed at. This records it, plus the cache composition
that makes a latency number interpretable at all (a warm persistent cache turns
a "fast" run into a meaningless one) and the outbound dispatch shape the quota
comparison needs.

Privacy (R27): every value recorded here is a per-request AGGREGATE. No
coordinate, cluster id, geohash, or place id is ever stored on the metrics
object or emitted in the log line, so the always-on emission is safe to keep on
in production.

Usage::

    with request_metrics():           # outermost caller owns emission
        ...
        with phase_timer(PHASE_SEARCH):
            ...
        with track_outbound(METHOD_NEARBY):
            await client.post(...)

The context is entered by the API route (so the vision task, whose context is
copied at ``create_task`` time, records into the same object) and *joined* by
:meth:`PlaceMatcher.find_places_for_clusters`. A service-level caller that
enters no context of its own therefore still gets a full emission, because
``find_places_for_clusters`` becomes the owner in that case.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Greppable event name for the per-request phase/dispatch metrics line.
PHASE_METRICS_EVENT = "place_matcher_phase_metrics"

# The four phases KTD16's ordering argument is decided on.
PHASE_SEARCH = "search"
PHASE_VISION_WAIT = "vision_wait"
PHASE_ENRICHMENT = "enrichment"
PHASE_BACKFILL = "backfill"
PHASES: tuple[str, ...] = (
    PHASE_SEARCH,
    PHASE_VISION_WAIT,
    PHASE_ENRICHMENT,
    PHASE_BACKFILL,
)

# Outbound call methods (also the cache-composition buckets).
METHOD_NEARBY = "nearby"
METHOD_TEXT_SEARCH = "text_search"
METHOD_POPULARITY_PROBE = "popularity_probe"
METHOD_PLACE_DETAILS = "place_details"
METHODS: tuple[str, ...] = (
    METHOD_NEARBY,
    METHOD_TEXT_SEARCH,
    METHOD_POPULARITY_PROBE,
    METHOD_PLACE_DETAILS,
)

# Where a lookup was served from. Every attempted lookup lands in exactly one
# bucket, so the four always sum to the lookup count.
SOURCE_L1 = "l1_hits"
SOURCE_L2 = "l2_hits"
SOURCE_SINGLE_FLIGHT = "single_flight_waits"
SOURCE_API = "google_calls"
SOURCES: tuple[str, ...] = (SOURCE_L1, SOURCE_L2, SOURCE_SINGLE_FLIGHT, SOURCE_API)

# Retry / throttling counters (R18).
RETRY_SEARCH_TIMEOUT = "search_timeouts"
RETRY_RATE_LIMITED = "rate_limited"
RETRY_QUOTA_EXHAUSTED = "quota_exhausted"
# U3: an outbound attempt the process-wide circuit breaker refused to make, and
# a retry the per-cluster backoff budget refused to pay for. Both are decisions
# WE made rather than upstream responses, so they get their own kinds —
# otherwise a quiet breaker and a quiet upstream look identical in the line.
RETRY_CIRCUIT_OPEN = "circuit_open"
RETRY_BUDGET_EXHAUSTED = "retry_budget_exhausted"
# U7: an outbound call abandoned because no process-wide slot came free within
# the wait ceiling. Also a decision WE made, and the one signal that says the
# module-level concurrency bound — not Google, not the pool — is the binding
# constraint, so it is the number to read before raising that bound.
RETRY_SLOT_UNAVAILABLE = "slot_unavailable"
RETRY_KINDS: tuple[str, ...] = (
    RETRY_SEARCH_TIMEOUT,
    RETRY_RATE_LIMITED,
    RETRY_QUOTA_EXHAUSTED,
    RETRY_CIRCUIT_OPEN,
    RETRY_BUDGET_EXHAUSTED,
    RETRY_SLOT_UNAVAILABLE,
)

# U3 call sites. A ranking input that never arrived is attributed to the site
# that failed to fetch it, so a silent degradation is countable rather than an
# absence. Site names are static strings — no coordinate, cluster id, or place
# id is involved (R27).
SITE_NEARBY = "nearby"
SITE_TEXT_SEARCH = "text_search"
SITE_POPULARITY_PROBE = "popularity_probe"
SITE_ENRICHMENT = "enrichment"
SITES: tuple[str, ...] = (
    SITE_NEARBY,
    SITE_TEXT_SEARCH,
    SITE_POPULARITY_PROBE,
    SITE_ENRICHMENT,
)

# U12 vision-null outcomes. A classification that returns nothing costs the
# cluster its business-name and landmark signals and drops it back to a
# distance-ranked result — a silent degradation that a bare null COUNT cannot
# explain. These say WHY the null happened, so a rise after the concurrency
# bound is widened is attributable (timeouts) rather than merely visible.
# Static strings only — no coordinate, cluster id, or place id (R27).
VISION_NULL_TIMEOUT = "timeout"
VISION_NULL_HTTP_ERROR = "http_error"
VISION_NULL_REQUEST_ERROR = "request_error"
VISION_NULL_EMPTY_RESPONSE = "empty_response"
VISION_NULL_NO_API_KEY = "no_api_key"
VISION_NULL_EXCEPTION = "exception"
# Our OWN process-wide vision bound was saturated, so the image was never sent.
# Distinct from `timeout` on purpose: a timeout says the model was slow, this
# says we throttled ourselves. Conflating them would make a self-inflicted
# capacity limit look like an upstream regression on the dashboard.
VISION_NULL_SLOT_UNAVAILABLE = "slot_unavailable"
VISION_NULL_UNKNOWN = "unknown"
VISION_NULL_REASONS: tuple[str, ...] = (
    VISION_NULL_TIMEOUT,
    VISION_NULL_HTTP_ERROR,
    VISION_NULL_REQUEST_ERROR,
    VISION_NULL_EMPTY_RESPONSE,
    VISION_NULL_NO_API_KEY,
    VISION_NULL_EXCEPTION,
    VISION_NULL_SLOT_UNAVAILABLE,
    VISION_NULL_UNKNOWN,
)


@dataclass
class RequestMetrics:
    """Aggregate counters for one place-suggestion request."""

    started_at: float = field(default_factory=time.perf_counter)
    cluster_count: int = 0
    failed_cluster_count: int = 0
    phase_ms: dict[str, float] = field(
        default_factory=lambda: {phase: 0.0 for phase in PHASES}
    )
    cache: dict[str, int] = field(
        default_factory=lambda: {source: 0 for source in SOURCES}
    )
    outbound_by_method: dict[str, int] = field(
        default_factory=lambda: {method: 0 for method in METHODS}
    )
    retries: dict[str, int] = field(
        default_factory=lambda: {kind: 0 for kind in RETRY_KINDS}
    )
    # U3: ranking inputs that were dropped after the retry budget was spent,
    # attributed to the call site that could not supply them.
    dropped_ranking_inputs: dict[str, int] = field(
        default_factory=lambda: {site: 0 for site in SITES}
    )
    # Vision aggregates (R18 vision-null rate). Populated by the classifier.
    vision_clusters_attempted: int = 0
    vision_clusters_classified: int = 0
    vision_images_attempted: int = 0
    vision_images_null: int = 0
    vision_total_ms: float = 0.0
    # Why the null images were null (U12). Sums to vision_images_null.
    vision_null_reasons: dict[str, int] = field(
        default_factory=lambda: {reason: 0 for reason in VISION_NULL_REASONS}
    )

    # Live/peak outbound concurrency. asyncio is single-threaded here, so a
    # plain counter is exact without a lock.
    concurrent_outbound: int = 0
    peak_concurrent_outbound: int = 0

    def record_phase(self, phase: str, duration_ms: float) -> None:
        """Add to a phase's accumulated duration."""
        self.phase_ms[phase] = self.phase_ms.get(phase, 0.0) + duration_ms

    def record_cache_lookup(self, source: str) -> None:
        """Attribute one attempted lookup to the layer that served it."""
        self.cache[source] = self.cache.get(source, 0) + 1

    def record_retry(self, kind: str) -> None:
        """Count a timeout retry / rate-limit / quota rejection."""
        self.retries[kind] = self.retries.get(kind, 0) + 1

    def record_dropped_ranking_input(self, site: str) -> None:
        """Count a ranking input a call site could not supply (U3)."""
        self.dropped_ranking_inputs[site] = self.dropped_ranking_inputs.get(site, 0) + 1

    def enter_outbound(self, method: str) -> None:
        """Mark an outbound Google call as starting."""
        self.outbound_by_method[method] = self.outbound_by_method.get(method, 0) + 1
        self.concurrent_outbound += 1
        self.peak_concurrent_outbound = max(
            self.peak_concurrent_outbound, self.concurrent_outbound
        )

    def exit_outbound(self) -> None:
        """Mark an outbound Google call as finished."""
        self.concurrent_outbound = max(0, self.concurrent_outbound - 1)

    @property
    def elapsed_ms(self) -> float:
        """Wall-clock milliseconds since the context was entered."""
        return (time.perf_counter() - self.started_at) * 1000

    def snapshot(self) -> dict[str, object]:
        """Build the emitted payload. Aggregates only — see R27."""
        elapsed_ms = self.elapsed_ms
        elapsed_s = elapsed_ms / 1000 if elapsed_ms > 0 else 0.0
        outbound_total = sum(self.outbound_by_method.values())
        lookups = sum(self.cache.values())
        vision_attempted = self.vision_clusters_attempted
        vision_null = vision_attempted - self.vision_clusters_classified
        return {
            "clusters": self.cluster_count,
            "failed_clusters": self.failed_cluster_count,
            "total_ms": round(elapsed_ms, 1),
            "phase_ms": {
                phase: round(self.phase_ms.get(phase, 0.0), 1) for phase in PHASES
            },
            "cache": {
                "lookups": lookups,
                **{source: self.cache.get(source, 0) for source in SOURCES},
            },
            "outbound": {
                "total": outbound_total,
                "peak_concurrent": self.peak_concurrent_outbound,
                "by_method": dict(self.outbound_by_method),
                "requests_per_second": {
                    method: (round(count / elapsed_s, 2) if elapsed_s else 0.0)
                    for method, count in self.outbound_by_method.items()
                },
                "overall_requests_per_second": (
                    round(outbound_total / elapsed_s, 2) if elapsed_s else 0.0
                ),
            },
            "retries": dict(self.retries),
            "dropped_ranking_inputs": {
                "total": sum(self.dropped_ranking_inputs.values()),
                **dict(self.dropped_ranking_inputs),
            },
            "vision": {
                "clusters_attempted": vision_attempted,
                "clusters_classified": self.vision_clusters_classified,
                "clusters_null": vision_null,
                "null_rate": (
                    round(vision_null / vision_attempted, 3)
                    if vision_attempted
                    else 0.0
                ),
                "images_attempted": self.vision_images_attempted,
                "images_null": self.vision_images_null,
                "null_reasons": dict(self.vision_null_reasons),
                "total_ms": round(self.vision_total_ms, 1),
            },
        }


_metrics_var: ContextVar[RequestMetrics | None] = ContextVar(
    "place_matcher_request_metrics", default=None
)


def current_metrics() -> RequestMetrics | None:
    """Return the active request metrics, or None outside a context."""
    return _metrics_var.get()


@contextmanager
def request_metrics() -> Iterator[RequestMetrics]:
    """Enter — or join — the request-scoped metrics context.

    The caller that CREATES the context also emits it on exit (including on an
    exception, so a failed request still reports what it managed to do). A
    nested caller simply joins and emits nothing.
    """
    existing = _metrics_var.get()
    if existing is not None:
        yield existing
        return

    metrics = RequestMetrics()
    token = _metrics_var.set(metrics)
    try:
        yield metrics
    finally:
        _metrics_var.reset(token)
        emit(metrics)


def emit(metrics: RequestMetrics) -> None:
    """Emit the per-request phase/dispatch metrics line."""
    payload = metrics.snapshot()
    logger.info(
        "%s %s",
        PHASE_METRICS_EVENT,
        json.dumps(payload),
        extra={"place_matcher_metrics": payload},
    )


@contextmanager
def phase_timer(phase: str) -> Iterator[None]:
    """Accumulate wall time for one phase. No-op outside a metrics context."""
    metrics = _metrics_var.get()
    if metrics is None:
        yield
        return
    start = time.perf_counter()
    try:
        yield
    finally:
        metrics.record_phase(phase, (time.perf_counter() - start) * 1000)


@contextmanager
def track_outbound(method: str) -> Iterator[None]:
    """Count one outbound Google call and track peak concurrency."""
    metrics = _metrics_var.get()
    if metrics is None:
        yield
        return
    metrics.enter_outbound(method)
    try:
        yield
    finally:
        metrics.exit_outbound()


def record_cache_lookup(source: str) -> None:
    """Attribute one attempted lookup to the layer that served it."""
    metrics = _metrics_var.get()
    if metrics is not None:
        metrics.record_cache_lookup(source)


def record_retry(kind: str) -> None:
    """Count a timeout retry / rate-limit / quota rejection."""
    metrics = _metrics_var.get()
    if metrics is not None:
        metrics.record_retry(kind)


def record_dropped_ranking_input(site: str) -> None:
    """Count a ranking input a call site could not supply (U3).

    A rating, a review count, or a rescue result that never arrived used to be
    indistinguishable from one that legitimately did not exist. Counting it
    here turns the silent degradation into a signal a guardrail can read.
    """
    metrics = _metrics_var.get()
    if metrics is not None:
        metrics.record_dropped_ranking_input(site)


def record_clusters(cluster_count: int, failed_cluster_count: int) -> None:
    """Record the cluster totals for the request."""
    metrics = _metrics_var.get()
    if metrics is not None:
        metrics.cluster_count = cluster_count
        metrics.failed_cluster_count = failed_cluster_count


def record_vision(
    *,
    clusters_attempted: int,
    clusters_classified: int,
    images_attempted: int,
    images_null: int,
    total_ms: float,
    null_reasons: dict[str, int] | None = None,
) -> None:
    """Record the vision aggregates (drives the R18 vision-null rate).

    ``null_reasons`` (U12) attributes the null images to the outcome that
    produced them — a timeout under a widened concurrency bound is otherwise
    indistinguishable from a model that simply had nothing to say.
    """
    metrics = _metrics_var.get()
    if metrics is None:
        return
    metrics.vision_clusters_attempted += clusters_attempted
    metrics.vision_clusters_classified += clusters_classified
    metrics.vision_images_attempted += images_attempted
    metrics.vision_images_null += images_null
    metrics.vision_total_ms += total_ms
    for reason, count in (null_reasons or {}).items():
        if not count:
            continue
        key = reason if reason in VISION_NULL_REASONS else VISION_NULL_UNKNOWN
        metrics.vision_null_reasons[key] = (
            metrics.vision_null_reasons.get(key, 0) + count
        )
