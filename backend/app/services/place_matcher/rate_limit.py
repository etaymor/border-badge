"""Retry, jittered backoff, and a rate-limit circuit breaker (U3).

Before this module the four Google call sites disagreed about what a 429 means.
Tiered Nearby search retried on *timeout only*, so a rate-limit response
propagated and failed the whole cluster. Text search and the popularity probe
swallowed the same response into an empty result plus a log line — a rescue
that silently did not happen, invisible to every guardrail. Finalist enrichment
returned nothing on any non-success, dropping rating and review count (two of
the seven ranking weights) with no trace at all.

All four now route through :func:`with_google_retry`, which supplies:

* **Backoff with jitter.** Google's guidance is 0.1s initial, doubling, 5s
  ceiling. Jitter is not in that guidance, but synchronized retries across
  concurrently rate-limited clusters are exactly the pattern the guidance warns
  about, so each delay is spread across a band around its nominal value.
* **A bounded share of the per-cluster budget.** Retry backoff and the
  per-cluster timeout are ONE budget, not two. Sleeping is only allowed to
  consume :data:`RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT` of the per-cluster
  timeout (40% — 6s of the default 15s), leaving the majority for actual
  outbound work. The budget is shared across every call a cluster makes, not
  reset per call, so four radii cannot each spend the full share.
* **A process-wide circuit breaker.** Under sustained throttling every
  concurrent cluster would otherwise become an independent retry multiplier,
  converting rate pressure into more rate pressure. Once upstream 429s cross a
  threshold within a window, new outbound attempts short-circuit for a cooldown
  and raise :class:`RateLimitError` immediately — the retry-disabled outcome
  the API route already maps to a 429 response.

Privacy (R27): nothing here logs or records a coordinate, cluster id, geohash,
or place id. Call sites are identified by a static site name.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections import deque
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, TypeVar

import httpx

from . import instrumentation
from .constants import (
    DEFAULT_CLUSTER_TIMEOUT_SECONDS,
    GOOGLE_RETRY_INITIAL_DELAY_SECONDS,
    GOOGLE_RETRY_JITTER_RATIO,
    GOOGLE_RETRY_MAX_ATTEMPTS,
    GOOGLE_RETRY_MAX_DELAY_SECONDS,
    RATE_LIMIT_BREAKER_COOLDOWN_SECONDS,
    RATE_LIMIT_BREAKER_THRESHOLD,
    RATE_LIMIT_BREAKER_WINDOW_SECONDS,
    RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT,
)
from .exceptions import QuotaExhaustedError, RateLimitError

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Indirection so tests can substitute the sleep without patching the asyncio
# module globally, and without the suite ever waiting for a real backoff.
_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep


# ---------------------------------------------------------------------------
# Backoff schedule
# ---------------------------------------------------------------------------


def compute_backoff_delay(attempt: int) -> float:
    """Return the jittered delay to wait before retry number ``attempt``.

    ``attempt`` is 0-based: 0 is the wait after the first failure. The nominal
    schedule doubles from :data:`GOOGLE_RETRY_INITIAL_DELAY_SECONDS` up to
    :data:`GOOGLE_RETRY_MAX_DELAY_SECONDS`, then each value is multiplied by a
    random factor in ``[1 - ratio, 1 + ratio]`` and re-clamped to the ceiling.

    The jitter is the point: without it, every cluster rate-limited by the same
    upstream response retries at the same instant and reproduces the burst.
    """
    nominal = GOOGLE_RETRY_INITIAL_DELAY_SECONDS * (2**attempt)
    nominal = min(nominal, GOOGLE_RETRY_MAX_DELAY_SECONDS)
    low = max(0.0, 1.0 - GOOGLE_RETRY_JITTER_RATIO)
    high = 1.0 + GOOGLE_RETRY_JITTER_RATIO
    jittered = nominal * random.uniform(low, high)
    return min(max(0.0, jittered), GOOGLE_RETRY_MAX_DELAY_SECONDS)


# ---------------------------------------------------------------------------
# Per-cluster retry budget
# ---------------------------------------------------------------------------


@dataclass
class RetryBudget:
    """The slice of a cluster's timeout that backoff sleeping may consume."""

    remaining_seconds: float
    consumed_seconds: float = 0.0

    def take(self, requested_seconds: float) -> float:
        """Reserve up to ``requested_seconds`` of sleep, returning what was granted.

        A grant of 0 means the budget is spent: the caller must stop retrying
        rather than sleep on credit the per-cluster timeout cannot cover.
        """
        granted = min(max(0.0, requested_seconds), self.remaining_seconds)
        if granted <= 0:
            return 0.0
        self.remaining_seconds -= granted
        self.consumed_seconds += granted
        return granted


_retry_budget_var: ContextVar[RetryBudget | None] = ContextVar(
    "place_matcher_retry_budget", default=None
)


def budget_seconds_for(settings: Any) -> float:
    """Retry-sleep allowance derived from the per-cluster timeout.

    Stated explicitly because it is the one number that keeps retries and the
    per-cluster timeout from being sized independently: backoff may spend at
    most :data:`RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT` of the cluster budget.
    """
    raw = getattr(settings, "places_cluster_timeout_seconds", None)
    timeout = (
        float(raw)
        if isinstance(raw, int | float) and not isinstance(raw, bool)
        else DEFAULT_CLUSTER_TIMEOUT_SECONDS
    )
    return timeout * RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT


@contextmanager
def retry_budget_scope(total_seconds: float) -> Iterator[RetryBudget]:
    """Install a retry-sleep budget for the enclosed work.

    Entered per cluster-scoped unit of work. ``asyncio`` tasks copy the context
    at creation, but the copy holds a *reference* to the same mutable budget, so
    a scope entered before :func:`asyncio.wait_for` still bounds the inner task.
    """
    budget = RetryBudget(remaining_seconds=max(0.0, total_seconds))
    token = _retry_budget_var.set(budget)
    try:
        yield budget
    finally:
        _retry_budget_var.reset(token)


def current_retry_budget() -> RetryBudget | None:
    """Return the active retry budget, or None outside a scope."""
    return _retry_budget_var.get()


# ---------------------------------------------------------------------------
# Process-wide rate-limit circuit breaker
# ---------------------------------------------------------------------------


@dataclass
class RateLimitCircuitBreaker:
    """Short-circuits outbound Google calls while upstream is throttling us.

    Retries are per call site, but rate pressure is a property of the whole
    process: with N clusters in flight, an unguarded retry policy multiplies a
    throttled upstream by N. This tracks 429s in a shared sliding window and,
    once they cross the threshold, refuses new attempts for a cooldown.
    """

    threshold: int = RATE_LIMIT_BREAKER_THRESHOLD
    window_seconds: float = RATE_LIMIT_BREAKER_WINDOW_SECONDS
    cooldown_seconds: float = RATE_LIMIT_BREAKER_COOLDOWN_SECONDS
    _events: deque[float] = field(default_factory=deque, repr=False)
    _open_until: float = 0.0

    def record_rate_limit(self) -> None:
        """Record one upstream rate-limit response; open the breaker if hot."""
        now = time.monotonic()
        self._prune(now)
        self._events.append(now)
        if len(self._events) >= self.threshold and now >= self._open_until:
            self._open_until = now + self.cooldown_seconds
            self._events.clear()
            logger.warning(
                "Places rate-limit circuit breaker opened for %.1fs "
                "(%d rate limits within %.1fs)",
                self.cooldown_seconds,
                self.threshold,
                self.window_seconds,
            )

    def is_open(self) -> bool:
        """True while new outbound attempts should be refused."""
        return time.monotonic() < self._open_until

    def reset(self) -> None:
        """Clear all state. Used between tests and on explicit recovery."""
        self._events.clear()
        self._open_until = 0.0

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._events and self._events[0] < cutoff:
            self._events.popleft()


# Process-wide instance: one upstream, one breaker.
rate_limit_breaker = RateLimitCircuitBreaker()


# ---------------------------------------------------------------------------
# The shared retry wrapper
# ---------------------------------------------------------------------------


async def with_google_retry(
    operation: Callable[[], Awaitable[T]],
    *,
    site: str,
    retry_on_timeout: bool = True,
) -> T:
    """Run one Google call site with jittered backoff, budget cap, and breaker.

    Retries :class:`RateLimitError` and (optionally) ``httpx.TimeoutException``.
    Two exclusions are deliberate:

    * :class:`QuotaExhaustedError` — a daily quota does not recover inside a
      request, so retrying only spends budget.
    * ``httpx.PoolTimeout`` (U4) — local connection-pool saturation, not a slow
      upstream. It subclasses ``TimeoutException``, so without an explicit
      exclusion every retry would queue for the same exhausted pool and pool
      pressure would generate more pool pressure. It is also not counted as a
      rate-limit or upstream-timeout signal, which would mix a purely local
      condition into the upstream-latency metrics.

    Args:
        operation: Zero-argument async callable performing the attempt.
        site: One of ``instrumentation.SITES``; used only for counters/logging.
        retry_on_timeout: False for sites where a timeout should surface at
            once rather than being re-paid for.

    Returns:
        Whatever ``operation`` returns.

    Raises:
        The last error, once the attempt limit, the retry budget, or the
        circuit breaker stops the loop. Every such exit also records a
        dropped-ranking-input signal for ``site``.
    """
    last_error: BaseException | None = None

    for attempt in range(GOOGLE_RETRY_MAX_ATTEMPTS):
        if rate_limit_breaker.is_open():
            instrumentation.record_retry(instrumentation.RETRY_CIRCUIT_OPEN)
            instrumentation.record_dropped_ranking_input(site)
            raise RateLimitError(
                f"Places rate-limit circuit breaker open (site={site})"
            )

        try:
            return await operation()
        except QuotaExhaustedError:
            # The attempt itself already counted the upstream response
            # (RETRY_QUOTA_EXHAUSTED / RETRY_RATE_LIMITED, U15); this loop only
            # adds the signals U15 has no view of.
            instrumentation.record_dropped_ranking_input(site)
            raise
        except RateLimitError as error:
            rate_limit_breaker.record_rate_limit()
            last_error = error
        except httpx.PoolTimeout:
            # U4: never retried, never counted. Checked BEFORE TimeoutException,
            # which it subclasses.
            raise
        except httpx.TimeoutException as error:
            if not retry_on_timeout:
                instrumentation.record_dropped_ranking_input(site)
                raise
            last_error = error

        if attempt == GOOGLE_RETRY_MAX_ATTEMPTS - 1:
            break

        delay = compute_backoff_delay(attempt)
        budget = current_retry_budget()
        granted = budget.take(delay) if budget is not None else delay
        if granted <= 0:
            instrumentation.record_retry(instrumentation.RETRY_BUDGET_EXHAUSTED)
            logger.warning(
                "Places retry budget exhausted at site=%s after %d attempt(s)",
                site,
                attempt + 1,
            )
            break
        await _sleep(granted)

    instrumentation.record_dropped_ranking_input(site)
    assert last_error is not None  # loop only exits here after a failure
    raise last_error
