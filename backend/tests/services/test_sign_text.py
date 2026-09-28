"""On-device signage text as a name signal (venue-rollup plan U10, KTD6, R6).

The phone sends up to 5 short strings Apple Vision read from a cluster's
photos (``PhotoCluster.sign_text``). The matcher treats them like a
vision-detected business name in ranking, uses a strong match as R6 evidence in
the roll-up, and lets a strong match set the name-match lock only when the
matched finalist is not sub-POI-like, so a museum wall placard naming an
exhibit can never block the roll-up to the museum.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.schemas.photos import PhotoCluster
from app.services.photo_vision import VisionResult
from app.services.place_matcher import DensityLevel, PlaceMatcher
from app.services.place_matcher._venue_facts import sign_text_sets_lock
from tests.services.venue_probe_support import (
    LOUVRE_LAT,
    _cluster,
    _louvre,
    _place,
    _wire_flow,
    make_settings,
)


@pytest.fixture
def settings(monkeypatch):
    return make_settings(monkeypatch)


def _signed_cluster(sign_text: list[str] | None, **kwargs: Any) -> dict[str, Any]:
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
        sign_text=sign_text,
    ).model_dump()


def _street_world() -> list[dict[str, Any]]:
    """A bistro at the centroid and a named restaurant ~55m north."""
    return [
        _place("near", "Bistro du Coin", "restaurant", ["restaurant", "food"]),
        _place(
            "janou",
            "Chez Janou",
            "restaurant",
            ["restaurant", "food"],
            lat=LOUVRE_LAT + 0.0005,
        ),
    ]


# ---------------------------------------------------------------------------
# Ranking: sign text is a name signal, like a vision business name
# ---------------------------------------------------------------------------


class TestRanking:
    def _rank(self, cluster, vision_result=None) -> list[str]:
        matcher = PlaceMatcher(http_client=AsyncMock())
        ranked = matcher._rank_by_distance(
            places=_street_world(), cluster=cluster, vision_result=vision_result
        )
        return [p["place_id"] for p in ranked]

    def test_strong_sign_match_promotes_like_a_vision_business_name(
        self, settings
    ) -> None:
        assert self._rank(_cluster()) == ["near", "janou"]

        by_vision = self._rank(
            _cluster(),
            VisionResult(category="food", detected_text=["Chez Janou"]),
        )
        by_sign = self._rank(_signed_cluster(["Chez Janou"]))

        assert by_vision[0] == "janou"
        assert by_sign == by_vision

    def test_absent_or_empty_sign_text_ranks_exactly_as_today(self, settings) -> None:
        matcher = PlaceMatcher(http_client=AsyncMock())

        def ranked(cluster: dict[str, Any]) -> list[dict]:
            return matcher._rank_by_distance(places=_street_world(), cluster=cluster)

        today = ranked(_cluster())
        assert ranked(_signed_cluster(None)) == today
        assert ranked({**_cluster(), "sign_text": []}) == today


# ---------------------------------------------------------------------------
# The KTD6 lock rule
# ---------------------------------------------------------------------------


class TestLockRule:
    def test_strong_match_on_a_sub_poi_finalist_never_locks(self) -> None:
        gallery = _place("galerie", "Galerie d'Apollon", "art_gallery")
        assert not sign_text_sets_lock(
            gallery, "Galerie d'Apollon", ["Galerie d'Apollon"]
        )

    def test_strong_match_on_other_finalists_locks(self) -> None:
        cafe = _place("marly", "Le Cafe Marly", "cafe", ["cafe", "food"])
        assert sign_text_sets_lock(cafe, "Le Cafe Marly", ["Le Cafe Marly"])

    def test_weak_or_absent_match_never_locks(self) -> None:
        cafe = _place("marly", "Le Cafe Marly", "cafe", ["cafe", "food"])
        assert not sign_text_sets_lock(cafe, "Le Cafe Marly", None)
        assert not sign_text_sets_lock(cafe, "Le Cafe Marly", [])
        # Containment only: "Cafe Marly" inside a longer, different name.
        assert not sign_text_sets_lock(
            cafe, "Le Cafe Marly", ["Terrasse du Le Cafe Marly Grand Louvre Annexe"]
        )


# ---------------------------------------------------------------------------
# End to end through find_places_for_clusters
# ---------------------------------------------------------------------------


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


def _cafe_world() -> list[dict[str, Any]]:
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


class TestFlow:
    async def _run(
        self,
        monkeypatch,
        world,
        ratings,
        cluster,
        vision: dict[str, VisionResult] | None = None,
    ) -> tuple[list[str], list[str]]:
        """Return (place ids, enriched place ids) for one cluster."""
        matcher = PlaceMatcher(http_client=AsyncMock())
        _wire_flow(
            matcher,
            monkeypatch,
            world,
            DensityLevel.SPARSE,
            [_louvre()],
            ratings=ratings,
        )
        enriched: list[str] = []

        async def tracking_enrich(place_ids):
            enriched.extend(place_ids)
            return {pid: r for pid, r in ratings.items() if pid in place_ids}

        monkeypatch.setattr(matcher, "_enrich_place_ratings", tracking_enrich)

        async def vision_task():
            return vision or {}

        results, failed = await matcher.find_places_for_clusters(
            [cluster],
            vision_results_task=asyncio.ensure_future(vision_task()),
        )
        assert failed == 0
        return [p["place_id"] for p in results[0]["places"]], enriched

    @pytest.mark.asyncio
    async def test_louvre_interior_placard_naming_a_gallery_still_rolls_up(
        self, settings, monkeypatch
    ) -> None:
        ids, enriched = await self._run(
            monkeypatch,
            _gallery_world(),
            _GALLERY_RATINGS,
            _signed_cluster(["Galerie d'Apollon"]),
        )
        assert ids[0] == "louvre"
        assert "galerie" in ids
        # No lock on a sub-POI finalist: enrichment still ran.
        assert "galerie" in enriched

    @pytest.mark.asyncio
    async def test_vision_business_name_lock_on_a_gallery_is_unchanged(
        self, settings, monkeypatch
    ) -> None:
        # Today's behavior, kept exactly: a strong VISION match locks whatever
        # the finalist's type, which also keeps the roll-up away.
        vision = VisionResult(
            category="landmark", detected_text=["Galerie d'Apollon"], confidence="high"
        )
        ids, enriched = await self._run(
            monkeypatch,
            _gallery_world(),
            _GALLERY_RATINGS,
            _cluster(),
            vision={"cluster-1": vision},
        )
        assert ids[0] == "galerie"
        assert enriched == []

    @pytest.mark.asyncio
    async def test_cafe_sign_keeps_the_cafe_first(self, settings, monkeypatch) -> None:
        # Without sign text the roll-up applies (378k vs 12k reviews) ...
        ids, _ = await self._run(monkeypatch, _cafe_world(), _CAFE_RATINGS, _cluster())
        assert ids[:2] == ["louvre", "marly"]

        # ... and a strong sign match to the cafe is the R6 evidence that keeps it.
        ids, _ = await self._run(
            monkeypatch,
            _cafe_world(),
            _CAFE_RATINGS,
            _signed_cluster(["Le Cafe Marly"]),
        )
        assert ids[0] == "marly"

    @pytest.mark.asyncio
    async def test_weak_sign_match_never_overrides_a_strong_lock(
        self, settings, monkeypatch
    ) -> None:
        world = [
            _place("sushi", "Sushi Dai", "restaurant", ["restaurant", "food"]),
            _place(
                "market",
                "Tsukiji Outer Market Food Hall",
                "restaurant",
                ["restaurant", "food"],
            ),
        ]
        ratings = {
            "sushi": {"rating": 4.5, "userRatingCount": 900},
            "market": {"rating": 4.4, "userRatingCount": 20000},
        }
        vision = VisionResult(
            category="food", detected_text=["Sushi Dai"], confidence="high"
        )
        ids, enriched = await self._run(
            monkeypatch,
            world,
            ratings,
            # "Outer Market" only sits inside the other name: a weak match.
            _signed_cluster(["Outer Market"]),
            vision={"cluster-1": vision},
        )
        assert ids[0] == "sushi"
        assert enriched == []  # the vision lock still holds

    @pytest.mark.asyncio
    async def test_absent_sign_text_output_is_identical_to_today(
        self, settings, monkeypatch
    ) -> None:
        for world, ratings in (
            (_cafe_world(), _CAFE_RATINGS),
            (_gallery_world(), _GALLERY_RATINGS),
        ):
            today, _ = await self._run(monkeypatch, world, ratings, _cluster())
            dumped, _ = await self._run(
                monkeypatch, world, ratings, _signed_cluster(None)
            )
            assert dumped == today
