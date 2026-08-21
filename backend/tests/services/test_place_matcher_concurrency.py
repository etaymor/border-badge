"""Bounded outbound concurrency and single-flight enrichment (U7).

Before this unit the only concurrency bound on the Places fan-out was
per-request: N concurrent imports multiplied straight through to N x 5 in-flight
calls against a metered API, on a private pool of 20 connections. These tests
pin the four properties that make the bound real:

* a PROCESS-wide ceiling shared by every request, held around the outbound call
  only (so cache hits and single-flight waiters pay nothing);
* a per-request SHARE below that ceiling, so one large import cannot starve a
  second request;
* a short wait ceiling on slot acquisition, so a starved cluster fails fast and
  retryable rather than burning its whole per-cluster budget queuing;
* single-flight on the finalist-enrichment path, which had none.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.http_client import PLACES_MAX_CONNECTIONS
from app.services.place_matcher import PlaceMatcher, SlotUnavailableError, places_cache
from app.services.place_matcher import _matcher_search as search_mod
from app.services.place_matcher import persistent_cache as persistent_cache_mod
from app.services.place_matcher.constants import (
    MAX_CONCURRENT_PLACES_REQUESTS,
    MAX_CONCURRENT_PLACES_REQUESTS_PROCESS,
    RATE_LIMIT_BREAKER_THRESHOLD,
)
from app.services.place_matcher.instrumentation import (
    RETRY_SLOT_UNAVAILABLE,
    current_metrics,
    request_metrics,
)


def _settings(**overrides: Any) -> MagicMock:
    settings = MagicMock()
    settings.google_places_api_key = "test-key"
    settings.places_api_timeout_seconds = 5.0
    settings.places_cluster_timeout_seconds = 15.0
    settings.places_min_quality_results_before_stop = 5
    settings.places_diagnostics = False
    settings.places_extra_search_tier_m = None
    settings.places_text_rescue_on_empty = False
    # Real ints only: `resolve_places_concurrency` deliberately ignores mock
    # attributes, so a test that wants a bound has to state it.
    settings.places_max_concurrent_requests = None
    settings.places_max_concurrent_requests_process = None
    for key, value in overrides.items():
        setattr(settings, key, value)
    return settings


def _bind_settings(monkeypatch, settings: MagicMock) -> None:
    """Point both the matcher and the module-level slot at these settings."""
    monkeypatch.setattr(
        "app.services.place_matcher.matcher.get_settings", lambda: settings
    )
    monkeypatch.setattr(search_mod, "get_settings", lambda: settings)


class _ConcurrencyProbe:
    """Records live and peak concurrency of the calls routed through it."""

    def __init__(self, hold_seconds: float = 0.01) -> None:
        self.hold = hold_seconds
        self.live = 0
        self.peak = 0
        self.calls = 0

    async def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        self.live += 1
        self.peak = max(self.peak, self.live)
        try:
            await asyncio.sleep(self.hold)
        finally:
            self.live -= 1
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {"places": []}
        return response


@pytest.fixture(autouse=True)
async def _clean_cache():
    await places_cache.clear()
    yield
    await places_cache.clear()


class TestProcessWideBound:
    """One ceiling across every concurrent request."""

    @pytest.mark.asyncio
    async def test_concurrent_requests_share_the_process_bound(
        self, monkeypatch
    ) -> None:
        """Outbound fan-out must not scale linearly with request count."""
        _bind_settings(
            monkeypatch,
            _settings(
                places_max_concurrent_requests=4,
                places_max_concurrent_requests_process=3,
            ),
        )
        probe = _ConcurrencyProbe()

        async def one_request(offset: float) -> None:
            matcher = PlaceMatcher(http_client=AsyncMock())
            matcher._client.post = probe
            await asyncio.gather(
                *[
                    matcher._execute_search(offset + i * 0.001, 10.0, 30.0)
                    for i in range(6)
                ]
            )

        await asyncio.gather(one_request(1.0), one_request(2.0), one_request(3.0))

        assert probe.calls == 18, "a search was deduped and the probe is not measuring"
        assert probe.peak <= 3, (
            f"peak outbound concurrency {probe.peak} exceeded the process bound; "
            "the bound is not shared across requests"
        )

    @pytest.mark.asyncio
    async def test_one_request_cannot_hold_every_global_slot(self, monkeypatch) -> None:
        """A large request's share is capped so a second one makes progress."""
        _bind_settings(
            monkeypatch,
            _settings(
                places_max_concurrent_requests=2,
                places_max_concurrent_requests_process=4,
            ),
        )

        live_by_request: dict[str, int] = {"big": 0, "small": 0}
        peak_by_request: dict[str, int] = {"big": 0, "small": 0}
        small_started_while_big_ran = False

        def probe_for(name: str):
            async def probe(*args: Any, **kwargs: Any) -> Any:
                nonlocal small_started_while_big_ran
                live_by_request[name] += 1
                peak_by_request[name] = max(
                    peak_by_request[name], live_by_request[name]
                )
                if name == "small" and live_by_request["big"] > 0:
                    small_started_while_big_ran = True
                try:
                    await asyncio.sleep(0.01)
                finally:
                    live_by_request[name] -= 1
                response = MagicMock()
                response.status_code = 200
                response.json.return_value = {"rating": 4.5, "userRatingCount": 100}
                return response

            return probe

        async def enrich(name: str, ids: list[str]) -> dict:
            matcher = PlaceMatcher(http_client=AsyncMock())
            matcher._client.get = probe_for(name)
            return await matcher._enrich_place_ratings(ids)

        big_ids = [f"big-{i}" for i in range(20)]
        small_ids = [f"small-{i}" for i in range(2)]
        big, small = await asyncio.gather(
            enrich("big", big_ids), enrich("small", small_ids)
        )

        assert len(big) == 20 and len(small) == 2
        assert peak_by_request["big"] <= 2, "one request exceeded its share"
        assert small_started_while_big_ran, (
            "the small request never ran while the big one held slots -- one "
            "caller held the whole global bound"
        )


class TestSlotWaitCeiling:
    """Queuing must not silently consume a cluster's own budget."""

    @pytest.mark.asyncio
    async def test_starved_caller_fails_fast_and_retryable(self, monkeypatch) -> None:
        _bind_settings(monkeypatch, _settings(places_max_concurrent_requests_process=1))
        monkeypatch.setattr(search_mod, "PLACES_SLOT_WAIT_CEILING_SECONDS", 0.02)

        # Hold the single global slot for far longer than the wait ceiling.
        holder_released = asyncio.Event()

        async def hold() -> None:
            async with search_mod.places_outbound_slot():
                await holder_released.wait()

        holder = asyncio.create_task(hold())
        await asyncio.sleep(0)

        matcher = PlaceMatcher(http_client=AsyncMock())
        matcher._client.post = _ConcurrencyProbe()

        started = asyncio.get_running_loop().time()
        with request_metrics() as metrics:
            with pytest.raises(SlotUnavailableError):
                await matcher._execute_search(51.5, -0.12, 30.0)
        elapsed = asyncio.get_running_loop().time() - started

        holder_released.set()
        await holder

        # Fast: nowhere near the 15s per-cluster budget.
        assert elapsed < 1.0
        # And countable, so the bound's pressure is readable off the metrics line.
        assert metrics.retries[RETRY_SLOT_UNAVAILABLE] == 1

    @pytest.mark.asyncio
    async def test_slot_failure_is_not_retried_and_never_trips_the_breaker(
        self, monkeypatch
    ) -> None:
        """Local saturation must not masquerade as an upstream rate limit."""
        from app.services.place_matcher import rate_limit

        _bind_settings(monkeypatch, _settings(places_max_concurrent_requests_process=1))
        monkeypatch.setattr(search_mod, "PLACES_SLOT_WAIT_CEILING_SECONDS", 0.02)

        released = asyncio.Event()

        async def hold() -> None:
            async with search_mod.places_outbound_slot():
                await released.wait()

        holder = asyncio.create_task(hold())
        await asyncio.sleep(0)

        probe = _ConcurrencyProbe()
        matcher = PlaceMatcher(http_client=AsyncMock())
        matcher._client.post = probe

        with pytest.raises(SlotUnavailableError):
            await matcher._execute_search(41.9, 12.5, 30.0)

        released.set()
        await holder

        assert probe.calls == 0, "the outbound call was made anyway"
        assert not rate_limit.rate_limit_breaker.is_open(), (
            "our own bound fed the upstream circuit breaker"
        )

    @pytest.mark.asyncio
    async def test_pure_cache_hit_consumes_no_global_slot(self, monkeypatch) -> None:
        _bind_settings(monkeypatch, _settings(places_max_concurrent_requests_process=1))
        monkeypatch.setattr(search_mod, "PLACES_SLOT_WAIT_CEILING_SECONDS", 0.02)

        probe = _ConcurrencyProbe()
        matcher = PlaceMatcher(http_client=AsyncMock())
        matcher._client.post = probe

        # Prime the cache with one real (slot-consuming) call.
        await matcher._execute_search(48.85, 2.29, 30.0)
        assert probe.calls == 1

        # Now hold the ONLY global slot and repeat the same lookup.
        released = asyncio.Event()

        async def hold() -> None:
            async with search_mod.places_outbound_slot():
                await released.wait()

        holder = asyncio.create_task(hold())
        await asyncio.sleep(0)

        cached = await matcher._execute_search(48.85, 2.29, 30.0)

        released.set()
        await holder

        assert cached == []
        assert probe.calls == 1, "the cache hit issued an outbound call"


class TestEnrichmentSingleFlight:
    """The finalist-enrichment path had no single-flight of its own."""

    @pytest.mark.asyncio
    async def test_same_venue_in_two_requests_is_bought_once(self, monkeypatch) -> None:
        _bind_settings(monkeypatch, _settings())

        calls = 0

        async def probe(*args: Any, **kwargs: Any) -> Any:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {"rating": 4.2, "userRatingCount": 812}
            return response

        async def enrich() -> dict:
            matcher = PlaceMatcher(http_client=AsyncMock())
            matcher._client.get = probe
            return await matcher._enrich_place_ratings(["shared-venue"])

        first, second = await asyncio.gather(enrich(), enrich())

        assert calls == 1, "the same venue was bought twice by concurrent requests"
        assert first["shared-venue"]["userRatingCount"] == 812
        assert second == first

    @pytest.mark.asyncio
    async def test_waiter_is_counted_as_a_single_flight_wait(self, monkeypatch) -> None:
        """A waiter must not be attributed to the paid-call bucket (U15)."""
        _bind_settings(monkeypatch, _settings())

        started = asyncio.Event()

        async def probe(*args: Any, **kwargs: Any) -> Any:
            started.set()
            await asyncio.sleep(0.01)
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {"rating": 4.0, "userRatingCount": 10}
            return response

        async def owner() -> None:
            matcher = PlaceMatcher(http_client=AsyncMock())
            matcher._client.get = probe
            await matcher._enrich_place_ratings(["venue"])

        owner_task = asyncio.create_task(owner())
        await started.wait()

        with request_metrics() as metrics:
            matcher = PlaceMatcher(http_client=AsyncMock())
            matcher._client.get = probe
            await matcher._enrich_place_ratings(["venue"])
            waits = metrics.cache["single_flight_waits"]
            google_calls = metrics.cache["google_calls"]

        await owner_task

        assert waits == 1
        assert google_calls == 0
        assert current_metrics() is None


class TestEnrichmentCacheWrite:
    """The read-merge-write assumed serialized writers."""

    @pytest.mark.asyncio
    async def test_concurrent_writes_do_not_drop_each_others_fields(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(
            persistent_cache_mod, "_persistent_cache_enabled", lambda: True
        )

        expires_at = (datetime.now(UTC) + timedelta(days=1)).isoformat()

        class FakeDB:
            def __init__(self) -> None:
                self.row: dict[str, Any] | None = None

            async def get(self, table: str, params: dict) -> list[dict]:
                # Two yield points: without a lock this is where the second
                # writer reads the pre-merge blob and later overwrites it.
                await asyncio.sleep(0)
                await asyncio.sleep(0)
                if self.row is None:
                    return []
                return [{"details": self.row, "expires_at": expires_at}]

            async def upsert(
                self, table: str, rows: list[dict], on_conflict: str | None = None
            ) -> None:
                await asyncio.sleep(0)
                self.row = rows[0]["details"]

        db = FakeDB()
        monkeypatch.setattr(persistent_cache_mod, "get_supabase_client", lambda: db)

        await asyncio.gather(
            persistent_cache_mod.set_place_details_cache(
                "venue", {"rating": 4.5, "userRatingCount": 900}
            ),
            persistent_cache_mod.set_place_details_cache(
                "venue", {"displayName": "Cafe", "types": ["cafe"]}
            ),
        )

        assert db.row is not None
        assert db.row.get("userRatingCount") == 900, "the rating write was dropped"
        assert db.row.get("displayName") == "Cafe", "the details write was dropped"

    @pytest.mark.asyncio
    async def test_write_lock_map_does_not_grow(self, monkeypatch) -> None:
        monkeypatch.setattr(
            persistent_cache_mod, "_persistent_cache_enabled", lambda: True
        )

        class FakeDB:
            async def get(self, table: str, params: dict) -> list[dict]:
                return []

            async def upsert(
                self, table: str, rows: list[dict], on_conflict: str | None = None
            ) -> None:
                return None

        monkeypatch.setattr(
            persistent_cache_mod, "get_supabase_client", lambda: FakeDB()
        )

        for i in range(5):
            await persistent_cache_mod.set_place_details_cache(f"p-{i}", {"rating": 1})

        assert persistent_cache_mod._details_write_locks_for_loop() == {}


class TestConcurrencyConfiguration:
    """The bound is settings-driven, with the old constant as the floor."""

    def test_reads_from_configuration(self) -> None:
        per_request, process = search_mod.resolve_places_concurrency(
            SimpleNamespace(
                places_max_concurrent_requests=7,
                places_max_concurrent_requests_process=21,
            )
        )
        assert (per_request, process) == (7, 21)

    def test_falls_back_to_the_previous_constants(self) -> None:
        per_request, process = search_mod.resolve_places_concurrency(SimpleNamespace())
        assert per_request == MAX_CONCURRENT_PLACES_REQUESTS
        assert process == MAX_CONCURRENT_PLACES_REQUESTS_PROCESS

    def test_unusable_values_fall_back_rather_than_unbounding(self) -> None:
        per_request, process = search_mod.resolve_places_concurrency(
            SimpleNamespace(
                places_max_concurrent_requests=0,
                places_max_concurrent_requests_process="lots",
            )
        )
        assert per_request == MAX_CONCURRENT_PLACES_REQUESTS
        assert process == MAX_CONCURRENT_PLACES_REQUESTS_PROCESS

    def test_per_request_share_is_clamped_to_the_process_ceiling(self) -> None:
        per_request, process = search_mod.resolve_places_concurrency(
            SimpleNamespace(
                places_max_concurrent_requests=50,
                places_max_concurrent_requests_process=6,
            )
        )
        assert (per_request, process) == (6, 6)

    def test_real_settings_default_to_the_shipped_bounds(self) -> None:
        from app.core.config import Settings

        settings = Settings(
            supabase_url="https://x.supabase.co",
            supabase_anon_key="k",
            supabase_service_role_key="k",
            supabase_jwt_secret="s",
        )
        assert settings.places_max_concurrent_requests == (
            MAX_CONCURRENT_PLACES_REQUESTS
        )
        assert settings.places_max_concurrent_requests_process == (
            MAX_CONCURRENT_PLACES_REQUESTS_PROCESS
        )

    def test_process_bound_sits_between_the_breaker_and_the_pool(self) -> None:
        # Below the private pool: pool exhaustion (a header-less 503) must stay
        # the rare case, not the way the bound is enforced.
        assert MAX_CONCURRENT_PLACES_REQUESTS_PROCESS < PLACES_MAX_CONNECTIONS
        # Above the breaker threshold: a fully throttled wave has to be able to
        # trip the breaker, which it cannot if fewer calls than the threshold
        # can ever be in flight.
        assert MAX_CONCURRENT_PLACES_REQUESTS_PROCESS > RATE_LIMIT_BREAKER_THRESHOLD
        # And above one request's share, so no single caller holds every slot.
        assert MAX_CONCURRENT_PLACES_REQUESTS_PROCESS > MAX_CONCURRENT_PLACES_REQUESTS
