"""containingPlaces tie-breaker for the venue roll-up (venue-rollup plan U8).

U4's live capture showed Google's ``containingPlaces`` names the Louvre for its
exhibits (Mona Lisa, the Islamic Arts and Greek Antiquities departments) and
returns nothing for the Pyramid or Le Cafe Marly. So it is a tie-breaker, not a
detector (KTD9): when the TOP finalist's containing place is a probe parent,
containment and sub-POI-likeness hold outright and the dominance ratio is
waived; every other KTD4 guard still applies. A different containing place, or
no field at all, leaves the U7 rule exactly as it was.

The field is fetched for the top finalist only, and only when it could change
the outcome: the cluster has probe results and KTD4 did not roll up for a
reason the tie-breaker can overturn.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.services.place_matcher import DensityLevel, PlaceMatcher
from app.services.place_matcher import _containing_places as cp_module
from app.services.place_matcher.venue_rollup import (
    RollupThresholds,
    apply_venue_rollup,
    containment_fetch_target,
)
from tests.services.test_venue_rollup import (
    DEFAULTS,
    LAT,
    LNG,
    _cafe,
    _galleries,
    _parent,
    _raw,
    _suggest,
    _viewport,
)
from tests.services.test_venue_rollup_flow import _INTERIOR_RATINGS, _interior_world
from tests.services.venue_probe_support import (
    _cluster,
    _louvre,
    _place,
    _wire_flow,
    make_settings,
)

CENTROID = {"latitude": LAT, "longitude": LNG}


def _rollup(
    finalists: list[dict[str, Any]],
    probe: list[dict[str, Any]],
    *,
    thresholds: RollupThresholds = DEFAULTS,
    **kwargs: Any,
) -> tuple[list[str], Any]:
    places, decision = apply_venue_rollup(
        [_suggest(p) for p in finalists],
        probe,
        centroid=CENTROID,
        place_facts={p["id"]: p for p in finalists},
        thresholds=thresholds,
        **kwargs,
    )
    return [p["place_id"] for p in places], decision


def _far_parent() -> dict[str, Any]:
    # The west-wing case: outside the parent's viewport and past 250m.
    return _parent(378_404, north_m=400, inside=False)


def _exhibit(count: int = 45) -> dict[str, Any]:
    return _raw("exhibit", "sculpture", count, north_m=5)


# ---------------------------------------------------------------------------
# The rule (pure)
# ---------------------------------------------------------------------------


class TestTieBreaker:
    def test_names_parent_rolls_up_outside_containment(self) -> None:
        ids, decision = _rollup([_exhibit()], [_far_parent()])
        assert (ids, decision.reason) == (["exhibit"], "no_qualifying_parent")

        ids, decision = _rollup(
            [_exhibit()], [_far_parent()], containing_place_ids=("parent",)
        )
        assert ids == ["parent", "exhibit"]
        assert decision.reason == "rolled_up"
        assert decision.as_trace()["containing_places"] is True

    def test_names_parent_rolls_up_when_ratio_not_met(self) -> None:
        # 300k vs 200k = 1.5x: under both the 10x ratio and the 2x waiver floor.
        big = _raw("big-attraction", "tourist_attraction", 200_000, north_m=5)
        ids, decision = _rollup([big], [_parent()])
        assert (ids, decision.reason) == (["big-attraction"], "no_qualifying_parent")

        ids, _ = _rollup([big], [_parent()], containing_place_ids=("parent",))
        assert ids == ["parent", "big-attraction"]

    def test_names_parent_makes_untyped_finalist_sub_poi(self) -> None:
        plain = _raw("plain", None, 30, types=["point_of_interest", "establishment"])
        ids, decision = _rollup([plain], [_parent()])
        assert decision.reason == "finalist_not_sub_poi"
        ids, _ = _rollup([plain], [_parent()], containing_place_ids=("parent",))
        assert ids == ["parent", "plain"]

    @pytest.mark.parametrize(
        "finalists, probe",
        [
            ([_exhibit()], [_far_parent()]),  # KTD4 fails
            (_galleries(), [_parent()]),  # KTD4 rolls up
            ([_raw("plain", None, 30, types=["point_of_interest"])], [_parent()]),
        ],
    )
    def test_names_different_place_falls_back_to_ktd4(self, finalists, probe) -> None:
        expected = _rollup(finalists, probe)
        got = _rollup(finalists, probe, containing_place_ids=("somewhere-else",))
        assert got[0] == expected[0]
        assert got[1].reason == expected[1].reason
        assert "containing_places" not in got[1].as_trace()

    @pytest.mark.parametrize("absent", [None, ()])
    @pytest.mark.parametrize(
        "finalists, probe",
        [
            ([_exhibit()], [_far_parent()]),
            (_galleries(), [_parent()]),
            ([_cafe()], [_parent()]),
            ([_raw("church", "church", 900, north_m=4)], [_parent()]),
        ],
    )
    def test_field_absent_is_identical_to_u7(self, finalists, probe, absent) -> None:
        u7 = _rollup(finalists, probe)
        got = _rollup(finalists, probe, containing_place_ids=absent)
        assert got[0] == u7[0]
        assert got[1].as_trace() == u7[1].as_trace()

    def test_other_guards_still_apply(self) -> None:
        names = {"containing_place_ids": ("parent",)}
        # Evidence for a food finalist keeps it first (R6).
        ids, d = _rollup([_cafe()], [_parent()], scene_hints=["food"], **names)
        assert (ids[0], d.reason) == ("cafe", "finalist_has_evidence")
        # Never-rollable types.
        church = _raw("church", "church", 900, north_m=4)
        assert _rollup([church], [_parent()], **names)[0] == ["church"]
        # A distinct institution keeps its place.
        museum = _raw("decos", "museum", 10_083, north_m=5)
        _, d = _rollup([museum], [_parent()], **names)
        assert d.reason == "distinct_institution"
        # The name-match lock.
        _, d = _rollup([_exhibit()], [_parent()], name_match_locked=True, **names)
        assert d.reason == "name_match_locked"
        # The parent still needs min_parent_reviews.
        _, d = _rollup([_exhibit()], [_parent(1_500)], **names)
        assert not d.rolled_up

    def test_a_less_reviewed_container_never_absorbs_its_landmark(self) -> None:
        # Eiffel Tower (495k) contained by Champ de Mars (225k) stays first.
        tower = _raw("eiffel", "historical_landmark", 495_424, viewport=_viewport())
        champ = _parent(225_645, place_id="champ", primary_type="park", north_m=300)
        ids, _ = _rollup([tower], [tower, champ], containing_place_ids=("champ",))
        assert ids == ["eiffel"]


class TestFetchTarget:
    def _target(self, finalists, probe, **kwargs) -> str | None:
        suggestions = [_suggest(p) for p in finalists]
        facts = {p["id"]: p for p in finalists}
        _, decision = apply_venue_rollup(
            suggestions,
            probe,
            centroid=CENTROID,
            place_facts=facts,
            thresholds=DEFAULTS,
            **kwargs,
        )
        return containment_fetch_target(
            suggestions,
            probe,
            decision,
            place_facts=facts,
            thresholds=DEFAULTS,
        )

    def test_fetches_top_finalist_when_it_could_overturn(self) -> None:
        assert self._target([_exhibit(), _cafe()], [_far_parent()]) == "exhibit"

    def test_no_fetch_when_it_cannot_change_the_outcome(self) -> None:
        assert self._target(_galleries(), [_parent()]) is None  # rolled up
        assert self._target([_exhibit()], []) is None  # no probe results
        assert self._target([_cafe()], [_parent()], scene_hints=["food"]) is None
        church = _raw("church", "church", 900, north_m=4)
        assert self._target([church], [_parent()]) is None
        assert self._target([_exhibit()], [_parent(1_500)]) is None  # not major
        tower = _raw("eiffel", "historical_landmark", 495_424)
        assert self._target([tower], [_parent(225_645)]) is None  # outranks it


# ---------------------------------------------------------------------------
# The fetch: L2 cache hit condition, refetch-once, degradation
# ---------------------------------------------------------------------------


def _details_response(status: int, body: dict[str, Any]) -> MagicMock:
    response = MagicMock()
    response.status_code = status
    response.json.return_value = body
    return response


@pytest.fixture
def details_store(monkeypatch) -> dict[str, dict[str, Any]]:
    store: dict[str, dict[str, Any]] = {}

    async def get(place_id: str) -> dict | None:
        return store.get(place_id)

    async def set_(place_id: str, details: dict[str, Any]) -> None:
        store[place_id] = {**store.get(place_id, {}), **details}

    monkeypatch.setattr(cp_module, "get_place_details_cache", get)
    monkeypatch.setattr(cp_module, "set_place_details_cache", set_)
    return store


@pytest.fixture
def matcher(monkeypatch) -> PlaceMatcher:
    make_settings(monkeypatch)
    return PlaceMatcher(http_client=AsyncMock())


class TestFetch:
    @pytest.mark.asyncio
    async def test_old_row_refetches_once_then_serves_from_cache(
        self, matcher, details_store
    ) -> None:
        details_store["mona"] = {"rating": 4.1, "userRatingCount": 412}
        matcher._client.get = AsyncMock(
            return_value=_details_response(
                200,
                {"id": "mona", "containingPlaces": [{"id": "louvre"}]},
            )
        )

        first = await matcher._fetch_containing_places(["mona"])
        second = await matcher._fetch_containing_places(["mona"])

        assert first == second == {"mona": ("louvre",)}
        assert matcher._client.get.await_count == 1
        headers = matcher._client.get.await_args.kwargs["headers"]
        assert headers["X-Goog-FieldMask"] == "id,containingPlaces"
        # Merged onto the rating row, not replacing it.
        assert details_store["mona"]["userRatingCount"] == 412

    @pytest.mark.asyncio
    async def test_absent_field_is_cached_as_empty(
        self, matcher, details_store
    ) -> None:
        matcher._client.get = AsyncMock(
            return_value=_details_response(200, {"id": "pyramid"})
        )
        assert await matcher._fetch_containing_places(["pyramid"]) == {"pyramid": ()}
        assert await matcher._fetch_containing_places(["pyramid"]) == {"pyramid": ()}
        assert matcher._client.get.await_count == 1
        assert details_store["pyramid"] == {"containingPlaces": []}

    @pytest.mark.asyncio
    async def test_name_only_entries_are_parsed(self, matcher, details_store) -> None:
        matcher._client.get = AsyncMock(
            return_value=_details_response(
                200, {"containingPlaces": [{"name": "places/louvre"}]}
            )
        )
        assert await matcher._fetch_containing_places(["x"]) == {"x": ("louvre",)}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "outcome",
        [
            _details_response(500, {}),
            httpx.ConnectError("down"),
            RuntimeError("boom"),
        ],
    )
    async def test_failure_degrades_to_nothing_and_is_not_cached(
        self, matcher, details_store, outcome
    ) -> None:
        if isinstance(outcome, BaseException):
            matcher._client.get = AsyncMock(side_effect=outcome)
        else:
            matcher._client.get = AsyncMock(return_value=outcome)
        assert await matcher._fetch_containing_places(["mona"]) == {}
        assert "mona" not in details_store


# ---------------------------------------------------------------------------
# Orchestration: when the fetch fires, and what it changes
# ---------------------------------------------------------------------------

WEST_WING = {"lat": 48.8606, "lng": 2.3330}  # outside the Louvre viewport, ~340m


def _west_wing_world() -> list[dict[str, Any]]:
    at = {"lat": WEST_WING["lat"], "lng": WEST_WING["lng"]}
    return [
        _place("victoire", "Victoire de Samothrace", "sculpture", **at),
        _place("dept", "Departement des Peintures", "museum", **at),
    ]


_WEST_RATINGS = {
    "victoire": {"rating": 4.8, "userRatingCount": 45},
    "dept": {"rating": 4.6, "userRatingCount": 150},
}


def _wire(monkeypatch, world, probe, ratings, fetch_result=None, fetch_error=None):
    settings = make_settings(monkeypatch)
    settings.places_rollup_containing_places = True
    matcher = PlaceMatcher(http_client=AsyncMock())
    _wire_flow(matcher, monkeypatch, world, DensityLevel.SPARSE, probe, ratings)
    calls: list[list[str]] = []

    async def fetch(place_ids, **_kwargs):
        calls.append(list(place_ids))
        if fetch_error is not None:
            raise fetch_error
        return dict(fetch_result or {})

    monkeypatch.setattr(matcher, "_fetch_containing_places", fetch)
    return matcher, settings, calls


def _west_cluster() -> dict[str, Any]:
    return _cluster("west", lat=WEST_WING["lat"], lng=WEST_WING["lng"])


class TestOrchestration:
    @pytest.mark.asyncio
    async def test_containing_louvre_rolls_up_west_wing_exhibit(
        self, monkeypatch
    ) -> None:
        matcher, _, calls = _wire(
            monkeypatch,
            _west_wing_world(),
            [_louvre()],
            _WEST_RATINGS,
            fetch_result={"dept": ("louvre",)},
        )
        results, failed = await matcher.find_places_for_clusters([_west_cluster()])
        assert failed == 0
        assert calls == [["dept"]]  # the top finalist only
        assert [p["place_id"] for p in results[0]["places"]][:2] == [
            "louvre",
            "dept",
        ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "fetch_result, fetch_error",
        [({}, None), ({"dept": ("other",)}, None), (None, RuntimeError("x"))],
    )
    async def test_empty_different_or_failed_fetch_keeps_u7(
        self, monkeypatch, fetch_result, fetch_error
    ) -> None:
        matcher, _, calls = _wire(
            monkeypatch,
            _west_wing_world(),
            [_louvre()],
            _WEST_RATINGS,
            fetch_result=fetch_result,
            fetch_error=fetch_error,
        )
        results, failed = await matcher.find_places_for_clusters([_west_cluster()])
        assert failed == 0
        assert calls == [["dept"]]
        assert results[0]["places"][0]["place_id"] == "dept"
        assert "louvre" not in {p["place_id"] for p in results[0]["places"]}

    @pytest.mark.asyncio
    async def test_no_fetch_when_ktd4_already_rolled_up(self, monkeypatch) -> None:
        matcher, _, calls = _wire(
            monkeypatch, _interior_world(), [_louvre()], _INTERIOR_RATINGS
        )
        results, _ = await matcher.find_places_for_clusters([_cluster()])
        assert results[0]["places"][0]["place_id"] == "louvre"
        assert calls == []

    @pytest.mark.asyncio
    async def test_no_fetch_without_probe_results(self, monkeypatch) -> None:
        matcher, _, calls = _wire(monkeypatch, _west_wing_world(), [], _WEST_RATINGS)
        await matcher.find_places_for_clusters([_west_cluster()])
        assert calls == []

    @pytest.mark.asyncio
    async def test_no_fetch_when_switched_off(self, monkeypatch) -> None:
        matcher, settings, calls = _wire(
            monkeypatch, _west_wing_world(), [_louvre()], _WEST_RATINGS
        )
        settings.places_rollup_containing_places = False
        results, _ = await matcher.find_places_for_clusters([_west_cluster()])
        assert calls == []
        assert results[0]["places"][0]["place_id"] == "dept"


class TestEvalTwoPass:
    """The --two-pass eval runs the same tie-breaker off a row field."""

    def _row(self, **exhibit_extra: Any) -> dict[str, Any]:
        def place(pid, north_m, types, count, **extra):
            return {
                "id": pid,
                "displayName": {"text": pid},
                "formattedAddress": pid,
                "location": {"latitude": north_m / 111_320.0, "longitude": 0.0},
                "primaryType": types[0],
                "types": types,
                "rating": 4.6,
                "userRatingCount": count,
                **extra,
            }

        return {
            "id": "west-wing",
            "cluster": {"centroid": {"latitude": 0.0, "longitude": 0.0}},
            "expected_place_id": "parent",
            "vision_results": [],
            "places": [
                place("exhibit", 5, ["tourist_attraction"], 60, **exhibit_extra),
                place("gallery", 12, ["art_gallery"], 40),
            ],
            # 400m away, no viewport: KTD4 cannot contain it.
            "probe_places": [place("parent", 400, ["museum"], 300_000)],
        }

    def test_row_containing_places_drives_the_rollup(self) -> None:
        from scripts.eval_two_pass import rank_two_pass

        matcher = PlaceMatcher(http_client=AsyncMock())

        def top(row: dict[str, Any]) -> str:
            return rank_two_pass(matcher, row, None)[0]["place_id"]

        assert top(self._row()) == "exhibit"
        assert top(self._row(containingPlaces=[{"id": "parent"}])) == "parent"
        assert top(self._row(containingPlaces=[{"id": "elsewhere"}])) == "exhibit"
