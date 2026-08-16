"""Tests for U3: retrying Google 429s at all four call sites.

Covers the four Google call sites (tiered nearby search, text search, the
popularity probe, finalist enrichment), the shared backoff/jitter schedule, the
per-cluster retry budget, the process-wide circuit breaker, and the
single-flight co-waiter hazard that backoff makes more likely.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.services.photo_vision import VisionResult
from app.services.place_matcher import (
    MIN_REVIEW_COUNT,
    PlaceMatcher,
    PlacesCache,
    rate_limit,
)
from app.services.place_matcher import instrumentation as instr
from app.services.place_matcher._matcher_search import TieredSearchResult
from app.services.place_matcher.constants import (
    GOOGLE_RETRY_MAX_ATTEMPTS,
    RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT,
)
from app.services.place_matcher.exceptions import QuotaExhaustedError, RateLimitError
from app.services.place_matcher.rate_limit import (
    RateLimitCircuitBreaker,
    compute_backoff_delay,
    retry_budget_scope,
    with_google_retry,
)

TOKYO_LAT = 35.6762
TOKYO_LNG = 139.6503


def _quality_place(place_id: str = "place-1", name: str = "Test Restaurant") -> dict:
    """A place that survives the quality filter."""
    return {
        "id": place_id,
        "displayName": {"text": name},
        "formattedAddress": "123 Test St",
        "location": {"latitude": TOKYO_LAT, "longitude": TOKYO_LNG},
        "primaryType": "restaurant",
        "types": ["restaurant", "food"],
        "rating": 4.5,
        "userRatingCount": 100,
        "businessStatus": "OPERATIONAL",
    }


def _ok_response(places: list[dict] | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"places": places if places is not None else []}
    return response


def _rate_limited_response() -> MagicMock:
    response = MagicMock()
    response.status_code = 429
    response.json.return_value = {"error": {"status": "RESOURCE_EXHAUSTED"}}
    return response


def _quota_exhausted_response() -> MagicMock:
    response = MagicMock()
    response.status_code = 429
    response.json.return_value = {
        "error": {
            "status": "RESOURCE_EXHAUSTED",
            "details": [{"reason": "QUOTA_EXCEEDED"}],
        }
    }
    return response


def _tiered(places: list[dict], radius_used: int = 15) -> TieredSearchResult:
    from app.services.place_matcher import DensityLevel

    return TieredSearchResult(
        places=places,
        radius_used=radius_used,
        radii_searched={radius_used},
        raw_count_per_radius={radius_used: len(places)},
        raw_places_per_radius={},
        stopped_early=bool(places),
        density=DensityLevel.DENSE,
    )


@pytest.fixture
def mock_settings(monkeypatch):
    """Settings shared by the retry tests."""
    settings = MagicMock()
    settings.google_places_api_key = "test-key"
    settings.places_api_timeout_seconds = 5.0
    settings.places_cluster_timeout_seconds = 15.0
    settings.places_min_quality_results_before_stop = 5
    settings.places_diagnostics = False
    settings.places_extra_search_tier_m = None
    settings.places_min_review_count = MIN_REVIEW_COUNT
    settings.places_text_rescue_on_empty = False
    settings.places_popularity_probe = False
    monkeypatch.setattr(
        "app.services.place_matcher.matcher.get_settings", lambda: settings
    )
    return settings


@pytest.fixture
async def clean_cache():
    from app.services.place_matcher import places_cache

    await places_cache.clear()
    yield
    await places_cache.clear()


@pytest.fixture
def metrics():
    """Enter a request-metrics context so the U3 counters are recorded."""
    with instr.request_metrics() as m:
        yield m


def _cluster(cluster_id: str = "cluster-1", lat: float = TOKYO_LAT) -> dict[str, Any]:
    return {
        "id": cluster_id,
        "centroid": {"latitude": lat, "longitude": TOKYO_LNG},
        "photos": [{"asset_id": f"{cluster_id}-photo-1"}],
    }


# ===========================================================================
# Site 1: tiered nearby search
# ===========================================================================


class TestNearbySearchRetry:
    """The tiered Nearby search retried on timeout only before U3."""

    @pytest.mark.asyncio
    async def test_transient_rate_limit_on_first_radius_retries_and_succeeds(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """A 429 on the first search radius retries with backoff, then succeeds."""
        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return _rate_limited_response()
            return _ok_response([_quality_place()])

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        places = await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15)

        assert [p["id"] for p in places] == ["place-1"]
        assert calls["n"] == 2, "expected exactly one retry"
        assert metrics.retries[instr.RETRY_RATE_LIMITED] == 1
        assert metrics.dropped_ranking_inputs[instr.SITE_NEARBY] == 0

    @pytest.mark.asyncio
    async def test_persistent_rate_limit_fails_only_its_own_cluster(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """Siblings still return suggestions when one cluster stays rate limited."""
        failing_lat = TOKYO_LAT + 0.02

        async def mock_post(*args, **kwargs):
            circle = kwargs["json"]["locationRestriction"]["circle"]
            if abs(circle["center"]["latitude"] - failing_lat) < 1e-9:
                return _rate_limited_response()
            return _ok_response([_quality_place()])

        client = AsyncMock()
        client.post = mock_post
        client.get = AsyncMock(return_value=_ok_response())
        matcher = PlaceMatcher(http_client=client)

        clusters = [
            _cluster("cluster-0", TOKYO_LAT),
            _cluster("cluster-1", failing_lat),
            _cluster("cluster-2", TOKYO_LAT + 0.04),
        ]
        results, failed_count = await matcher.find_places_for_clusters(clusters)

        assert failed_count == 1
        assert {r["cluster_id"] for r in results} == {"cluster-0", "cluster-2"}
        assert all(r["places"] for r in results)
        assert metrics.dropped_ranking_inputs[instr.SITE_NEARBY] >= 1

    @pytest.mark.asyncio
    async def test_quota_exhaustion_is_not_retried(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """A daily quota does not recover inside a request, so do not pay for it."""
        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            return _quota_exhausted_response()

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        with pytest.raises(QuotaExhaustedError):
            await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15)

        assert calls["n"] == 1
        assert metrics.retries[instr.RETRY_QUOTA_EXHAUSTED] == 1
        assert metrics.dropped_ranking_inputs[instr.SITE_NEARBY] == 1

    @pytest.mark.asyncio
    async def test_pool_exhaustion_is_not_retried_or_counted(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """U4's PoolTimeout exclusion survives the U3 backoff helper.

        `httpx.PoolTimeout` subclasses `httpx.TimeoutException`, so without an
        explicit exclusion every retry would queue for the same exhausted pool
        and pool pressure would generate more pool pressure. It is also a local
        condition, so it must not land in the upstream-latency counters.
        """
        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            raise httpx.PoolTimeout("pool exhausted")

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        with pytest.raises(httpx.PoolTimeout):
            await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15)

        assert calls["n"] == 1
        assert metrics.retries[instr.RETRY_SEARCH_TIMEOUT] == 0
        assert metrics.retries[instr.RETRY_RATE_LIMITED] == 0


# ===========================================================================
# Site 2: text search
# ===========================================================================


class TestTextSearchRetry:
    """Text search swallowed a 429 into an empty rescue before U3."""

    @pytest.mark.asyncio
    async def test_transient_rate_limit_retries_rather_than_returning_nothing(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return _rate_limited_response()
            return _ok_response([_quality_place("place-text", "Signboard Ramen")])

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        places = await matcher._execute_text_search(
            "Signboard Ramen", TOKYO_LAT, TOKYO_LNG
        )

        assert [p["id"] for p in places] == ["place-text"]
        assert calls["n"] == 2
        assert metrics.retries[instr.RETRY_RATE_LIMITED] == 1

    @pytest.mark.asyncio
    async def test_persistent_rate_limit_records_a_dropped_ranking_input(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """The rescue still degrades, but it is no longer invisible."""

        async def mock_post(*args, **kwargs):
            return _rate_limited_response()

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        with pytest.raises(RateLimitError):
            await matcher._execute_text_search("Signboard Ramen", TOKYO_LAT, TOKYO_LNG)

        assert metrics.dropped_ranking_inputs[instr.SITE_TEXT_SEARCH] == 1


# ===========================================================================
# Site 3: popularity probe
# ===========================================================================


class TestPopularityProbeRetry:
    """The probe swallowed a 429 into "no prominent venue" before U3."""

    @pytest.mark.asyncio
    async def test_transient_rate_limit_retries_rather_than_returning_nothing(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return _rate_limited_response()
            return _ok_response([_quality_place("place-probe", "Famous Landmark")])

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        places = await matcher._execute_popularity_probe(TOKYO_LAT, TOKYO_LNG)

        assert [p["id"] for p in places] == ["place-probe"]
        assert calls["n"] == 2
        assert metrics.retries[instr.RETRY_RATE_LIMITED] == 1

    @pytest.mark.asyncio
    async def test_persistent_rate_limit_records_a_dropped_ranking_input(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        async def mock_post(*args, **kwargs):
            return _rate_limited_response()

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        with pytest.raises(RateLimitError):
            await matcher._execute_popularity_probe(TOKYO_LAT, TOKYO_LNG)

        assert metrics.dropped_ranking_inputs[instr.SITE_POPULARITY_PROBE] == 1


# ===========================================================================
# Site 4: finalist enrichment
# ===========================================================================


class TestEnrichmentRetry:
    """A 429 here silently removed two of the seven ranking weights."""

    @pytest.mark.asyncio
    async def test_transient_rate_limit_retries_rather_than_dropping_rating(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        calls = {"n": 0}

        async def mock_get(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return _rate_limited_response()
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {"rating": 4.6, "userRatingCount": 250}
            return response

        client = AsyncMock()
        client.get = mock_get
        matcher = PlaceMatcher(http_client=client)

        enriched = await matcher._enrich_place_ratings(["place-1"])

        assert enriched == {"place-1": {"rating": 4.6, "userRatingCount": 250}}
        assert calls["n"] == 2
        assert metrics.retries[instr.RETRY_RATE_LIMITED] == 1
        assert metrics.dropped_ranking_inputs[instr.SITE_ENRICHMENT] == 0

    @pytest.mark.asyncio
    async def test_persistent_rate_limit_is_counted_not_silent(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """A dropped rating is recorded as a signal, and siblings still enrich."""

        async def mock_get(url, *args, **kwargs):
            if url.endswith("place-throttled"):
                return _rate_limited_response()
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {"rating": 4.1, "userRatingCount": 90}
            return response

        client = AsyncMock()
        client.get = mock_get
        matcher = PlaceMatcher(http_client=client)

        enriched = await matcher._enrich_place_ratings(["place-throttled", "place-ok"])

        assert "place-throttled" not in enriched
        assert enriched["place-ok"] == {"rating": 4.1, "userRatingCount": 90}
        assert metrics.dropped_ranking_inputs[instr.SITE_ENRICHMENT] == 1


# ===========================================================================
# Backoff schedule and jitter
# ===========================================================================


class TestBackoffSchedule:
    """Google's guidance: 0.1s initial, doubling, 5s ceiling. Jitter is ours."""

    def test_delays_grow_and_respect_the_ceiling(self) -> None:
        for attempt in range(12):
            assert 0.0 <= compute_backoff_delay(attempt) <= 5.0
        # Late attempts sit at the ceiling band, early ones do not.
        early = [compute_backoff_delay(0) for _ in range(50)]
        late = [compute_backoff_delay(8) for _ in range(50)]
        assert max(early) < min(late)

    def test_delays_include_jitter_so_clusters_do_not_retry_in_lockstep(self) -> None:
        """Two clusters rate limited at the same instant must not sync up."""
        samples = {round(compute_backoff_delay(1), 9) for _ in range(50)}
        assert len(samples) > 1, "backoff is deterministic; a burst would repeat"

    @pytest.mark.asyncio
    async def test_concurrent_rate_limited_callers_sleep_different_amounts(
        self, monkeypatch
    ) -> None:
        slept: list[float] = []

        async def record_sleep(delay: float) -> None:
            slept.append(delay)

        monkeypatch.setattr(rate_limit, "_sleep", record_sleep)

        async def always_rate_limited() -> list[dict]:
            raise RateLimitError("throttled")

        async def one_caller() -> None:
            with pytest.raises(RateLimitError):
                await with_google_retry(always_rate_limited, site=instr.SITE_NEARBY)

        await asyncio.gather(one_caller(), one_caller())

        assert len(slept) == 2 * (GOOGLE_RETRY_MAX_ATTEMPTS - 1)
        assert len(set(slept)) > 1


# ===========================================================================
# Retry budget
# ===========================================================================


class TestRetryBudget:
    """Retry backoff and the per-cluster timeout are ONE budget."""

    @pytest.mark.asyncio
    async def test_backoff_cannot_exceed_its_share_of_the_cluster_budget(
        self, monkeypatch, metrics
    ) -> None:
        cluster_timeout = 1.0
        allowance = cluster_timeout * RETRY_BUDGET_FRACTION_OF_CLUSTER_TIMEOUT
        slept: list[float] = []

        async def record_sleep(delay: float) -> None:
            slept.append(delay)

        monkeypatch.setattr(rate_limit, "_sleep", record_sleep)
        # Force every nominal delay above the whole allowance.
        monkeypatch.setattr(rate_limit, "compute_backoff_delay", lambda _a: 10.0)

        async def always_rate_limited() -> list[dict]:
            raise RateLimitError("throttled")

        with retry_budget_scope(allowance) as budget:
            with pytest.raises(RateLimitError):
                await with_google_retry(always_rate_limited, site=instr.SITE_NEARBY)

        assert sum(slept) <= allowance + 1e-9
        assert budget.remaining_seconds == pytest.approx(0.0)
        assert metrics.retries[instr.RETRY_BUDGET_EXHAUSTED] == 1

    @pytest.mark.asyncio
    async def test_budget_is_shared_across_a_clusters_calls(self, monkeypatch) -> None:
        """Four radii cannot each spend the full allowance."""
        slept: list[float] = []

        async def record_sleep(delay: float) -> None:
            slept.append(delay)

        monkeypatch.setattr(rate_limit, "_sleep", record_sleep)
        monkeypatch.setattr(rate_limit, "compute_backoff_delay", lambda _a: 1.0)

        async def always_rate_limited() -> list[dict]:
            raise RateLimitError("throttled")

        with retry_budget_scope(1.5):
            for _ in range(4):
                with pytest.raises(RateLimitError):
                    await with_google_retry(always_rate_limited, site=instr.SITE_NEARBY)

        assert sum(slept) == pytest.approx(1.5)


# ===========================================================================
# Circuit breaker
# ===========================================================================


class TestCircuitBreaker:
    """Without a breaker, every concurrent cluster is its own retry multiplier."""

    def test_opens_after_the_threshold_within_the_window(self) -> None:
        breaker = RateLimitCircuitBreaker(
            threshold=3, window_seconds=60.0, cooldown_seconds=60.0
        )
        assert not breaker.is_open()
        for _ in range(2):
            breaker.record_rate_limit()
        assert not breaker.is_open()
        breaker.record_rate_limit()
        assert breaker.is_open()

    def test_events_outside_the_window_do_not_accumulate(self) -> None:
        breaker = RateLimitCircuitBreaker(
            threshold=3, window_seconds=0.0, cooldown_seconds=60.0
        )
        for _ in range(10):
            breaker.record_rate_limit()
        # Every prior event ages out immediately, so the window never fills.
        assert not breaker.is_open()

    @pytest.mark.asyncio
    async def test_sustained_rate_limit_trips_breaker_and_caps_outbound_calls(
        self, mock_settings, clean_cache, metrics, monkeypatch
    ) -> None:
        """Fewer total outbound calls than attempts x clusters."""
        monkeypatch.setattr(rate_limit.rate_limit_breaker, "threshold", 4)
        monkeypatch.setattr(rate_limit.rate_limit_breaker, "window_seconds", 60.0)
        monkeypatch.setattr(rate_limit.rate_limit_breaker, "cooldown_seconds", 60.0)

        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            return _rate_limited_response()

        client = AsyncMock()
        client.post = mock_post
        client.get = AsyncMock(return_value=_ok_response())
        matcher = PlaceMatcher(http_client=client)

        cluster_count = 6
        clusters = [
            _cluster(f"cluster-{i}", TOKYO_LAT + i * 0.02) for i in range(cluster_count)
        ]
        _results, failed_count = await matcher.find_places_for_clusters(clusters)

        assert failed_count == cluster_count
        unguarded_worst_case = cluster_count * GOOGLE_RETRY_MAX_ATTEMPTS
        assert calls["n"] < unguarded_worst_case
        assert metrics.retries[instr.RETRY_CIRCUIT_OPEN] > 0

    @pytest.mark.asyncio
    async def test_open_breaker_short_circuits_without_calling_google(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """An open breaker refuses the OUTBOUND call, and is still countable.

        The gate used to sit at the top of `with_google_retry`, so nothing ran
        at all. It now sits at the outbound call (after the cache layers), so
        the assertion that matters is that no HTTP request is issued -- which is
        what the breaker exists to prevent. See
        `test_open_breaker_still_serves_a_warm_cache_hit` for the other half.
        """
        rate_limit.rate_limit_breaker._open_until = float("inf")
        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            return _ok_response([_quality_place()])

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        with pytest.raises(RateLimitError):
            await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15)

        assert calls["n"] == 0, "an outbound Google call was issued anyway"
        assert metrics.retries[instr.RETRY_CIRCUIT_OPEN] == 1
        assert metrics.dropped_ranking_inputs[instr.SITE_NEARBY] == 1

    @pytest.mark.asyncio
    async def test_open_breaker_still_serves_a_warm_cache_hit(
        self, mock_settings, clean_cache, metrics
    ) -> None:
        """A search already in L1 costs nothing, so the breaker must not refuse it.

        The landmark rescue quantizes its bias center to ~110m precisely so many
        clusters share ONE cached paid search, which makes the refused-but-free
        fraction large. Gating at the retry wrapper rejected all of it.
        """
        calls = {"n": 0}

        async def mock_post(*args, **kwargs):
            calls["n"] += 1
            return _ok_response([_quality_place()])

        client = AsyncMock()
        client.post = mock_post
        matcher = PlaceMatcher(http_client=client)

        # Warm the cache while the breaker is closed.
        first = await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15)
        assert [p["id"] for p in first] == ["place-1"]
        assert calls["n"] == 1

        rate_limit.rate_limit_breaker._open_until = float("inf")
        cached = await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15)

        assert [p["id"] for p in cached] == ["place-1"]
        assert calls["n"] == 1, "the cache hit issued an outbound call"
        assert metrics.retries[instr.RETRY_CIRCUIT_OPEN] == 0

    @pytest.mark.asyncio
    async def test_one_upstream_429_is_recorded_once_however_many_waiters(
        self, mock_settings, clean_cache
    ) -> None:
        """A single 429 must be ONE breaker event, not 1 + N.

        The single-flight owner resolves its future with the exception object
        and every waiter re-raises THAT SAME OBJECT out of its own retry frame.
        Counting per frame turned one upstream 429 into `1 + waiters` events, so
        a 12-cluster Paris import sharing one landmark-rescue cache key could
        open a breaker documented as "8 upstream 429s in a 10s window" on a
        single upstream 429.
        """
        events: list[int] = []
        real_record = rate_limit.rate_limit_breaker.record_rate_limit

        def counting_record() -> None:
            events.append(1)
            real_record()

        rate_limit.rate_limit_breaker.record_rate_limit = counting_record  # type: ignore[method-assign]
        try:
            started = asyncio.Event()
            release = asyncio.Event()
            posts = {"n": 0}

            async def mock_post(*args, **kwargs):
                posts["n"] += 1
                started.set()
                await release.wait()
                return _rate_limited_response()

            client = AsyncMock()
            client.post = mock_post
            matcher = PlaceMatcher(http_client=client)

            async def one_caller() -> None:
                with pytest.raises(RateLimitError):
                    await matcher._execute_text_search(
                        "Shared Venue", TOKYO_LAT, TOKYO_LNG
                    )

            owner = asyncio.create_task(one_caller())
            await started.wait()
            waiters = [asyncio.create_task(one_caller()) for _ in range(5)]
            await asyncio.sleep(0)
            release.set()
            await asyncio.gather(owner, *waiters)
        finally:
            rate_limit.rate_limit_breaker.record_rate_limit = real_record  # type: ignore[method-assign]

        # One HTTP 429 per attempt the owner actually made; the five waiters
        # made none of their own.
        assert len(events) == posts["n"], (
            f"{posts['n']} upstream 429(s) produced {len(events)} breaker "
            "events -- waiters re-counted an exception they only observed"
        )
        assert len(events) < 1 + 5 * posts["n"]


# ===========================================================================
# Shared-lookup co-waiter hazard
# ===========================================================================


class TestSingleFlightCoWaiters:
    """Backoff makes owners more likely to be cancelled by a cluster timeout."""

    @pytest.mark.asyncio
    async def test_cancelling_the_owner_does_not_fail_its_co_waiters(self) -> None:
        cache = PlacesCache()
        owner_started = asyncio.Event()
        release_owner = asyncio.Event()
        fetch_calls = {"n": 0}

        async def slow_fetch() -> list[dict]:
            fetch_calls["n"] += 1
            owner_started.set()
            await release_owner.wait()
            return [_quality_place()]

        owner = asyncio.create_task(cache.get_or_fetch("key", slow_fetch))
        await owner_started.wait()

        waiter = asyncio.create_task(cache.get_or_fetch("key", slow_fetch))
        await asyncio.sleep(0)  # let the waiter attach to the in-flight future

        owner.cancel()
        with pytest.raises(asyncio.CancelledError):
            await owner

        # The waiter re-elects itself as owner rather than inheriting a
        # cancellation that was aimed at someone else.
        await owner_started.wait()
        release_owner.set()
        result = await waiter

        assert [p["id"] for p in result] == ["place-1"]
        assert fetch_calls["n"] == 2

    @pytest.mark.asyncio
    async def test_a_waiters_own_cancellation_still_propagates(self) -> None:
        cache = PlacesCache()
        owner_started = asyncio.Event()
        release_owner = asyncio.Event()

        async def slow_fetch() -> list[dict]:
            owner_started.set()
            await release_owner.wait()
            return [_quality_place()]

        owner = asyncio.create_task(cache.get_or_fetch("key", slow_fetch))
        await owner_started.wait()
        waiter = asyncio.create_task(cache.get_or_fetch("key", slow_fetch))
        await asyncio.sleep(0)

        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter

        release_owner.set()
        assert [p["id"] for p in await owner] == ["place-1"]


# ===========================================================================
# R22: ranking is unchanged
# ===========================================================================


class TestRankingUnchangedUnderRetry:
    """R22: the top-ranked place per cluster must not move."""

    @pytest.mark.asyncio
    async def test_recovered_rate_limit_yields_the_same_top_place(
        self, mock_settings, clean_cache
    ) -> None:
        far = {
            **_quality_place("place-far", "Far Cafe"),
            "location": {"latitude": TOKYO_LAT + 0.001, "longitude": TOKYO_LNG},
        }
        near = _quality_place("place-near", "Near Cafe")
        world = [far, near]

        async def make_matcher(fail_first: bool) -> tuple[list[dict], int]:
            from app.services.place_matcher import places_cache

            await places_cache.clear()
            state = {"n": 0}

            async def mock_post(*args, **kwargs):
                state["n"] += 1
                if fail_first and state["n"] == 1:
                    return _rate_limited_response()
                return _ok_response(world)

            client = AsyncMock()
            client.post = mock_post
            client.get = AsyncMock(return_value=_ok_response())
            matcher = PlaceMatcher(http_client=client)
            return await matcher.find_places_for_clusters([_cluster()])

        baseline, _ = await make_matcher(fail_first=False)
        retried, _ = await make_matcher(fail_first=True)

        assert baseline[0]["places"][0]["place_id"] == "place-near"
        assert (
            retried[0]["places"][0]["place_id"] == baseline[0]["places"][0]["place_id"]
        )
        assert [p["place_id"] for p in retried[0]["places"]] == [
            p["place_id"] for p in baseline[0]["places"]
        ]

    @pytest.mark.asyncio
    async def test_rescued_text_search_still_wins_after_a_retry(
        self, mock_settings, clean_cache, monkeypatch
    ) -> None:
        """A throttled-then-recovered text search must not lose to nearby."""
        nearby = [_quality_place("place-nearby", "Nearby Cafe")]
        text_hit = [_quality_place("place-text", "Signboard Ramen House")]
        calls = {"n": 0}

        async def mock_search_nearby_tiered(
            latitude: float, longitude: float
        ) -> TieredSearchResult:
            return _tiered(nearby)

        async def mock_execute_text_search(
            text_query: str, latitude: float, longitude: float, radius: float = 200.0
        ) -> list[dict]:
            calls["n"] += 1
            if calls["n"] == 1:
                raise RateLimitError("throttled")
            return text_hit

        client = AsyncMock()
        matcher = PlaceMatcher(http_client=client)
        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(
            matcher, "_execute_text_search_once", mock_execute_text_search
        )

        async def vision():
            return {
                "cluster-1": VisionResult(
                    category="food",
                    detected_text=["Signboard Ramen House"],
                    confidence="high",
                )
            }

        results, failed_count = await matcher.find_places_for_clusters(
            [_cluster()], vision_results_task=asyncio.ensure_future(vision())
        )

        assert failed_count == 0
        assert calls["n"] == 2, "the rate-limited rescue must be retried"
        assert results[0]["places"][0]["place_id"] == "place-text"
