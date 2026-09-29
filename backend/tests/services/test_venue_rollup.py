"""Tests for the KTD4 venue roll-up (venue-rollup plan U7).

The roll-up is a deterministic post-rank step: after re-rank and backfill, a
venue-probe result becomes ``places[0]`` when it contains the cluster, is major,
dominates the top finalist, and the top finalist is a minor place inside it
(an exhibit, gallery, or landmark-family POI; or a food / drink / lodging /
retail place with no positive evidence for it). Numbers in these scenarios come
from the U4 live Louvre and Eiffel captures (docs/photo-import.md).
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from app.services.photo_vision import VisionResult
from app.services.place_matcher import PlaceMatcher
from app.services.place_matcher.venue_rollup import (
    RollupThresholds,
    apply_venue_rollup,
    rollup_thresholds,
)

# Cluster centroid inside the Louvre (Richelieu wing), as in the U4 capture.
LAT = 48.86103
LNG = 2.33583
M_PER_DEG_LAT = 111_320.0

DEFAULTS = RollupThresholds(
    max_distance_m=250, min_parent_reviews=2000, dominance_ratio=10.0
)
OFF = RollupThresholds(max_distance_m=250, min_parent_reviews=0, dominance_ratio=10)


def _north(meters: float) -> float:
    return LAT + meters / M_PER_DEG_LAT


def _viewport(half_m: float = 160.0, center_lat: float = LAT) -> dict[str, Any]:
    d_lat = half_m / M_PER_DEG_LAT
    d_lng = half_m / 73_300.0
    return {
        "low": {"latitude": center_lat - d_lat, "longitude": LNG - d_lng},
        "high": {"latitude": center_lat + d_lat, "longitude": LNG + d_lng},
    }


def _raw(
    place_id: str,
    primary_type: str | None,
    count: int | None,
    *,
    north_m: float = 20.0,
    types: list[str] | None = None,
    name: str | None = None,
    viewport: dict[str, Any] | None = None,
) -> dict[str, Any]:
    place: dict[str, Any] = {
        "id": place_id,
        "displayName": {"text": name or place_id.replace("-", " ").title()},
        "formattedAddress": f"{place_id} address",
        "location": {"latitude": _north(north_m), "longitude": LNG},
        "types": types
        or [t for t in (primary_type, "point_of_interest", "establishment") if t],
        "businessStatus": "OPERATIONAL",
    }
    if primary_type:
        place["primaryType"] = primary_type
    if count is not None:
        place["rating"] = 4.6
        place["userRatingCount"] = count
    if viewport is not None:
        place["viewport"] = viewport
    return place


def _parent(
    count: int = 300_000,
    *,
    north_m: float = 180.0,
    inside: bool = True,
    place_id: str = "parent",
    primary_type: str = "art_museum",
    types: list[str] | None = None,
) -> dict[str, Any]:
    # ``inside``: the viewport covers the centroid; otherwise it is a small box
    # around the parent's own point that stops short of the centroid.
    viewport = (
        _viewport(half_m=north_m + 60)
        if inside
        else _viewport(half_m=40, center_lat=_north(north_m))
    )
    return _raw(
        place_id,
        primary_type,
        count,
        north_m=north_m,
        types=types
        or [primary_type, "tourist_attraction", "museum", "point_of_interest"],
        viewport=viewport,
    )


def _suggest(raw: dict[str, Any]) -> dict[str, Any]:
    """A finalist in the exact shape ``_rank_by_distance`` returns."""
    matcher = PlaceMatcher(http_client=AsyncMock())
    return matcher._rank_by_distance(
        places=[raw], cluster={"centroid": {"latitude": LAT, "longitude": LNG}}
    )[0]


def _run(
    finalists: list[dict[str, Any]],
    probe: list[dict[str, Any]],
    *,
    thresholds: RollupThresholds = DEFAULTS,
    **kwargs: Any,
) -> tuple[list[str], str]:
    places, decision = apply_venue_rollup(
        [_suggest(p) for p in finalists],
        probe,
        centroid={"latitude": LAT, "longitude": LNG},
        place_facts={p["id"]: p for p in finalists},
        thresholds=thresholds,
        **kwargs,
    )
    return [p["place_id"] for p in places], decision.reason


def _galleries() -> list[dict[str, Any]]:
    return [
        _raw("gallery-a", "art_gallery", 2500, north_m=10),
        _raw("gallery-b", "art_gallery", 900, north_m=25),
        _raw("gallery-c", "art_gallery", 20, north_m=40),
    ]


def _cafe(count: int = 5000) -> dict[str, Any]:
    return _raw(
        "cafe",
        "restaurant",
        count,
        north_m=7,
        types=["restaurant", "cafe", "food", "point_of_interest"],
        name="Le Cafe Marly",
    )


def _bookshop() -> dict[str, Any]:
    return _raw(
        "bookshop", "book_store", 240, north_m=16, types=["book_store", "store"]
    )


def _statue() -> dict[str, Any]:
    return _raw("statue", "tourist_attraction", 60, north_m=25)


# ---------------------------------------------------------------------------
# Plan scenarios (KTD4)
# ---------------------------------------------------------------------------


class TestRollsUp:
    def test_louvre_interior_parent_first_then_two_best_finalists(self) -> None:
        ids, reason = _run(_galleries(), [_parent()])
        assert ids == ["parent", "gallery-a", "gallery-b"]
        assert reason == "rolled_up"

    def test_pyramid_exterior_attraction_meets_the_ratio(self) -> None:
        # 20k vs 300k = 15x: dominance holds even with the parent OUTSIDE the
        # viewport, via the 250m distance branch.
        pyramid = _raw("pyramid", "tourist_attraction", 20_000, north_m=3)
        ids, reason = _run(
            [pyramid, _raw("kiosk", "cafe", 40, north_m=9)],
            [_parent(north_m=180, inside=False)],
        )
        assert ids[0] == "parent"
        assert reason == "rolled_up"

    def test_famous_exhibit_inside_viewport_takes_the_waiver(self) -> None:
        # Mona Lisa at 60k: 300k/60k = 5x < 10, waived inside the viewport.
        mona = _raw("mona-lisa", "tourist_attraction", 60_000, north_m=10)
        ids, _ = _run([mona], [_parent()])
        assert ids == ["parent", "mona-lisa"]

    def test_live_louvre_pyramid_numbers_roll_up(self) -> None:
        # U4 live capture: Louvre Pyramid 85,693 (cultural_landmark) vs Louvre
        # 378,404 is only 4.4x; the centroid is inside the Louvre viewport.
        pyramid = _raw(
            "pyramid",
            "cultural_landmark",
            85_693,
            north_m=3,
            types=["cultural_landmark", "tourist_attraction", "point_of_interest"],
        )
        ids, reason = _run([pyramid], [_parent(378_404, north_m=141)])
        assert ids == ["parent", "pyramid"]
        assert reason == "rolled_up"

    def test_unprimaried_exhibit_classified_by_its_types(self) -> None:
        # The live Mona Lisa listing has no primaryType, only types.
        mona = _raw(
            "mona-lisa",
            None,
            412,
            types=["cultural_landmark", "point_of_interest", "establishment"],
        )
        ids, _ = _run([mona], [_parent(378_404)])
        assert ids == ["parent", "mona-lisa"]

    def test_small_museum_department_rolls_up(self) -> None:
        # Departement des Antiquites grecques: museum-typed, 23 reviews.
        dept = _raw("dept", "museum", 23, north_m=11)
        ids, _ = _run([dept], [_parent(378_404)])
        assert ids == ["parent", "dept"]

    def test_parent_already_a_finalist_moves_first_without_duplicate(self) -> None:
        parent = _parent()
        finalists = [_raw("gallery-a", "art_gallery", 2500, north_m=10), parent]
        ids, _ = _run(finalists, [parent])
        assert ids == ["parent", "gallery-a"]

    def test_most_reviewed_qualifying_parent_wins(self) -> None:
        small = _parent(50_000, place_id="palace-garden", north_m=100)
        big = _parent(300_000)
        ids, _ = _run(_galleries(), [small, big])
        assert ids[0] == "parent"

    def test_parent_suggestion_has_the_ranked_shape(self) -> None:
        parent = _parent()
        places, _ = apply_venue_rollup(
            [_suggest(p) for p in _galleries()],
            [parent],
            centroid={"latitude": LAT, "longitude": LNG},
            place_facts={p["id"]: p for p in _galleries()},
            thresholds=DEFAULTS,
        )
        assert places[0] == _suggest(parent)
        assert len(places) == 3


class TestFoodDrinkLodgingRetail:
    """R6: a café inside the parent wins only on positive evidence."""

    def test_no_evidence_parent_first_cafe_kept_in_slot_two(self) -> None:
        # The probe fired (a landmark-family candidate is present), the top
        # finalist is food, and nothing points at it.
        ids, reason = _run([_cafe(), _bookshop(), _statue()], [_parent()])
        assert ids == ["parent", "cafe", "bookshop"]
        assert reason == "rolled_up"

    def test_food_hint_keeps_the_cafe_first(self) -> None:
        ids, reason = _run(
            [_cafe(), _bookshop(), _statue()],
            [_parent()],
            scene_hints=[{"label": "food", "weight": 0.9}],
        )
        assert ids == ["cafe", "bookshop", "statue"]
        assert reason == "finalist_has_evidence"

    def test_vision_business_name_keeps_the_cafe_first(self) -> None:
        vision = VisionResult(
            category="unknown", detected_text=["Cafe Marly"], confidence="low"
        )
        ids, reason = _run([_cafe()], [_parent()], vision_result=vision)
        assert ids == ["cafe"]
        assert reason == "finalist_has_evidence"

    def test_vision_food_category_keeps_the_cafe_first(self) -> None:
        vision = VisionResult(category="food", confidence="medium")
        ids, _ = _run([_cafe()], [_parent()], vision_result=vision)
        assert ids == ["cafe"]

    def test_low_confidence_vision_category_is_not_evidence(self) -> None:
        vision = VisionResult(category="food", confidence="low")
        ids, _ = _run([_cafe()], [_parent()], vision_result=vision)
        assert ids[0] == "parent"

    def test_strong_sign_text_keeps_the_cafe_first(self) -> None:
        ids, _ = _run([_cafe()], [_parent()], sign_text=["Le Cafe Marly"])
        assert ids == ["cafe"]

    def test_unrelated_sign_text_is_not_evidence(self) -> None:
        ids, _ = _run([_cafe()], [_parent()], sign_text=["Salle des Etats"])
        assert ids[0] == "parent"

    def test_sign_text_naming_an_exhibit_does_not_block(self) -> None:
        # KTD6: a wall placard naming a sub-POI never protects it.
        victoire = _raw("victoire", "sculpture", 900, name="Victoire de Samothrace")
        ids, _ = _run([victoire], [_parent()], sign_text=["Victoire de Samothrace"])
        assert ids == ["parent", "victoire"]

    def test_lodging_without_evidence_rolls_up(self) -> None:
        apt = _raw("apt", "lodging", 12, types=["lodging", "point_of_interest"])
        ids, _ = _run([apt], [_parent()])
        assert ids == ["parent", "apt"]


class TestNoRollUp:
    def test_distinct_institution_museum_keeps_its_place(self) -> None:
        # Musee des Arts Decoratifs inside the palace: a museum with 40k.
        museum = _raw(
            "arts-deco",
            "art_museum",
            40_000,
            types=["art_museum", "museum", "tourist_attraction"],
        )
        ids, reason = _run([museum], [_parent()])
        assert ids == ["arts-deco"]
        assert reason == "distinct_institution"

    def test_tuileries_park_under_the_ratio(self) -> None:
        # 60k park vs 300k: ratio 5 < 10, and a park never takes the waiver.
        park = _raw("tuileries", "garden", 60_000, types=["garden", "park"])
        ids, reason = _run([park], [_parent()])
        assert ids == ["tuileries"]
        assert reason == "no_qualifying_parent"

    def test_eiffel_tower_is_never_replaced_by_champ_de_mars(self) -> None:
        # U4 live capture at the Eiffel base: the probe returns the Tower itself
        # and Champ de Mars (park, 225,645) whose viewport contains the point.
        tower = _raw(
            "eiffel",
            "historical_landmark",
            495_424,
            north_m=12,
            types=["historical_landmark", "tourist_attraction", "monument"],
            viewport=_viewport(120),
        )
        champ = _parent(
            225_645,
            place_id="champ-de-mars",
            primary_type="park",
            types=["park", "tourist_attraction"],
            north_m=300,
        )
        ids, reason = _run([tower], [tower, champ])
        assert ids == ["eiffel"]
        assert reason == "no_qualifying_parent"

    def test_waiver_needs_a_review_floor(self) -> None:
        # Inside the viewport but the parent has under 2x the finalist's
        # reviews: not a parent, whatever its type.
        landmark = _raw("landmark", "historical_landmark", 200_000)
        ids, _ = _run([landmark], [_parent(300_000)])
        assert ids == ["landmark"]

    def test_park_parent_never_takes_the_waiver(self) -> None:
        # A 60k monument inside a 240k park: 4x, no waiver for park parents.
        monument = _raw("monument", "monument", 60_000)
        park = _parent(
            240_000,
            place_id="park",
            primary_type="park",
            types=["park", "tourist_attraction"],
        )
        ids, _ = _run([monument], [park])
        assert ids == ["monument"]

    def test_park_parent_still_absorbs_a_minor_statue(self) -> None:
        statue = _raw("statue", "sculpture", 27)
        park = _parent(
            119_618,
            place_id="tuileries",
            primary_type="garden",
            types=["garden", "tourist_attraction"],
        )
        ids, _ = _run([statue], [park])
        assert ids == ["tuileries", "statue"]

    def test_waiver_does_not_apply_outside_the_viewport(self) -> None:
        mona = _raw("mona-lisa", "tourist_attraction", 60_000)
        ids, _ = _run([mona], [_parent(north_m=180, inside=False)])
        assert ids == ["mona-lisa"]

    def test_parent_beyond_250m_and_outside_viewport(self) -> None:
        ids, reason = _run(_galleries(), [_parent(north_m=300, inside=False)])
        assert ids == ["gallery-a", "gallery-b", "gallery-c"]
        assert reason == "no_qualifying_parent"

    def test_parent_below_minimum_reviews(self) -> None:
        ids, _ = _run(_galleries(), [_parent(1_500)])
        assert ids[0] == "gallery-a"

    def test_small_town_church_with_300_review_parent(self) -> None:
        square = _raw("square", "historical_landmark", 60, north_m=9)
        church = _parent(300, place_id="church", primary_type="church")
        ids, _ = _run([square], [church])
        assert ids == ["square"]

    def test_bridge_is_not_a_parent(self) -> None:
        bridge = _parent(
            17_699,
            place_id="bridge",
            primary_type="bridge",
            types=["bridge", "tourist_attraction"],
        )
        ids, _ = _run(_galleries(), [bridge])
        assert ids[0] == "gallery-a"

    def test_strong_name_match_lock(self) -> None:
        ids, reason = _run(_galleries(), [_parent()], name_match_locked=True)
        assert ids == ["gallery-a", "gallery-b", "gallery-c"]
        assert reason == "name_match_locked"

    def test_unrated_top_finalist(self) -> None:
        # Enrichment unavailable: no count to measure dominance against.
        ids, reason = _run([_raw("gallery", "art_gallery", None)], [_parent()])
        assert ids == ["gallery"]
        assert reason == "finalist_unrated"

    def test_non_rollable_finalist_type(self) -> None:
        theater = _raw("theater", "performing_arts_theater", 900)
        ids, reason = _run([theater], [_parent()])
        assert ids == ["theater"]
        assert reason == "finalist_not_sub_poi"

    def test_no_probe_places(self) -> None:
        ids, reason = _run(_galleries(), [])
        assert ids == ["gallery-a", "gallery-b", "gallery-c"]
        assert reason == "no_probe_places"

    def test_no_op_values_give_identical_output(self) -> None:
        finalists = [_suggest(p) for p in _galleries()]
        before = json.dumps(finalists, sort_keys=True)
        places, decision = apply_venue_rollup(
            finalists,
            [_parent()],
            centroid={"latitude": LAT, "longitude": LNG},
            place_facts={p["id"]: p for p in _galleries()},
            thresholds=OFF,
        )
        assert json.dumps(places, sort_keys=True) == before
        assert json.dumps(finalists, sort_keys=True) == before
        assert decision.reason == "disabled"


# ---------------------------------------------------------------------------
# Settings reader
# ---------------------------------------------------------------------------


class TestRollupThresholds:
    def test_reads_settings(self) -> None:
        settings = MagicMock()
        settings.places_rollup_max_distance_m = 100
        settings.places_rollup_min_parent_reviews = 5000
        settings.places_rollup_dominance_ratio = 20.0
        assert rollup_thresholds(settings) == RollupThresholds(100, 5000, 20.0)

    def test_mock_or_wrong_typed_values_fall_back_to_defaults(self) -> None:
        settings = MagicMock()
        settings.places_rollup_min_parent_reviews = True  # bool is not an int here
        assert rollup_thresholds(settings) == DEFAULTS

    def test_zero_min_parent_reviews_disables(self) -> None:
        assert not OFF.enabled
        assert DEFAULTS.enabled
