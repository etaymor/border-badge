"""Tests for the U6 venue probe (KTD3 as amended 2026-09-27).

The venue probe is one POPULARITY-ranked Nearby call, restricted to major-venue
types and carrying rating/userRatingCount/viewport, that brings a nearby major
venue (the Louvre, the Eiffel Tower) into a SEPARATE per-cluster map. Only the
KTD4 roll-up (U7) may read that map, so with the roll-up absent the returned
``places`` must be byte-identical with the probe on or off.

Trigger (user decision, overriding KTD3's density gate): no density gate. It
fires at ANY density when a local candidate is museum/landmark/attraction
family, or when on-device scene hints say ``museum_interior`` / ``artwork``.
"""

import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest

from app.services.place_matcher import DensityLevel, PlaceMatcher
from app.services.place_matcher._venue_probe import should_probe_venue
from app.services.place_matcher.exceptions import RateLimitError
from tests.services.venue_probe_support import (
    _attraction_world,
    _cluster,
    _louvre,
    _place,
    _restaurant_world,
    _wire_flow,
    make_settings,
)


@pytest.fixture
def settings(monkeypatch):
    return make_settings(monkeypatch)


# ---------------------------------------------------------------------------
# Trigger (pure)
# ---------------------------------------------------------------------------


class TestShouldProbeVenue:
    def test_cultural_landmark_candidate_triggers(self) -> None:
        world = [_place("mona", "Mona Lisa", "cultural_landmark")]
        assert should_probe_venue(world) is True

    @pytest.mark.parametrize(
        "primary_type",
        [
            "museum",
            "art_museum",
            "art_gallery",
            "cultural_landmark",
            "historical_landmark",
            "monument",
            "tourist_attraction",
        ],
    )
    def test_each_major_family_type_triggers(self, primary_type: str) -> None:
        assert should_probe_venue([_place("p", "P", primary_type)]) is True

    def test_family_type_in_secondary_types_triggers(self) -> None:
        # Google often puts the attraction type second (e.g. a sculpture).
        world = [
            _place("v", "Victoire", "sculpture", ["sculpture", "tourist_attraction"])
        ]
        assert should_probe_venue(world) is True

    def test_restaurants_and_lodging_without_hints_do_not_trigger(self) -> None:
        assert should_probe_venue(_restaurant_world()) is False
        assert should_probe_venue(_restaurant_world(), None) is False

    def test_empty_world_without_hints_does_not_trigger(self) -> None:
        assert should_probe_venue([]) is False

    @pytest.mark.parametrize("hint", ["museum_interior", "artwork"])
    def test_museum_hint_triggers_even_on_restaurants(self, hint: str) -> None:
        assert should_probe_venue(_restaurant_world(), [hint]) is True
        assert should_probe_venue([], [{"label": hint, "weight": 0.8}]) is True

    def test_unrelated_hints_do_not_trigger(self) -> None:
        hints = [{"label": "food", "weight": 0.9}, "outdoor_landmark"]
        assert should_probe_venue(_restaurant_world(), hints) is False

    def test_malformed_hints_are_ignored(self) -> None:
        assert should_probe_venue([], [None, 3, {"weight": 1}]) is False


# ---------------------------------------------------------------------------
# Cluster flow: trigger at every density, isolation, degradation
# ---------------------------------------------------------------------------


class TestVenueProbeClusterFlow:
    @pytest.mark.asyncio
    async def test_dense_attraction_cluster_probes_exactly_once(
        self, settings, monkeypatch
    ) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        calls = _wire_flow(
            matcher, monkeypatch, _attraction_world(), DensityLevel.DENSE, [_louvre()]
        )

        _results, failed = await matcher.find_places_for_clusters([_cluster()])

        assert failed == 0
        assert len(calls) == 1
        assert matcher.last_venue_probe_results == {"cluster-1": [_louvre()]}

    @pytest.mark.asyncio
    async def test_sparse_cluster_with_cultural_landmark_probes(
        self, settings, monkeypatch
    ) -> None:
        """Indoors the 15m ring finds nothing: most Louvre clusters are SPARSE."""
        matcher = PlaceMatcher(http_client=AsyncMock())
        world = [_place("mona", "Mona Lisa", "cultural_landmark")]
        calls = _wire_flow(
            matcher, monkeypatch, world, DensityLevel.SPARSE, [_louvre()]
        )

        _results, failed = await matcher.find_places_for_clusters([_cluster()])

        assert failed == 0
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_medium_cluster_with_museum_probes(
        self, settings, monkeypatch
    ) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        world = [_place("dept", "Departement des Antiquites", "museum")]
        calls = _wire_flow(
            matcher, monkeypatch, world, DensityLevel.MEDIUM, [_louvre()]
        )

        await matcher.find_places_for_clusters([_cluster()])

        assert len(calls) == 1

    @pytest.mark.parametrize(
        "density", [DensityLevel.DENSE, DensityLevel.MEDIUM, DensityLevel.SPARSE]
    )
    @pytest.mark.asyncio
    async def test_restaurant_cluster_never_probes(
        self, settings, monkeypatch, density
    ) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        calls = _wire_flow(
            matcher, monkeypatch, _restaurant_world(), density, [_louvre()]
        )

        _results, failed = await matcher.find_places_for_clusters([_cluster()])

        assert failed == 0
        assert calls == []
        assert matcher.last_venue_probe_results == {}

    @pytest.mark.asyncio
    async def test_probe_is_centered_on_the_rounded_cell(
        self, settings, monkeypatch
    ) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        calls = _wire_flow(
            matcher, monkeypatch, _attraction_world(), DensityLevel.DENSE, []
        )

        await matcher.find_places_for_clusters([_cluster()])

        assert calls == [(48.861, 2.336)]

    @pytest.mark.asyncio
    async def test_flag_off_makes_no_call(self, settings, monkeypatch) -> None:
        settings.places_venue_probe = False
        matcher = PlaceMatcher(http_client=AsyncMock())
        calls = _wire_flow(
            matcher, monkeypatch, _attraction_world(), DensityLevel.DENSE, [_louvre()]
        )

        _results, failed = await matcher.find_places_for_clusters([_cluster()])

        assert failed == 0
        assert calls == []
        assert matcher.last_venue_probe_results == {}

    @pytest.mark.asyncio
    async def test_places_identical_with_probe_on_and_off(
        self, settings, monkeypatch
    ) -> None:
        """KTD3 isolation: probe venues never become finalists, backfill or filler.

        The world is sized below MAX_SUGGESTIONS_PER_CLUSTER after the review
        gate so the backfill and un-gated filler paths both run, which is where
        a leaked probe venue would surface.
        """
        world = _attraction_world()
        ratings = {
            "pyramid": {"rating": 4.6, "userRatingCount": 85693},
            "dept-islam": {"rating": 4.5, "userRatingCount": 2},  # gated out
            "galerie": {"rating": 4.8, "userRatingCount": 900},
            "victoire": {"rating": 4.8, "userRatingCount": 45},
        }

        # The U7 roll-up is set to its no-op value: this pins the probe's own
        # isolation, not the roll-up (tests/services/test_venue_rollup.py).
        settings.places_rollup_min_parent_reviews = 0

        async def run(flag: bool) -> tuple[list[dict], list[tuple[float, float]]]:
            settings.places_venue_probe = flag
            matcher = PlaceMatcher(http_client=AsyncMock())
            calls = _wire_flow(
                matcher,
                monkeypatch,
                world,
                DensityLevel.SPARSE,
                [_louvre()],
                ratings=ratings,
            )
            results, failed = await matcher.find_places_for_clusters([_cluster()])
            assert failed == 0
            return results, calls

        on_results, on_calls = await run(True)
        off_results, off_calls = await run(False)

        assert len(on_calls) == 1
        assert off_calls == []
        assert json.dumps(on_results, sort_keys=True) == json.dumps(
            off_results, sort_keys=True
        )
        assert "louvre" not in {p["place_id"] for p in on_results[0]["places"]}

    @pytest.mark.parametrize(
        "error",
        [
            RateLimitError("rate limited"),
            httpx.ReadTimeout("slow"),
            RuntimeError("unexpected"),
        ],
    )
    @pytest.mark.asyncio
    async def test_failed_probe_never_fails_the_cluster(
        self, settings, monkeypatch, error
    ) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        _wire_flow(matcher, monkeypatch, _attraction_world(), DensityLevel.DENSE, error)

        results, failed = await matcher.find_places_for_clusters([_cluster()])

        assert failed == 0
        assert results[0]["places"]
        assert matcher.last_venue_probe_results == {"cluster-1": []}

    @pytest.mark.asyncio
    async def test_probe_timeout_never_fails_the_cluster(
        self, settings, monkeypatch
    ) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        _wire_flow(matcher, monkeypatch, _attraction_world(), DensityLevel.DENSE, [])

        async def hang(latitude, longitude):
            await asyncio.sleep(10)
            return [_louvre()]

        monkeypatch.setattr(matcher, "_execute_venue_probe", hang)
        monkeypatch.setattr(
            "app.services.place_matcher._matcher_cluster_processing."
            "cluster_timeout_for",
            lambda _settings: 0.05,
        )

        results, failed = await matcher.find_places_for_clusters([_cluster()])

        assert failed == 0
        assert results[0]["places"]
        assert matcher.last_venue_probe_results == {"cluster-1": []}


# ---------------------------------------------------------------------------
# Lifecycle: an aborted request must not orphan the probe task
# ---------------------------------------------------------------------------


class TestVenueProbeTaskLifecycle:
    @pytest.mark.parametrize(
        "error", [RateLimitError("quota"), asyncio.CancelledError()]
    )
    @pytest.mark.asyncio
    async def test_phase_failure_cancels_in_flight_probe(
        self, settings, monkeypatch, error
    ) -> None:
        """A phase raising (or the request being cancelled) after the probe
        task starts must cancel it, not leave paid calls running unowned."""
        matcher = PlaceMatcher(http_client=AsyncMock())
        _wire_flow(
            matcher,
            monkeypatch,
            _attraction_world(),
            DensityLevel.DENSE,
            ratings={"pyramid": {"rating": 4.6, "userRatingCount": 900}},
        )
        started = asyncio.Event()
        outcome: list[str] = []

        async def blocked_probe(latitude, longitude):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                outcome.append("cancelled")
                raise
            outcome.append("completed")
            return []

        monkeypatch.setattr(matcher, "_execute_venue_probe", blocked_probe)

        real_enrich = matcher._enrich_place_ratings

        async def enrich_after_probe_starts(place_ids):
            await started.wait()
            return await real_enrich(place_ids)

        monkeypatch.setattr(matcher, "_enrich_place_ratings", enrich_after_probe_starts)

        real_rank = matcher._rank_by_distance
        rank_calls = 0

        def rank_then_fail(*args, **kwargs):
            nonlocal rank_calls
            rank_calls += 1
            if rank_calls > 1:  # the post-enrichment re-rank
                raise error
            return real_rank(*args, **kwargs)

        monkeypatch.setattr(matcher, "_rank_by_distance", rank_then_fail)

        with pytest.raises(type(error)):
            await matcher.find_places_for_clusters([_cluster()])

        assert started.is_set()
        assert outcome == ["cancelled"]


# ---------------------------------------------------------------------------
# Request-budget gate (U8)
# ---------------------------------------------------------------------------


class TestVenueProbeBudgetGate:
    @pytest.mark.asyncio
    async def test_spent_budget_skips_the_google_call(self, settings) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        matcher._execute_venue_probe = AsyncMock(return_value=[_louvre()])

        result = await matcher._venue_probes_for_clusters(
            [(_cluster(), _attraction_world(), 15)],
            semaphore=asyncio.Semaphore(1),
            remaining_budget=lambda: 0,
            retry_budget=5.0,
            cluster_timeout=5.0,
        )

        assert result == {"cluster-1": []}
        matcher._execute_venue_probe.assert_not_called()
