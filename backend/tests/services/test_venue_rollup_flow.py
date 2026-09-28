"""Orchestration tests for the KTD4 venue roll-up (venue-rollup plan U7).

Drives ``find_places_for_clusters`` with the mocked search, venue probe and
enrichment of the U6 tests: the roll-up is the only reader of the probe map and
runs after re-rank and backfill, once per cluster.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.services.place_matcher import DensityLevel, PlaceMatcher
from tests.services.venue_probe_support import (
    LOUVRE_LAT,
    _cluster,
    _louvre,
    _place,
    _wire_flow,
    make_settings,
)


def _interior_world() -> list[dict[str, Any]]:
    """Louvre-interior candidates as the rating-blind wide search returns them."""
    return [
        _place("dept-islam", "Departement des Arts de l'Islam", "museum"),
        _place(
            "mona-lisa",
            "Mona Lisa",
            "cultural_landmark",
            ["cultural_landmark", "point_of_interest"],
            lat=LOUVRE_LAT + 0.0001,
        ),
        _place(
            "victoire", "Victoire de Samothrace", "sculpture", lat=LOUVRE_LAT + 0.0003
        ),
    ]


_INTERIOR_RATINGS = {
    "dept-islam": {"rating": 4.5, "userRatingCount": 32},
    "mona-lisa": {"rating": 4.1, "userRatingCount": 412},
    "victoire": {"rating": 4.8, "userRatingCount": 45},
}


@pytest.fixture
def settings(monkeypatch):
    return make_settings(monkeypatch)


class TestOrchestration:
    @pytest.mark.asyncio
    async def test_three_interior_clusters_share_the_louvre_first(
        self, settings, monkeypatch
    ) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())
        _wire_flow(
            matcher,
            monkeypatch,
            _interior_world(),
            DensityLevel.SPARSE,
            [_louvre()],
            ratings=_INTERIOR_RATINGS,
        )
        clusters = [
            _cluster("c-1"),
            _cluster("c-2", lat=48.86120, lng=2.33600),
            _cluster("c-3", lat=48.86080, lng=2.33700),
        ]

        results, failed = await matcher.find_places_for_clusters(clusters)

        assert failed == 0
        assert len(results) == 3
        firsts = {r["places"][0]["place_id"] for r in results}
        assert firsts == {"louvre"}
        for r in results:
            ids = [p["place_id"] for p in r["places"]]
            assert len(ids) == len(set(ids)) <= 3

    @pytest.mark.asyncio
    async def test_no_op_setting_restores_pre_rollup_places(
        self, settings, monkeypatch
    ) -> None:
        async def run(min_reviews: int) -> list[dict]:
            settings.places_rollup_min_parent_reviews = min_reviews
            matcher = PlaceMatcher(http_client=AsyncMock())
            _wire_flow(
                matcher,
                monkeypatch,
                _interior_world(),
                DensityLevel.SPARSE,
                [_louvre()],
                ratings=_INTERIOR_RATINGS,
            )
            results, _ = await matcher.find_places_for_clusters([_cluster()])
            return results

        on = await run(2000)
        off = await run(0)
        assert on[0]["places"][0]["place_id"] == "louvre"
        assert "louvre" not in {p["place_id"] for p in off[0]["places"]}

    @pytest.mark.asyncio
    async def test_diagnostics_trace_records_the_decision(
        self, settings, monkeypatch, caplog
    ) -> None:
        settings.places_diagnostics = True
        matcher = PlaceMatcher(http_client=AsyncMock())
        _wire_flow(
            matcher,
            monkeypatch,
            _interior_world(),
            DensityLevel.SPARSE,
            [_louvre()],
            ratings=_INTERIOR_RATINGS,
        )
        with caplog.at_level("INFO"):
            await matcher.find_places_for_clusters([_cluster()])

        traces = [
            json.loads(r.getMessage())["place_matcher_diagnostic_trace"]
            for r in caplog.records
            if r.getMessage().startswith('{"place_matcher_diagnostic_trace"')
        ]
        assert len(traces) == 1
        assert traces[0]["venue_rollup"] == {
            "reason": "rolled_up",
            "parent_place_id": "louvre",
        }
