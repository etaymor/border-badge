"""Venue probe Google call (U6): request shape, shared cache, degradation."""

from unittest.mock import AsyncMock

import httpx
import pytest

from app.services.place_matcher import DensityLevel, PlaceMatcher, places_cache
from app.services.place_matcher import instrumentation as instr
from app.services.place_matcher._venue_probe import venue_probe_cache_key
from app.services.place_matcher.cache import PlacesCache
from app.services.place_matcher.constants import (
    VENUE_PROBE_FIELD_MASK,
    VENUE_PROBE_INCLUDED_TYPES,
    WIDE_FIELD_MASK,
)
from tests.services.venue_probe_support import (
    _attraction_world,
    _cluster,
    _louvre,
    _ok_response,
    _status_response,
    _tiered,
    make_settings,
)


@pytest.fixture
def settings(monkeypatch):
    return make_settings(monkeypatch)


@pytest.fixture
async def clean_cache():
    await places_cache.clear()
    yield
    await places_cache.clear()


@pytest.fixture
def metrics():
    with instr.request_metrics() as m:
        yield m


# ---------------------------------------------------------------------------
# The Google call: shape, cache, degradation, instrumentation
# ---------------------------------------------------------------------------


class TestExecuteVenueProbe:
    @pytest.mark.asyncio
    async def test_request_shape(self, settings, clean_cache) -> None:
        client = AsyncMock()
        client.post = AsyncMock(return_value=_ok_response([_louvre()]))
        matcher = PlaceMatcher(http_client=client)

        places = await matcher._execute_venue_probe(48.861, 2.336)

        assert [p["id"] for p in places] == ["louvre"]
        body = client.post.call_args.kwargs["json"]
        headers = client.post.call_args.kwargs["headers"]
        assert body["rankPreference"] == "POPULARITY"
        assert body["locationRestriction"]["circle"]["radius"] == 400
        assert body["locationRestriction"]["circle"]["center"] == {
            "latitude": 48.861,
            "longitude": 2.336,
        }
        assert body["includedTypes"] == VENUE_PROBE_INCLUDED_TYPES
        mask = headers["X-Goog-FieldMask"].split(",")
        for field in ("places.rating", "places.userRatingCount", "places.viewport"):
            assert field in mask
        # The wide pass keeps its Pro-tier mask (KTD3: existing masks unchanged).
        assert "places.rating" not in WIDE_FIELD_MASK
        assert headers["X-Goog-FieldMask"] == VENUE_PROBE_FIELD_MASK

    def test_included_types_are_the_verified_live_set(self) -> None:
        # U4 live capture proved exactly this set returns the Louvre first.
        assert set(VENUE_PROBE_INCLUDED_TYPES) == {
            "museum",
            "tourist_attraction",
            "historical_landmark",
            "cultural_landmark",
            "monument",
            "art_gallery",
            "park",
        }

    @pytest.mark.asyncio
    async def test_radius_follows_setting(self, settings, clean_cache) -> None:
        settings.places_venue_probe_radius_m = 250
        client = AsyncMock()
        client.post = AsyncMock(return_value=_ok_response([]))
        matcher = PlaceMatcher(http_client=client)

        await matcher._execute_venue_probe(48.861, 2.336)

        body = client.post.call_args.kwargs["json"]
        assert body["locationRestriction"]["circle"]["radius"] == 250

    @pytest.mark.asyncio
    async def test_two_clusters_in_one_cell_make_one_google_call(
        self, settings, monkeypatch
    ) -> None:
        """~60m apart, same 3-decimal cell: the second is an L1 hit."""
        monkeypatch.setattr(
            "app.services.place_matcher._matcher_search.places_cache", PlacesCache()
        )
        client = AsyncMock()
        client.post = AsyncMock(return_value=_ok_response([_louvre()]))
        matcher = PlaceMatcher(http_client=client)

        async def mock_search_nearby_tiered(latitude, longitude):
            return _tiered(_attraction_world(), DensityLevel.DENSE)

        async def mock_enrich(place_ids):
            return {}

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)

        with instr.request_metrics() as m:
            _results, failed = await matcher.find_places_for_clusters(
                [
                    _cluster("a", 48.8612, 2.3358),
                    _cluster("b", 48.8607, 2.3362),
                ]
            )

        assert failed == 0
        assert client.post.await_count == 1
        assert m.outbound_by_method[instr.METHOD_VENUE_PROBE] == 1
        assert matcher.last_venue_probe_results["a"] == [_louvre()]
        assert matcher.last_venue_probe_results["b"] == [_louvre()]

    def test_cache_key_is_distinct_from_legacy_and_nearby_keys(self) -> None:
        key = venue_probe_cache_key(48.861, 2.336, 400)
        nearby = places_cache.get_cache_key(48.861, 2.336, 400)
        assert not key.startswith("pop_")
        assert not key.startswith("nearby_")
        assert key != nearby
        assert "pop_" + nearby != key
        # Rounded to the ~110m cell, and carries a mask/version token.
        assert venue_probe_cache_key(48.86124, 2.33581, 400) == key
        assert venue_probe_cache_key(48.8612, 2.3358, 250) != key

    @pytest.mark.asyncio
    async def test_cache_key_used_by_the_call(self, settings, monkeypatch) -> None:
        captured: list[str] = []

        async def fake_get_or_fetch(
            cache_key, fetch, l2_get=None, l2_set=None, on_source=None
        ):
            captured.append(cache_key)
            return []

        monkeypatch.setattr(
            "app.services.place_matcher._matcher_search.places_cache.get_or_fetch",
            fake_get_or_fetch,
        )
        matcher = PlaceMatcher(http_client=AsyncMock())

        await matcher._execute_venue_probe(48.861, 2.336)
        await matcher._execute_popularity_probe(48.861, 2.336, radius=400.0)
        await matcher._execute_search(48.861, 2.336, radius=400.0)

        assert captured[0] == venue_probe_cache_key(48.861, 2.336, 400)
        assert len(set(captured)) == 3

    @pytest.mark.asyncio
    async def test_rate_limit_is_retried_and_recorded(
        self, settings, clean_cache, metrics
    ) -> None:
        responses = [_status_response(429), _ok_response([_louvre()])]
        client = AsyncMock()
        client.post = AsyncMock(side_effect=responses)
        matcher = PlaceMatcher(http_client=client)

        places = await matcher._execute_venue_probe(48.861, 2.336)

        assert [p["id"] for p in places] == ["louvre"]
        assert metrics.retries[instr.RETRY_RATE_LIMITED] == 1
        assert metrics.outbound_by_method[instr.METHOD_VENUE_PROBE] == 2

    @pytest.mark.asyncio
    async def test_timeout_returns_empty_and_records(
        self, settings, clean_cache, metrics
    ) -> None:
        client = AsyncMock()
        client.post = AsyncMock(side_effect=httpx.ReadTimeout("slow"))
        matcher = PlaceMatcher(http_client=client)

        places = await matcher._execute_venue_probe(48.861, 2.336)

        assert places == []
        assert metrics.retries[instr.RETRY_SEARCH_TIMEOUT] == 1
        # A timeout on an optional call is not re-paid.
        assert client.post.await_count == 1

    @pytest.mark.asyncio
    async def test_5xx_returns_empty_and_is_never_cached(
        self, settings, clean_cache
    ) -> None:
        client = AsyncMock()
        client.post = AsyncMock(
            side_effect=[_status_response(503), _ok_response([_louvre()])]
        )
        matcher = PlaceMatcher(http_client=client)

        assert await matcher._execute_venue_probe(48.861, 2.336) == []
        # The blip was not written through: the next call re-issues.
        second = await matcher._execute_venue_probe(48.861, 2.336)
        assert [p["id"] for p in second] == ["louvre"]
        assert client.post.await_count == 2

    @pytest.mark.asyncio
    async def test_closed_venues_are_dropped(self, settings, clean_cache) -> None:
        closed = {**_louvre(), "id": "closed", "businessStatus": "CLOSED_PERMANENTLY"}
        client = AsyncMock()
        client.post = AsyncMock(return_value=_ok_response([closed, _louvre()]))
        matcher = PlaceMatcher(http_client=client)

        places = await matcher._execute_venue_probe(48.861, 2.336)

        assert [p["id"] for p in places] == ["louvre"]
