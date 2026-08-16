"""Failure-mode resilience of the photo place-matching path (U8).

Every test here pins a property that only shows up when something goes wrong,
which is exactly when the previous behaviour was worst:

* a transient upstream fault must not be cached (a 30s Google 503 became 60 days
  of "there is nothing here" for every user);
* a cluster refused for a CAPACITY reason must be countable apart from one that
  merely found nothing, because only the first makes an immediate retry useless;
* every phase of a cluster must have a wall clock, not just the Nearby one;
* the per-request share of the outbound bound must divide among concurrent
  importers rather than being sized for exactly one;
* a joined background task must be bounded, since Starlette does not cancel a
  server-side coroutine when the client gives up.
"""

import asyncio
import contextlib
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import HTTPException

from app.api import photos as photos_api
from app.schemas.photos import PlaceSuggestionRequest
from app.services.place_matcher import PlaceMatcher, places_cache, rate_limit
from app.services.place_matcher import _matcher_search as search_mod
from app.services.place_matcher import instrumentation as instr
from app.services.place_matcher.constants import (
    DEFAULT_CLUSTER_TIMEOUT_SECONDS,
    DEFAULT_REQUEST_BUDGET_SECONDS,
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_CONCURRENT_PLACES_REQUESTS_PROCESS,
    MIN_REVIEW_COUNT,
)
from app.services.place_matcher.exceptions import RateLimitError
from app.services.place_matcher.rate_limit import request_budget_for, with_google_retry

TOKYO_LAT = 35.6762
TOKYO_LNG = 139.6503


def _settings(**overrides: Any) -> MagicMock:
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
    settings.places_max_concurrent_requests = None
    settings.places_max_concurrent_requests_process = None
    for key, value in overrides.items():
        setattr(settings, key, value)
    return settings


def _bind(monkeypatch, settings: MagicMock) -> None:
    monkeypatch.setattr(
        "app.services.place_matcher.matcher.get_settings", lambda: settings
    )
    monkeypatch.setattr(search_mod, "get_settings", lambda: settings)


def _quality_place(place_id: str = "place-1", name: str = "Test Restaurant") -> dict:
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


def _response(status_code: int, places: list[dict] | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = "upstream error"
    response.json.return_value = {"places": places or []}
    return response


def _cluster(cluster_id: str = "cluster-1", lat: float = TOKYO_LAT) -> dict[str, Any]:
    return {
        "id": cluster_id,
        "centroid": {"latitude": lat, "longitude": TOKYO_LNG},
        "photos": [{"asset_id": f"{cluster_id}-photo-1"}],
    }


@pytest.fixture(autouse=True)
async def _clean_cache():
    await places_cache.clear()
    yield
    await places_cache.clear()


@pytest.fixture
def l2_writes(monkeypatch) -> list[tuple[str, list[dict]]]:
    """Record every write-through to the persistent (60-day) L2 cache."""
    writes: list[tuple[str, list[dict]]] = []

    async def spy(key: str, data: list[dict]) -> None:
        writes.append((key, data))

    monkeypatch.setattr(search_mod, "set_search_cache", spy)
    return writes


# ===========================================================================
# A transient upstream fault is never cached
# ===========================================================================


class TestTransientFaultsAreNotCached:
    """`[]` after a 503 is a degraded answer, not knowledge about a place."""

    @pytest.mark.asyncio
    async def test_a_500_never_reaches_the_persistent_cache(
        self, monkeypatch, l2_writes
    ) -> None:
        """The write-through is what makes a 30s blip last 60 days."""
        _bind(monkeypatch, _settings())
        client = AsyncMock()
        client.post = AsyncMock(return_value=_response(500))
        matcher = PlaceMatcher(http_client=client)

        assert await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15) == []

        assert l2_writes == [], (
            "a transient upstream fault was written through to the 60-day "
            "persistent cache as a genuine empty result"
        )

    @pytest.mark.asyncio
    async def test_a_500_does_not_populate_the_in_memory_cache(
        self, monkeypatch, l2_writes
    ) -> None:
        """The next caller must re-issue the search, not inherit the fault."""
        _bind(monkeypatch, _settings())
        statuses = [500, 500, 200]
        calls = {"n": 0}

        async def post(*args: Any, **kwargs: Any) -> Any:
            status = statuses[calls["n"]]
            calls["n"] += 1
            return _response(status, [_quality_place()] if status == 200 else None)

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        assert await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15) == []
        assert await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15) == []
        recovered = await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15)

        assert calls["n"] == 3, "an L1 hit served the failed result"
        assert [p["id"] for p in recovered] == ["place-1"]

    @pytest.mark.asyncio
    async def test_a_genuine_empty_200_is_still_cached(
        self, monkeypatch, l2_writes
    ) -> None:
        """The fix must not stop caching real "nothing here" answers."""
        _bind(monkeypatch, _settings())
        calls = {"n": 0}

        async def post(*args: Any, **kwargs: Any) -> Any:
            calls["n"] += 1
            return _response(200, [])

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        assert await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15) == []
        assert await matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15) == []

        assert calls["n"] == 1, "a genuine empty result stopped being cached"
        assert len(l2_writes) == 1

    @pytest.mark.asyncio
    async def test_text_search_fault_is_not_cached(
        self, monkeypatch, l2_writes
    ) -> None:
        _bind(monkeypatch, _settings())
        calls = {"n": 0}

        async def post(*args: Any, **kwargs: Any) -> Any:
            calls["n"] += 1
            return _response(503)

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        assert await matcher._execute_text_search("Ramen", TOKYO_LAT, TOKYO_LNG) == []
        assert await matcher._execute_text_search("Ramen", TOKYO_LAT, TOKYO_LNG) == []

        assert calls["n"] == 2, "the failed rescue was served from L1"
        assert l2_writes == []

    @pytest.mark.asyncio
    async def test_popularity_probe_fault_is_not_cached(
        self, monkeypatch, l2_writes
    ) -> None:
        _bind(monkeypatch, _settings())
        calls = {"n": 0}

        async def post(*args: Any, **kwargs: Any) -> Any:
            calls["n"] += 1
            return _response(502)

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        assert await matcher._execute_popularity_probe(TOKYO_LAT, TOKYO_LNG) == []
        assert await matcher._execute_popularity_probe(TOKYO_LAT, TOKYO_LNG) == []

        assert calls["n"] == 2
        assert l2_writes == []

    @pytest.mark.asyncio
    async def test_concurrent_waiters_share_the_degraded_result_without_caching_it(
        self, monkeypatch, l2_writes
    ) -> None:
        """One blip must not become a stampede, and must still not be stored."""
        _bind(monkeypatch, _settings())
        started = asyncio.Event()
        release = asyncio.Event()
        calls = {"n": 0}

        async def post(*args: Any, **kwargs: Any) -> Any:
            calls["n"] += 1
            started.set()
            await release.wait()
            return _response(500)

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        owner = asyncio.create_task(matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15))
        await started.wait()
        waiters = [
            asyncio.create_task(matcher._execute_search(TOKYO_LAT, TOKYO_LNG, 15))
            for _ in range(3)
        ]
        await asyncio.sleep(0)
        release.set()
        results = await asyncio.gather(owner, *waiters)

        assert all(r == [] for r in results)
        assert calls["n"] == 1, "the waiters stampeded the failing upstream"
        assert l2_writes == []
        assert places_cache.size == 0, "the fault entered L1"


# ===========================================================================
# Capacity failures are counted apart from ordinary ones
# ===========================================================================


class TestCapacityFailuresAreCountedSeparately:
    """`failed_cluster_count` cannot tell "we refused" from "nothing found"."""

    @pytest.mark.asyncio
    async def test_throttled_clusters_are_reported_as_capacity_failures(
        self, monkeypatch
    ) -> None:
        _bind(monkeypatch, _settings())
        # Keep the breaker out of it so the attribution under test is the
        # upstream 429 itself, not our own refusal (both are capacity, but only
        # one of them is deterministic here).
        monkeypatch.setattr(rate_limit.rate_limit_breaker, "threshold", 10_000)

        async def post(*args: Any, **kwargs: Any) -> Any:
            response = MagicMock()
            response.status_code = 429
            response.json.return_value = {"error": {"status": "RESOURCE_EXHAUSTED"}}
            return response

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        clusters = [_cluster(f"c{i}", TOKYO_LAT + i * 0.02) for i in range(3)]
        results, failed_count = await matcher.find_places_for_clusters(clusters)

        assert results == []
        assert failed_count == 3
        assert matcher.last_capacity_failed_cluster_count == 3, (
            "throttled clusters are indistinguishable from clusters that "
            "legitimately found nothing, so the caller cannot answer busy"
        )

    @pytest.mark.asyncio
    async def test_an_ordinary_timeout_is_not_a_capacity_failure(
        self, monkeypatch
    ) -> None:
        """A slow cluster IS retryable right away; it must not be conflated."""
        _bind(monkeypatch, _settings(places_cluster_timeout_seconds=0.02))

        async def never_returns(latitude: float, longitude: float):
            await asyncio.Event().wait()

        matcher = PlaceMatcher(http_client=AsyncMock())
        monkeypatch.setattr(matcher, "_search_nearby_tiered", never_returns)

        _results, failed_count = await matcher.find_places_for_clusters([_cluster()])

        assert failed_count == 1
        assert matcher.last_capacity_failed_cluster_count == 0

    @pytest.mark.asyncio
    async def test_pool_saturation_is_a_capacity_failure(self, monkeypatch) -> None:
        """``httpx.PoolTimeout`` is local saturation, exactly like a lost slot.

        ``SlotUnavailableError``'s own docstring calls the two the same class of
        purely local signal. Counting one as capacity and the other as an
        ordinary cluster failure returns 200 with inflated failures, which the
        client renders as retry-ENABLED rows plus a "Retry all" control that
        dispatches straight back into the saturated pool.
        """
        _bind(monkeypatch, _settings())

        async def post(*args: Any, **kwargs: Any) -> Any:
            raise httpx.PoolTimeout("no connection became free")

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        clusters = [_cluster(f"c{i}", TOKYO_LAT + i * 0.02) for i in range(2)]
        results, failed_count = await matcher.find_places_for_clusters(clusters)

        assert results == []
        assert failed_count == 2
        assert matcher.last_capacity_failed_cluster_count == 2, (
            "a pool-saturated cluster is reported as an ordinary failure, so "
            "the caller retries straight back into the saturated pool"
        )

    @pytest.mark.asyncio
    async def test_pool_saturation_is_still_never_retried_or_counted_upstream(
        self, monkeypatch
    ) -> None:
        """Counting it as capacity must not make it an upstream signal."""
        _bind(monkeypatch, _settings())
        calls = {"n": 0}

        async def post(*args: Any, **kwargs: Any) -> Any:
            calls["n"] += 1
            raise httpx.PoolTimeout("no connection became free")

        client = AsyncMock()
        client.post = post
        matcher = PlaceMatcher(http_client=client)

        with instr.request_metrics() as metrics:
            await matcher.find_places_for_clusters([_cluster()])

        assert calls["n"] == 1, "the pool-saturated call was retried"
        retries = metrics.snapshot()["retries"]
        assert retries["search_timeouts"] == 0
        assert retries["rate_limited"] == 0

    @pytest.mark.asyncio
    async def test_the_count_is_reset_between_requests(self, monkeypatch) -> None:
        _bind(monkeypatch, _settings())
        monkeypatch.setattr(rate_limit.rate_limit_breaker, "threshold", 10_000)

        responses = {"throttle": True}

        async def post(*args: Any, **kwargs: Any) -> Any:
            if responses["throttle"]:
                response = MagicMock()
                response.status_code = 429
                response.json.return_value = {"error": {"status": "RESOURCE_EXHAUSTED"}}
                return response
            return _response(200, [_quality_place()])

        client = AsyncMock()
        client.post = post
        client.get = AsyncMock(return_value=_response(200))
        matcher = PlaceMatcher(http_client=client)

        await matcher.find_places_for_clusters([_cluster()])
        assert matcher.last_capacity_failed_cluster_count == 1

        responses["throttle"] = False
        await places_cache.clear()
        await matcher.find_places_for_clusters([_cluster("cluster-2")])

        assert matcher.last_capacity_failed_cluster_count == 0

    @pytest.mark.asyncio
    async def test_a_pool_saturated_request_answers_busy_not_a_200(
        self, monkeypatch
    ) -> None:
        """End to end: the route must not hand back retryable failed rows.

        The pool timeout never escapes ``find_places_for_clusters`` (the gather
        collects it), so the route's own ``except httpx.PoolTimeout`` branch is
        not what saves it -- the capacity COUNT is.
        """
        _bind(monkeypatch, _settings())

        async def post(*args: Any, **kwargs: Any) -> Any:
            raise httpx.PoolTimeout("no connection became free")

        client = AsyncMock()
        client.post = post
        monkeypatch.setattr(photos_api, "get_places_client", lambda: client)
        monkeypatch.setattr(
            photos_api, "classify_cluster_photos", AsyncMock(return_value={})
        )

        data = PlaceSuggestionRequest.model_validate(
            {
                "clusters": [
                    {
                        "id": f"c{i}",
                        "centroid": {
                            "latitude": TOKYO_LAT + i * 0.02,
                            "longitude": TOKYO_LNG,
                        },
                        "photos": [
                            {
                                "asset_id": f"c{i}-photo-1",
                                "latitude": TOKYO_LAT + i * 0.02,
                                "longitude": TOKYO_LNG,
                            }
                        ],
                    }
                    for i in range(2)
                ]
            }
        )

        with pytest.raises(HTTPException) as excinfo:
            await photos_api._suggest_places(data)

        assert excinfo.value.status_code == 503
        # Header-less: a genuine quota 503 is the only one that carries
        # Retry-After, and this is a seconds-long local blip.
        assert not (excinfo.value.headers or {})


# ===========================================================================
# Every phase has a wall clock, not just the Nearby one
# ===========================================================================


class TestEveryPhaseIsBounded:
    """The retry budget caps SLEEPING; it is not a timeout."""

    @pytest.mark.asyncio
    async def test_a_hanging_text_rescue_cannot_outlive_its_phase_budget(
        self, monkeypatch
    ) -> None:
        from app.services.photo_vision import VisionResult

        _bind(monkeypatch, _settings(places_cluster_timeout_seconds=0.05))

        async def nearby(latitude: float, longitude: float):
            from app.services.place_matcher import DensityLevel
            from app.services.place_matcher._matcher_search import TieredSearchResult

            return TieredSearchResult(
                places=[_quality_place("place-nearby", "Nearby Cafe")],
                radius_used=15,
                radii_searched={15},
                raw_count_per_radius={15: 1},
                raw_places_per_radius={},
                stopped_early=True,
                density=DensityLevel.DENSE,
            )

        async def hanging_text_search(*args: Any, **kwargs: Any) -> list[dict]:
            await asyncio.Event().wait()
            return []

        matcher = PlaceMatcher(http_client=AsyncMock())
        matcher._client.get = AsyncMock(return_value=_response(200))
        monkeypatch.setattr(matcher, "_search_nearby_tiered", nearby)
        monkeypatch.setattr(matcher, "_execute_text_search", hanging_text_search)

        async def vision():
            return {
                "cluster-1": VisionResult(
                    category="food",
                    detected_text=["Signboard Ramen House"],
                    confidence="high",
                )
            }

        results, failed_count = await asyncio.wait_for(
            matcher.find_places_for_clusters(
                [_cluster()], vision_results_task=asyncio.ensure_future(vision())
            ),
            timeout=5.0,
        )

        assert failed_count == 0
        # The rescue gave up and the cluster kept its Nearby result.
        assert results[0]["places"][0]["place_id"] == "place-nearby"

    @pytest.mark.asyncio
    async def test_a_hanging_enrichment_cannot_outlive_its_phase_budget(
        self, monkeypatch
    ) -> None:
        _bind(monkeypatch, _settings(places_cluster_timeout_seconds=0.05))

        async def hanging_get(*args: Any, **kwargs: Any) -> Any:
            await asyncio.Event().wait()

        client = AsyncMock()
        client.get = hanging_get
        matcher = PlaceMatcher(http_client=client)

        with instr.request_metrics() as metrics:
            enriched = await asyncio.wait_for(
                matcher._enrich_place_ratings(["p-1", "p-2"]), timeout=5.0
            )

        assert enriched == {}, "enrichment must degrade, not hang"
        # And the lost ranking inputs are attributed rather than silent.
        assert metrics.dropped_ranking_inputs[instr.SITE_ENRICHMENT] == 2


# ===========================================================================
# The REQUEST has a ceiling too, not just each cluster
# ===========================================================================


def _tiered(place_id: str = "place-nearby"):
    from app.services.place_matcher import DensityLevel
    from app.services.place_matcher._matcher_search import TieredSearchResult

    return TieredSearchResult(
        places=[_quality_place(place_id, "Nearby Cafe")],
        radius_used=15,
        radii_searched={15},
        raw_count_per_radius={15: 1},
        raw_places_per_radius={},
        stopped_early=True,
        density=DensityLevel.DENSE,
    )


class TestTheRequestItselfIsBounded:
    """The per-cluster timeout bounds a CLUSTER; waves multiply it.

    With MAX_CLUSTERS_PER_REQUEST = 25 against a per-request share of 5, the
    Nearby phase alone is five sequential waves of the per-cluster timeout, and
    the queue wait is charged to nobody's clock. The only wall clock above that
    used to be the mobile client's 90s -- and a client timeout fails the WHOLE
    chunk, discarding results the server already paid Google for.
    """

    @pytest.mark.asyncio
    async def test_a_spent_request_budget_stops_dispatching_new_clusters(
        self, monkeypatch
    ) -> None:
        _bind(
            monkeypatch,
            _settings(
                places_cluster_timeout_seconds=5.0,
                places_max_concurrent_requests=1,
                places_request_budget_seconds=0.05,
            ),
        )
        dispatched = {"n": 0}

        async def slow_nearby(latitude: float, longitude: float):
            dispatched["n"] += 1
            await asyncio.sleep(0.1)
            return _tiered()

        matcher = PlaceMatcher(http_client=AsyncMock())
        monkeypatch.setattr(matcher, "_search_nearby_tiered", slow_nearby)

        clusters = [_cluster(f"c{i}", TOKYO_LAT + i * 0.02) for i in range(3)]
        results, failed_count = await asyncio.wait_for(
            matcher.find_places_for_clusters(clusters), timeout=5.0
        )

        # Wave 1 ran and is never cancelled -- a paid call in flight always
        # finishes. Waves 2 and 3 never start.
        assert dispatched["n"] == 1
        assert len(results) == 1
        assert failed_count == 2, (
            "the request kept dispatching wave after wave past its budget, so "
            "the client's own timeout is the only thing that ends it"
        )

    @pytest.mark.asyncio
    async def test_a_request_inside_its_budget_is_untouched(self, monkeypatch) -> None:
        """The gate must never fire on an ordinary request (R22)."""
        _bind(monkeypatch, _settings(places_max_concurrent_requests=1))

        async def nearby(latitude: float, longitude: float):
            return _tiered()

        matcher = PlaceMatcher(http_client=AsyncMock())
        monkeypatch.setattr(matcher, "_search_nearby_tiered", nearby)

        clusters = [_cluster(f"c{i}", TOKYO_LAT + i * 0.02) for i in range(3)]
        results, failed_count = await matcher.find_places_for_clusters(clusters)

        assert failed_count == 0
        assert len(results) == 3
        assert all(r["places"][0]["place_id"] == "place-nearby" for r in results)

    def test_the_budget_sits_below_the_mobile_clients_own_timeout(self) -> None:
        """75s vs the client's 90s: the SERVER decides how this degrades."""
        assert request_budget_for(_settings()) == DEFAULT_REQUEST_BUDGET_SECONDS
        assert DEFAULT_REQUEST_BUDGET_SECONDS < 90.0
        # ...and above one full wave of the default per-cluster timeout, so an
        # honest request can never be cut short by it.
        assert DEFAULT_REQUEST_BUDGET_SECONDS > 4 * DEFAULT_CLUSTER_TIMEOUT_SECONDS


# ===========================================================================
# The per-request share divides among concurrent importers
# ===========================================================================


class TestAdaptiveOutboundShare:
    """A share sized for exactly one importer starves the second one."""

    def test_a_lone_request_keeps_the_full_configured_share(self) -> None:
        settings = _settings(
            places_max_concurrent_requests=MAX_CONCURRENT_PLACES_REQUESTS,
            places_max_concurrent_requests_process=(
                MAX_CONCURRENT_PLACES_REQUESTS_PROCESS
            ),
        )
        with search_mod.places_request_scope():
            per_request, process = search_mod.resolve_places_concurrency(settings)
        assert (per_request, process) == (
            MAX_CONCURRENT_PLACES_REQUESTS,
            MAX_CONCURRENT_PLACES_REQUESTS_PROCESS,
        )

    def test_the_share_shrinks_as_importers_arrive(self) -> None:
        settings = _settings(
            places_max_concurrent_requests=5,
            places_max_concurrent_requests_process=15,
        )
        with contextlib.ExitStack() as stack:
            for _ in range(6):
                stack.enter_context(search_mod.places_request_scope())
            per_request, _ = search_mod.resolve_places_concurrency(settings)

        # Six requests at the old fixed share wanted 30 slots against 15; the
        # losers burned the 2s slot-wait ceiling and surfaced as failed clusters
        # with no upstream fault anywhere.
        assert per_request == 2

    def test_the_shares_never_oversubscribe_the_ceiling(self) -> None:
        settings = _settings(
            places_max_concurrent_requests=5,
            places_max_concurrent_requests_process=15,
        )
        for importers in range(1, 16):
            with contextlib.ExitStack() as stack:
                for _ in range(importers):
                    stack.enter_context(search_mod.places_request_scope())
                per_request, process = search_mod.resolve_places_concurrency(settings)
            assert per_request >= 1
            assert per_request * importers <= process, (
                f"{importers} importers each claiming {per_request} slots "
                f"oversubscribe the {process}-slot ceiling"
            )

    def test_the_scope_is_released_on_the_way_out(self) -> None:
        before = search_mod.in_flight_place_requests()
        with pytest.raises(RuntimeError):
            with search_mod.places_request_scope():
                raise RuntimeError("boom")
        assert search_mod.in_flight_place_requests() == before

    @pytest.mark.asyncio
    async def test_a_running_request_registers_itself(self, monkeypatch) -> None:
        _bind(monkeypatch, _settings())
        seen: list[int] = []

        async def nearby(latitude: float, longitude: float):
            from app.services.place_matcher import DensityLevel
            from app.services.place_matcher._matcher_search import TieredSearchResult

            seen.append(search_mod.in_flight_place_requests())
            return TieredSearchResult(
                places=[],
                radius_used=0,
                radii_searched=set(),
                raw_count_per_radius={},
                raw_places_per_radius={},
                stopped_early=False,
                density=DensityLevel.SPARSE,
            )

        matcher = PlaceMatcher(http_client=AsyncMock())
        monkeypatch.setattr(matcher, "_search_nearby_tiered", nearby)

        assert search_mod.in_flight_place_requests() == 0
        await matcher.find_places_for_clusters([_cluster()])

        assert seen == [1], "the request did not register its own presence"
        assert search_mod.in_flight_place_requests() == 0

    @pytest.mark.asyncio
    async def test_concurrent_requests_see_each_other(self, monkeypatch) -> None:
        _bind(monkeypatch, _settings())
        both_started = asyncio.Barrier(2)
        seen: list[int] = []

        async def nearby(latitude: float, longitude: float):
            from app.services.place_matcher import DensityLevel
            from app.services.place_matcher._matcher_search import TieredSearchResult

            await both_started.wait()
            seen.append(search_mod.in_flight_place_requests())
            return TieredSearchResult(
                places=[],
                radius_used=0,
                radii_searched=set(),
                raw_count_per_radius={},
                raw_places_per_radius={},
                stopped_early=False,
                density=DensityLevel.SPARSE,
            )

        async def one_request(cluster_id: str) -> None:
            matcher = PlaceMatcher(http_client=AsyncMock())
            monkeypatch.setattr(matcher, "_search_nearby_tiered", nearby)
            await matcher.find_places_for_clusters([_cluster(cluster_id)])

        await asyncio.wait_for(
            asyncio.gather(one_request("a"), one_request("b")), timeout=5.0
        )

        assert seen == [2, 2]
        assert search_mod.in_flight_place_requests() == 0


# ===========================================================================
# The joined vision task is bounded
# ===========================================================================


class TestVisionJoinIsBounded:
    """Starlette leaves the server-side coroutine running after a client gives up."""

    @pytest.mark.asyncio
    async def test_a_never_finishing_vision_task_does_not_hang_the_request(
        self, monkeypatch
    ) -> None:
        _bind(monkeypatch, _settings(places_cluster_timeout_seconds=0.05))

        async def nearby(latitude: float, longitude: float):
            from app.services.place_matcher import DensityLevel
            from app.services.place_matcher._matcher_search import TieredSearchResult

            return TieredSearchResult(
                places=[_quality_place()],
                radius_used=15,
                radii_searched={15},
                raw_count_per_radius={15: 1},
                raw_places_per_radius={},
                stopped_early=True,
                density=DensityLevel.DENSE,
            )

        async def never_classifies() -> dict:
            await asyncio.Event().wait()
            return {}

        matcher = PlaceMatcher(http_client=AsyncMock())
        matcher._client.get = AsyncMock(return_value=_response(200))
        monkeypatch.setattr(matcher, "_search_nearby_tiered", nearby)

        vision_task = asyncio.ensure_future(never_classifies())
        results, failed_count = await asyncio.wait_for(
            matcher.find_places_for_clusters(
                [_cluster()], vision_results_task=vision_task
            ),
            timeout=5.0,
        )

        assert failed_count == 0
        assert results[0]["places"][0]["place_id"] == "place-1"
        # And the abandoned work is stopped, not left holding process slots.
        assert vision_task.cancelled() or vision_task.done()


# ===========================================================================
# The retry loop's terminal path
# ===========================================================================


class TestRetryLoopTerminalPath:
    """`python -O` strips asserts; a stripped guard would `raise None`."""

    @pytest.mark.asyncio
    async def test_an_unreachable_exit_raises_a_descriptive_error(
        self, monkeypatch
    ) -> None:
        # Zero attempts is the only way to reach the terminal path without an
        # error today, which is exactly the shape a future `break` would create.
        monkeypatch.setattr(rate_limit, "GOOGLE_RETRY_MAX_ATTEMPTS", 0)

        async def operation() -> list[dict]:
            return []

        with pytest.raises(RuntimeError, match="without an error"):
            await with_google_retry(operation, site=instr.SITE_NEARBY)

    @pytest.mark.asyncio
    async def test_a_real_failure_still_surfaces_its_own_error(
        self, monkeypatch
    ) -> None:
        """The guard must not swallow the error the loop actually recorded."""

        async def operation() -> list[dict]:
            raise RateLimitError("throttled")

        with pytest.raises(RateLimitError, match="throttled"):
            await with_google_retry(operation, site=instr.SITE_NEARBY)
