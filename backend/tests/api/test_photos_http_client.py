"""Private Places HTTP client, pool timeouts, and an accurate Retry-After.

The photo-import fan-out gets its *own* connection pool rather than sharing the
app-wide client (which backs every Supabase REST call): sharing would put the
import in contention with the app's database path, would inherit the shared
30s timeout and silently widen the per-cluster budget, and would make
pool-exhaustion errors match the search retry predicate so pool pressure
generated more pool pressure.

Also covers the rate-limit response: our limiter's 429 must carry a
``Retry-After`` derived from the window we configure, instead of leaving the
client to fall back to a hard-coded default.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.photos import (
    SUGGEST_PLACES_BURST_LIMIT,
    SUGGEST_PLACES_LIMITS,
    SUGGEST_PLACES_RATE_LIMIT,
)
from app.core import http_client as http_client_module
from app.core.config import get_settings
from app.core.http_client import (
    PLACES_MAX_CONNECTIONS,
    PLACES_MAX_KEEPALIVE_CONNECTIONS,
    PLACES_POOL_TIMEOUT_SECONDS,
    get_http_client,
    get_places_client,
)
from app.core.security import AuthUser, get_current_user
from app.main import (
    app,
    limiter,
    rate_limit_window_seconds,
    retry_after_seconds_for_path,
)
from app.services.place_matcher import MIN_REVIEW_COUNT, PlaceMatcher
from tests.conftest import mock_auth_dependency

CLUSTER: dict[str, Any] = {
    "id": "cluster-1",
    "centroid": {"latitude": 35.6762, "longitude": 139.6503},
    "photos": [{"asset_id": "photo-1", "latitude": 35.6762, "longitude": 139.6503}],
}


@pytest.fixture(autouse=True)
def _reset_module_clients():
    """Drop cached client singletons so each test observes construction."""
    http_client_module._places_client = None
    http_client_module._http_client = None
    yield
    http_client_module._places_client = None
    http_client_module._http_client = None


@pytest.fixture(autouse=True)
def _reset_limiter():
    """Keep this file's request volume out of every other test's window."""
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
def _entitled_caller():
    """Give every caller in this file a premium entitlement.

    The endpoint checks the caller's photo-import entitlement before any paid
    call (U16), which is a database read. These tests are about the HTTP client
    and the limiter, so the entitlement is stubbed rather than exercised --
    see `test_photos_entitlement.py` for the enforcement itself.
    """
    db = AsyncMock()
    db.get = AsyncMock(
        return_value=[
            {
                "subscription_status": "premium",
                "usage_photo_import_count": 0,
                "usage_photo_import_trip_id": None,
            }
        ]
    )
    with patch("app.api.photos.get_supabase_client", return_value=db):
        yield


def _post_suggest(client: TestClient, headers: dict[str, str]):
    return client.post(
        "/photos/suggest-places", json={"clusters": [CLUSTER]}, headers=headers
    )


class _RecordingMatcher:
    """Stand-in for PlaceMatcher that records the client it was handed."""

    seen: list[Any] = []

    def __init__(self, http_client: Any) -> None:
        type(self).seen.append(http_client)

    async def find_places_for_clusters(
        self, clusters: list[dict], vision_results_task: Any = None
    ) -> tuple[list[dict], int]:
        return [], 0


class _RaisingMatcher:
    """Stand-in for PlaceMatcher that raises a configured exception."""

    exc: BaseException = RuntimeError("unset")

    def __init__(self, http_client: Any) -> None:
        pass

    async def find_places_for_clusters(
        self, clusters: list[dict], vision_results_task: Any = None
    ) -> tuple[list[dict], int]:
        raise type(self).exc


class TestPrivatePlacesClient:
    """The endpoint reuses one private, long-lived pool."""

    def test_endpoint_uses_one_long_lived_client_not_one_per_request(
        self,
        client: TestClient,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
    ) -> None:
        _RecordingMatcher.seen = []
        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with (
                patch("app.api.photos.PlaceMatcher", _RecordingMatcher),
                patch(
                    "app.api.photos.classify_cluster_photos",
                    new=AsyncMock(return_value={}),
                ),
            ):
                assert _post_suggest(client, auth_headers).status_code == 200
                assert _post_suggest(client, auth_headers).status_code == 200
        finally:
            app.dependency_overrides.clear()

        assert len(_RecordingMatcher.seen) == 2
        first, second = _RecordingMatcher.seen
        assert first is second, "a new client was built per request"
        assert first is get_places_client(), "endpoint did not use the private client"
        assert not first.is_closed, "the client was closed at the end of the request"

    def test_private_client_is_not_the_shared_app_client(self) -> None:
        assert get_places_client() is not get_http_client()

    def test_private_pool_is_sized_for_the_places_fan_out(self) -> None:
        with patch.object(http_client_module.httpx, "AsyncClient") as ctor:
            get_places_client()

        limits = ctor.call_args.kwargs["limits"]
        assert limits.max_connections == PLACES_MAX_CONNECTIONS
        assert limits.max_keepalive_connections == PLACES_MAX_KEEPALIVE_CONNECTIONS
        # Post-U12 fan-out is roughly 15 concurrent outbound Places calls, and
        # every one of them must be able to stay keep-alive between chunks.
        assert PLACES_MAX_CONNECTIONS >= 15
        assert PLACES_MAX_KEEPALIVE_CONNECTIONS >= 15

    def test_shared_app_client_budget_is_unaffected(self) -> None:
        with patch.object(http_client_module.httpx, "AsyncClient") as ctor:
            get_http_client()

        limits = ctor.call_args.kwargs["limits"]
        assert limits.max_connections == 100
        assert limits.max_keepalive_connections == 20
        assert ctor.call_args.kwargs["timeout"] == 30.0

    def test_places_calls_honor_the_places_timeout_not_a_shared_default(self) -> None:
        with patch.object(http_client_module.httpx, "AsyncClient") as ctor:
            get_places_client()

        timeout = ctor.call_args.kwargs["timeout"]
        expected = get_settings().places_api_timeout_seconds
        assert timeout.connect == expected
        assert timeout.read == expected
        assert timeout.write == expected
        assert timeout.read != 30.0, "inherited the shared client's default"

    def test_pool_wait_has_its_own_timeout(self) -> None:
        with patch.object(http_client_module.httpx, "AsyncClient") as ctor:
            get_places_client()

        timeout = ctor.call_args.kwargs["timeout"]
        assert timeout.pool == PLACES_POOL_TIMEOUT_SECONDS
        assert timeout.pool != timeout.read


class TestPoolExhaustionIsNotRetried:
    """Pool pressure must not generate more pool pressure."""

    @pytest.fixture
    def matcher(self, monkeypatch) -> PlaceMatcher:
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        settings.places_extra_search_tier_m = None
        settings.places_min_review_count = MIN_REVIEW_COUNT
        settings.places_text_rescue_on_empty = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        return PlaceMatcher(http_client=AsyncMock())

    def test_pool_timeout_subclasses_the_retried_timeout_type(self) -> None:
        # This is why the predicate has to exclude it explicitly.
        assert issubclass(httpx.PoolTimeout, httpx.TimeoutException)

    @pytest.mark.asyncio
    async def test_pool_exhaustion_is_not_retried(self, matcher: PlaceMatcher) -> None:
        from app.services.place_matcher import places_cache

        await places_cache.clear()
        calls = 0

        async def post(*args: Any, **kwargs: Any) -> Any:
            nonlocal calls
            calls += 1
            raise httpx.PoolTimeout("pool exhausted")

        matcher._client.post = post
        with pytest.raises(httpx.PoolTimeout):
            await matcher._execute_search(11.11, 22.22, 30.0)
        await places_cache.clear()

        assert calls == 1, "pool exhaustion was retried, adding more pool pressure"

    @pytest.mark.asyncio
    async def test_read_timeout_is_still_retried(self, matcher: PlaceMatcher) -> None:
        from app.services.place_matcher import places_cache

        await places_cache.clear()
        calls = 0

        async def post(*args: Any, **kwargs: Any) -> Any:
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("slow upstream")

        matcher._client.post = post
        with pytest.raises(httpx.ReadTimeout):
            await matcher._execute_search(33.33, 44.44, 30.0)
        await places_cache.clear()

        assert calls == 3

    def test_endpoint_surfaces_pool_exhaustion_as_its_own_condition(
        self,
        client: TestClient,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
    ) -> None:
        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with (
                patch("app.api.photos.PlaceMatcher", _RaisingMatcher),
                patch(
                    "app.api.photos.classify_cluster_photos",
                    new=AsyncMock(return_value={}),
                ),
            ):
                _RaisingMatcher.exc = httpx.PoolTimeout("pool exhausted")
                pool_response = _post_suggest(client, auth_headers)

                _RaisingMatcher.exc = httpx.ReadTimeout("slow upstream")
                read_response = _post_suggest(client, auth_headers)
        finally:
            app.dependency_overrides.clear()

        assert read_response.status_code == 504
        assert pool_response.status_code != read_response.status_code
        assert pool_response.json()["detail"] != read_response.json()["detail"]
        # The client distinguishes a quota 503 from a transient one by the
        # presence of Retry-After, so pool exhaustion must not carry it --
        # otherwise a seconds-long local blip reads as "try again tomorrow".
        assert "Retry-After" not in pool_response.headers


class TestRateLimitRetryAfter:
    """Our own 429 tells the client how long to wait."""

    def test_window_is_derived_from_our_configured_spec(self) -> None:
        assert rate_limit_window_seconds("120/second") == 1
        assert rate_limit_window_seconds("40/minute") == 60
        assert rate_limit_window_seconds("3/hour") == 3600
        assert rate_limit_window_seconds("2/day") == 86400

    def test_suggest_places_window_matches_its_own_decorator(self) -> None:
        assert retry_after_seconds_for_path(
            "/photos/suggest-places"
        ) == rate_limit_window_seconds(SUGGEST_PLACES_RATE_LIMIT)

    def test_rate_limited_response_carries_retry_after(
        self,
        client: TestClient,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
    ) -> None:
        """A rejection reports the window of the limit that actually fired.

        A back-to-back loop trips the U7 burst cap first, so the honest wait is
        that limit's (1s) window -- reporting the sustained per-minute window
        here would idle the client for a minute over a momentary burst.
        """
        expected = rate_limit_window_seconds(SUGGEST_PLACES_BURST_LIMIT)
        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        rate_limited = None
        attempts = 0
        try:
            with (
                patch("app.api.photos.PlaceMatcher", _RecordingMatcher),
                patch(
                    "app.api.photos.classify_cluster_photos",
                    new=AsyncMock(return_value={}),
                ),
            ):
                for _ in range(80):
                    attempts += 1
                    response = _post_suggest(client, auth_headers)
                    if response.status_code == 429:
                        rate_limited = response
                        break
        finally:
            app.dependency_overrides.clear()

        assert rate_limited is not None, "limiter never rejected a request"
        assert rate_limited.headers.get("Retry-After") == str(expected)
        body = rate_limited.json()
        assert body["retry_after"] == expected
        # The window is an upper bound on the wait, not the exact reset.
        assert body["retry_after_is_upper_bound"] is True
        # And it really was the burst cap: the sustained per-minute allowance
        # was nowhere near exhausted when the rejection came.
        assert attempts < int(SUGGEST_PLACES_RATE_LIMIT.split("/")[0])


class TestBurstCap:
    """A fixed window admits ~2x the nominal rate across its boundary (U7)."""

    def test_route_declares_both_a_sustained_and_a_burst_window(self) -> None:
        from limits import parse_many

        # The spec pairs the two windows...
        assert sorted(
            item.get_expiry() for item in parse_many(SUGGEST_PLACES_LIMITS)
        ) == [1, 60]
        # ...and the route is actually registered with both of them.
        registered = limiter._route_limits["app.api.photos.suggest_places"]
        assert sorted(limit.limit.get_expiry() for limit in registered) == [
            1,
            60,
        ], "the route lost its per-second burst window"

    def test_burst_cap_is_above_client_concurrency_and_below_sustained_rate(
        self,
    ) -> None:
        burst = int(SUGGEST_PLACES_BURST_LIMIT.split("/")[0])
        sustained = int(SUGGEST_PLACES_RATE_LIMIT.split("/")[0])
        # Above the planned client concurrency of 3, so honest traffic is never
        # rejected...
        assert burst > 3
        # ...and far below the sustained allowance, so it fires only on a burst
        # (a cap at or above 40/second could never fire before the minute one).
        assert burst < sustained

    def test_a_burst_is_rejected_while_the_minute_allowance_remains(
        self,
        client: TestClient,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
    ) -> None:
        burst = int(SUGGEST_PLACES_BURST_LIMIT.split("/")[0])
        sustained = int(SUGGEST_PLACES_RATE_LIMIT.split("/")[0])
        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        statuses: list[int] = []
        try:
            with (
                patch("app.api.photos.PlaceMatcher", _RecordingMatcher),
                patch(
                    "app.api.photos.classify_cluster_photos",
                    new=AsyncMock(return_value={}),
                ),
            ):
                for _ in range(burst + 1):
                    statuses.append(_post_suggest(client, auth_headers).status_code)
        finally:
            app.dependency_overrides.clear()

        # Everything inside the burst allowance is served...
        assert statuses[:burst] == [200] * burst
        # ...and the request past it is rejected, even though the sustained
        # per-minute allowance still has plenty left.
        assert statuses[-1] == 429
        assert len(statuses) < sustained
