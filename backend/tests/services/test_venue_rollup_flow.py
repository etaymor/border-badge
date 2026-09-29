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

from app.schemas.photos import PhotoCluster
from app.services.place_matcher import DensityLevel, PlaceMatcher
from tests.services.venue_probe_support import (
    LOUVRE_LAT,
    _cluster,
    _louvre,
    _place,
    _restaurant_world,
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


# ---------------------------------------------------------------------------
# U9: on-device scene hints reach the probe trigger and the roll-up veto
# ---------------------------------------------------------------------------


def _hinted_cluster(labels: list[str], **kwargs: Any) -> dict[str, Any]:
    """A cluster dict as the API hands it over: the schema's ``model_dump``."""
    cluster = _cluster(**kwargs)
    return PhotoCluster(
        id=cluster["id"],
        centroid=cluster["centroid"],
        photos=[
            {
                "asset_id": f"{cluster['id']}-photo-1",
                "latitude": cluster["centroid"]["latitude"],
                "longitude": cluster["centroid"]["longitude"],
            }
        ],
        scene_hints=[{"label": label, "weight": 0.8} for label in labels],
    ).model_dump()


def _cafe_world() -> list[dict[str, Any]]:
    """A well-reviewed cafe at the centroid beside a small statue (the statue's
    landmark family is what makes production probe this cluster)."""
    return [
        _place("marly", "Le Cafe Marly", "cafe", ["cafe", "restaurant", "food"]),
        _place(
            "statue",
            "Statue of Lafayette",
            "sculpture",
            ["sculpture", "tourist_attraction", "point_of_interest"],
            lat=LOUVRE_LAT + 0.0004,
        ),
    ]


_CAFE_RATINGS = {
    "marly": {"rating": 4.3, "userRatingCount": 12000},
    "statue": {"rating": 4.5, "userRatingCount": 30},
}


def _gallery_world() -> list[dict[str, Any]]:
    return [
        _place("galerie", "Galerie d'Apollon", "art_gallery"),
        _place(
            "victoire", "Victoire de Samothrace", "sculpture", lat=LOUVRE_LAT + 0.0003
        ),
    ]


_GALLERY_RATINGS = {
    "galerie": {"rating": 4.8, "userRatingCount": 150},
    "victoire": {"rating": 4.8, "userRatingCount": 45},
}


class TestSceneHints:
    async def _run(
        self, monkeypatch, world, ratings, cluster, density=DensityLevel.SPARSE
    ) -> tuple[list[str], list]:
        matcher = PlaceMatcher(http_client=AsyncMock())
        calls = _wire_flow(
            matcher, monkeypatch, world, density, [_louvre()], ratings=ratings
        )
        results, failed = await matcher.find_places_for_clusters([cluster])
        assert failed == 0
        return [p["place_id"] for p in results[0]["places"]], calls

    @pytest.mark.asyncio
    async def test_food_hint_keeps_the_cafe_first(self, settings, monkeypatch) -> None:
        # Without a hint the roll-up applies (378k vs 12k reviews, 31x) ...
        ids, _ = await self._run(monkeypatch, _cafe_world(), _CAFE_RATINGS, _cluster())
        assert ids[:2] == ["louvre", "marly"]

        # ... and the on-device food hint is the R6 evidence that vetoes it.
        ids, _ = await self._run(
            monkeypatch, _cafe_world(), _CAFE_RATINGS, _hinted_cluster(["food"])
        )
        assert ids[0] == "marly"

    @pytest.mark.asyncio
    async def test_food_hint_does_not_block_rollup_over_a_gallery(
        self, settings, monkeypatch
    ) -> None:
        ids, _ = await self._run(
            monkeypatch, _gallery_world(), _GALLERY_RATINGS, _hinted_cluster(["food"])
        )
        assert ids[0] == "louvre"

    @pytest.mark.parametrize("density", [DensityLevel.MEDIUM, DensityLevel.SPARSE])
    @pytest.mark.parametrize("label", ["museum_interior", "artwork"])
    @pytest.mark.asyncio
    async def test_museum_hint_probes_a_restaurant_only_cluster(
        self, settings, monkeypatch, density, label
    ) -> None:
        _ids, calls = await self._run(
            monkeypatch, _restaurant_world(), {}, _hinted_cluster([label]), density
        )
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_food_or_absent_hints_do_not_probe_restaurants(
        self, settings, monkeypatch
    ) -> None:
        for cluster in (_cluster(), _hinted_cluster(["food", "outdoor_landmark"])):
            _ids, calls = await self._run(
                monkeypatch, _restaurant_world(), {}, cluster, DensityLevel.MEDIUM
            )
            assert calls == []
