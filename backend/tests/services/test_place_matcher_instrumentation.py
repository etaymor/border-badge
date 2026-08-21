"""Phase-duration and dispatch instrumentation for photo place matching (U15).

Covers the four backend phase durations, cache composition, outbound dispatch
shape (peak concurrency + per-method request rate), the vision-null rate, and
the R27 rule that no coordinate, cluster id, geohash, or place id reaches a
default-level log line.
"""

import asyncio
import json
import logging
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.photo_vision import VisionResult
from app.services.place_matcher import MIN_REVIEW_COUNT, DensityLevel, PlaceMatcher
from app.services.place_matcher._matcher_search import TieredSearchResult
from app.services.place_matcher.instrumentation import (
    METHOD_NEARBY,
    PHASE_METRICS_EVENT,
    SOURCES,
    request_metrics,
)

MAX_CONCURRENCY = 5


def _place(place_id: str, lat: float, lng: float, name: str) -> dict[str, Any]:
    return {
        "id": place_id,
        "displayName": {"text": name},
        "formattedAddress": "1 Test St",
        "location": {"latitude": lat, "longitude": lng},
        "primaryType": "restaurant",
        "types": ["restaurant", "food"],
        "businessStatus": "OPERATIONAL",
    }


def _tiered(places: list[dict[str, Any]]) -> TieredSearchResult:
    return TieredSearchResult(
        places=places,
        radius_used=15,
        radii_searched={15},
        raw_count_per_radius={15: len(places)},
        raw_places_per_radius={},
        stopped_early=True,
        density=DensityLevel.DENSE,
    )


def _capture_metrics(caplog) -> list[dict[str, Any]]:
    """Parse the per-request metrics payloads out of captured INFO logs."""
    payloads: list[dict[str, Any]] = []
    for record in caplog.records:
        message = record.getMessage()
        if not message.startswith(PHASE_METRICS_EVENT):
            continue
        payloads.append(json.loads(message[len(PHASE_METRICS_EVENT) :].strip()))
    return payloads


@pytest.fixture
def settings(monkeypatch):
    stub = MagicMock()
    stub.google_places_api_key = "test-key"
    stub.places_api_timeout_seconds = 5.0
    stub.places_cluster_timeout_seconds = 15.0
    stub.places_min_quality_results_before_stop = 5
    stub.places_diagnostics = False
    stub.places_extra_search_tier_m = None
    stub.places_min_review_count = MIN_REVIEW_COUNT
    stub.places_text_rescue_on_empty = False
    stub.places_landmark_text_rescue = False
    stub.places_popularity_probe = False
    stub.places_enrich_backfill_limit = 3
    monkeypatch.setattr("app.services.place_matcher.matcher.get_settings", lambda: stub)
    return stub


@pytest.fixture
def matcher(settings) -> PlaceMatcher:
    return PlaceMatcher(http_client=AsyncMock())


@pytest.fixture
async def clean_cache():
    from app.services.place_matcher import places_cache

    await places_cache.clear()
    yield
    await places_cache.clear()


@pytest.fixture
def no_persistent_cache(monkeypatch):
    """Neutralize the Postgres L2 so tests never touch the database."""

    async def _get(_key: str) -> None:
        return None

    async def _set(_key: str, _value: list[dict]) -> None:
        return None

    monkeypatch.setattr(
        "app.services.place_matcher._matcher_search.get_search_cache", _get
    )
    monkeypatch.setattr(
        "app.services.place_matcher._matcher_search.set_search_cache", _set
    )
    return monkeypatch


def _clusters(count: int) -> list[dict[str, Any]]:
    return [
        {
            "id": f"cluster-{i}",
            "centroid": {"latitude": 35.6762 + i * 0.01, "longitude": 139.6503},
            "photos": [{"asset_id": f"photo-{i}-1"}],
        }
        for i in range(count)
    ]


class TestPhaseDurations:
    """The four phase durations are reported separately (KTD16)."""

    @pytest.mark.asyncio
    async def test_four_phases_reported_separately(
        self, matcher, monkeypatch, caplog
    ) -> None:
        places = [
            _place(f"place-{i}", 35.6762, 139.6503, f"Place {i}") for i in range(5)
        ]

        async def fake_search(latitude: float, longitude: float):
            await asyncio.sleep(0.02)
            return _tiered(places)

        monkeypatch.setattr(matcher, "_search_nearby_tiered", fake_search)

        async def fake_enrich(place_ids: list[str]) -> dict[str, dict[str, Any]]:
            await asyncio.sleep(0.02)
            # One finalist fails the review gate -> forces a backfill batch.
            return {
                pid: {
                    "rating": 4.5,
                    "userRatingCount": 0 if pid == "place-0" else 120,
                }
                for pid in place_ids
            }

        monkeypatch.setattr(matcher, "_enrich_place_ratings", fake_enrich)

        async def slow_vision() -> dict[str, VisionResult]:
            await asyncio.sleep(0.12)
            return {}

        with caplog.at_level(logging.INFO):
            await matcher.find_places_for_clusters(
                _clusters(3),
                vision_results_task=asyncio.ensure_future(slow_vision()),
            )

        payloads = _capture_metrics(caplog)
        assert len(payloads) == 1
        phase_ms = payloads[0]["phase_ms"]

        assert set(phase_ms) == {"search", "vision_wait", "enrichment", "backfill"}
        for phase, duration in phase_ms.items():
            assert duration > 0, f"phase {phase} was not measured"

        # KTD16's stop condition is read straight off this pair.
        assert phase_ms["vision_wait"] > phase_ms["search"]
        assert payloads[0]["total_ms"] >= phase_ms["vision_wait"]
        assert payloads[0]["clusters"] == 3

    @pytest.mark.asyncio
    async def test_vision_wait_is_small_when_vision_finishes_first(
        self, matcher, monkeypatch, caplog
    ) -> None:
        """A fast vision task leaves a near-zero residual wait after search."""
        places = [_place("place-1", 35.6762, 139.6503, "Place 1")]

        async def fake_search(latitude: float, longitude: float):
            await asyncio.sleep(0.05)
            return _tiered(places)

        monkeypatch.setattr(matcher, "_search_nearby_tiered", fake_search)
        monkeypatch.setattr(
            matcher, "_enrich_place_ratings", AsyncMock(return_value={})
        )

        async def fast_vision() -> dict[str, VisionResult]:
            return {}

        with caplog.at_level(logging.INFO):
            await matcher.find_places_for_clusters(
                _clusters(1),
                vision_results_task=asyncio.ensure_future(fast_vision()),
            )

        phase_ms = _capture_metrics(caplog)[0]["phase_ms"]
        assert phase_ms["search"] > phase_ms["vision_wait"]


class TestCacheComposition:
    """L1 / L2 / single-flight / outbound counts sum to lookups attempted."""

    @staticmethod
    def _response(places: list[dict[str, Any]]):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {"places": places}
        return response

    @pytest.mark.asyncio
    async def test_counts_sum_to_lookups(
        self, matcher, monkeypatch, clean_cache, caplog
    ) -> None:
        matcher._client.post = AsyncMock(
            return_value=self._response([_place("place-1", 35.0, 139.0, "One")])
        )

        l2_payload: dict[str, list[dict]] = {}

        async def fake_l2_get(key: str):
            return l2_payload.get(key)

        async def fake_l2_set(key: str, value: list[dict]) -> None:
            return None

        monkeypatch.setattr(
            "app.services.place_matcher._matcher_search.get_search_cache", fake_l2_get
        )
        monkeypatch.setattr(
            "app.services.place_matcher._matcher_search.set_search_cache", fake_l2_set
        )

        from app.services.place_matcher._matcher_search import (
            _SEARCHABLE_TYPE_SET_HASH,
        )
        from app.services.place_matcher.cache import places_cache

        # Pre-seed L2 for the second location only.
        l2_key = places_cache.get_cache_key(
            36.0, 140.0, 15, type_set_hash=_SEARCHABLE_TYPE_SET_HASH
        )
        l2_payload[l2_key] = []

        with caplog.at_level(logging.INFO), request_metrics():
            await matcher._execute_search(35.0, 139.0, 15)  # outbound
            await matcher._execute_search(35.0, 139.0, 15)  # L1 hit
            await matcher._execute_search(36.0, 140.0, 15)  # L2 hit

        payload = _capture_metrics(caplog)[0]
        cache = payload["cache"]
        assert cache["lookups"] == 3
        assert sum(cache[source] for source in SOURCES) == cache["lookups"]
        assert cache["google_calls"] == 1
        assert cache["l1_hits"] == 1
        assert cache["l2_hits"] == 1

    @pytest.mark.asyncio
    async def test_single_flight_waiters_are_counted(
        self, matcher, monkeypatch, clean_cache, no_persistent_cache, caplog
    ) -> None:
        async def slow_post(*args, **kwargs):
            await asyncio.sleep(0.05)
            return self._response([])

        matcher._client.post = AsyncMock(side_effect=slow_post)

        with caplog.at_level(logging.INFO), request_metrics():
            await asyncio.gather(
                matcher._execute_search(35.0, 139.0, 15),
                matcher._execute_search(35.0, 139.0, 15),
            )

        cache = _capture_metrics(caplog)[0]["cache"]
        assert cache["lookups"] == 2
        assert sum(cache[source] for source in SOURCES) == 2
        assert cache["google_calls"] == 1
        assert cache["single_flight_waits"] == 1


class TestOutboundDispatch:
    """Peak concurrent outbound calls and per-method request rates."""

    @pytest.mark.asyncio
    async def test_peak_concurrency_and_request_rate(
        self, matcher, monkeypatch, clean_cache, no_persistent_cache, caplog
    ) -> None:
        async def slow_post(*args, **kwargs):
            await asyncio.sleep(0.02)
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {"places": []}
            return response

        matcher._client.post = AsyncMock(side_effect=slow_post)
        monkeypatch.setattr(
            matcher, "_enrich_place_ratings", AsyncMock(return_value={})
        )

        with caplog.at_level(logging.INFO):
            await matcher.find_places_for_clusters(_clusters(10))

        payload = _capture_metrics(caplog)[0]
        outbound = payload["outbound"]

        assert outbound["peak_concurrent"] == MAX_CONCURRENCY
        assert outbound["by_method"][METHOD_NEARBY] == outbound["total"] > 0
        assert outbound["requests_per_second"][METHOD_NEARBY] > 0
        assert outbound["overall_requests_per_second"] > 0


class TestVisionNullRate:
    """Vision aggregates travel with the request metrics (R18)."""

    @pytest.mark.asyncio
    async def test_null_rate_recorded(self, monkeypatch, caplog) -> None:
        from app.services.photo_vision import classifier as classifier_module

        results = {
            "cluster-0": VisionResult(category="food", confidence="high"),
            "cluster-1": None,
        }

        async def fake_classify(self, image_base64: str):
            return results[image_base64]

        monkeypatch.setattr(
            classifier_module.PhotoClassifier, "classify", fake_classify
        )

        clusters = [
            {"id": "cluster-0", "vision_images_base64": ["cluster-0"]},
            {"id": "cluster-1", "vision_images_base64": ["cluster-1"]},
        ]

        with caplog.at_level(logging.INFO), request_metrics():
            await classifier_module.classify_cluster_photos(clusters)

        vision = _capture_metrics(caplog)[0]["vision"]
        assert vision["clusters_attempted"] == 2
        assert vision["clusters_classified"] == 1
        assert vision["clusters_null"] == 1
        assert vision["null_rate"] == 0.5
        assert vision["images_attempted"] == 2
        assert vision["images_null"] == 1
        assert vision["total_ms"] >= 0


class TestLogPrivacy:
    """R27: no coordinate, cluster id, geohash, or place id at default level."""

    @pytest.mark.asyncio
    async def test_default_level_logs_carry_no_identifiers(
        self, matcher, monkeypatch, clean_cache, no_persistent_cache, caplog
    ) -> None:
        places = [_place("place-abc123", 35.6762, 139.6503, "Sushi Bar")]

        async def post(*args, **kwargs):
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {"places": places}
            return response

        matcher._client.post = AsyncMock(side_effect=post)
        monkeypatch.setattr(
            matcher,
            "_enrich_place_ratings",
            AsyncMock(return_value={"place-abc123": {"rating": 4.6}}),
        )

        with caplog.at_level(logging.INFO):
            await matcher.find_places_for_clusters(_clusters(3))

        text = caplog.text
        assert PHASE_METRICS_EVENT in text
        for forbidden in ("cluster-0", "cluster-1", "place-abc123", "35.676", "139.65"):
            assert forbidden not in text, f"{forbidden!r} leaked into default logs"

    @pytest.mark.asyncio
    async def test_metrics_payload_is_aggregate_only(
        self, matcher, monkeypatch, clean_cache, no_persistent_cache, caplog
    ) -> None:
        async def post(*args, **kwargs):
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {"places": []}
            return response

        matcher._client.post = AsyncMock(side_effect=post)

        with caplog.at_level(logging.INFO):
            await matcher.find_places_for_clusters(_clusters(2))

        raw = json.dumps(_capture_metrics(caplog)[0])
        for forbidden in ("cluster-", "place-", "latitude", "longitude", "geohash"):
            assert forbidden not in raw
