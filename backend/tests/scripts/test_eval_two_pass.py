"""Tests for the two-pass eval simulation (scripts/eval_two_pass.py, KTD5/U5).

The two-pass mode must reproduce production's rating-blind first pass, so a
place that only wins on ratings is lost when it is not a distance finalist.
The venue probe's ``probe_places`` are read only by the roll-up call site,
which runs the production KTD4 roll-up (U7), and only when production's own
trigger (``should_probe_venue``) fires for the row.

``PRE_ROLLUP_FAILURES`` is the red set on ``main`` (before U7): the
Louvre-interior rows and the hand-shaped no-hint café row. U7 emptied
``KNOWN_TWO_PASS_FAILURES``; keep it pinned exactly, never loosen the equality.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

import scripts.eval_two_pass as two_pass
from app.services.place_matcher import PlaceMatcher
from app.services.place_matcher._venue_probe import should_probe_venue
from scripts.eval_place_matcher import (
    current_weights,
    evaluate,
    load_dataset,
    select_vision_for_sample,
)
from scripts.eval_two_pass import (
    evaluate_two_pass,
    parse_scene_hints,
    parse_sign_text,
    rank_two_pass,
)

SAMPLE_DATASET = "docs/place_matcher_eval_dataset.sample.json"
LOUVRE = "ChIJD3uTd9hx5kcR1IQvGfr8dbk"

KNOWN_TWO_PASS_FAILURES: set[str] = set()
PRE_ROLLUP_FAILURES = {
    "paris-louvre-mona-lisa-room-real",
    "paris-louvre-pyramid-real",
    "paris-louvre-winged-victory-real",
    "paris-louvre-winged-victory-cafe-sign",
    "paris-louvre-venus-de-milo-real",
    "hand-museum-interior-no-vision",
    "hand-cafe-in-landmark-no-hints",
}
CAFE_MARLY = "ChIJw4rTzyVu5kcRabdrxQ12FOk"
LOUVRE_INTERIOR_ROWS = {
    "paris-louvre-mona-lisa-room-real",
    "paris-louvre-pyramid-real",
    "paris-louvre-winged-victory-real",
    "paris-louvre-winged-victory-cafe-sign",
    "paris-louvre-venus-de-milo-real",
    "hand-museum-interior-no-vision",
}


def make_matcher() -> PlaceMatcher:
    return PlaceMatcher(http_client=AsyncMock())


def _vision(sample: dict[str, Any]):
    return select_vision_for_sample(sample, "aggregate")


def _place(
    place_id: str, north_m: float, types: list[str], rating: float, count: int
) -> dict[str, Any]:
    return {
        "id": place_id,
        "displayName": {"text": place_id.replace("-", " ").title()},
        "formattedAddress": f"{place_id} address",
        "location": {"latitude": north_m / 111_320.0, "longitude": 0.0},
        "primaryType": types[0],
        "types": types,
        "rating": rating,
        "userRatingCount": count,
    }


def _row(places: list[dict[str, Any]], expected: str, **extra: Any) -> dict:
    return {
        "id": "synthetic",
        "cluster": {"centroid": {"latitude": 0.0, "longitude": 0.0}},
        "expected_place_id": expected,
        "vision_results": [],
        "places": places,
        **extra,
    }


CAFE = ["cafe", "food"]


class TestRatingBlindFirstPass:
    """The correct place is 4th by distance but first by ratings."""

    def _sample(self) -> dict:
        return _row(
            [
                _place("near-a", 5, CAFE, 4.0, 40),
                _place("near-b", 10, CAFE, 4.0, 40),
                _place("near-c", 15, CAFE, 4.0, 40),
                _place("famous-d", 30, CAFE, 4.8, 90_000),
            ],
            expected="famous-d",
        )

    def test_legacy_single_pass_sees_ratings_and_wins(self) -> None:
        matcher = make_matcher()
        metrics = evaluate(
            matcher, [self._sample()], current_weights(matcher), "aggregate"
        )
        assert metrics.top1 == 1.0

    def test_two_pass_is_rating_blind_and_loses_it(self) -> None:
        ranked = rank_two_pass(make_matcher(), self._sample(), None)
        ids = [p["place_id"] for p in ranked]
        assert ids[0] != "famous-d"
        assert "famous-d" not in ids
        metrics = evaluate_two_pass(make_matcher(), [self._sample()], _vision)
        assert metrics.top1 == 0.0
        assert metrics.top1_failures == ["synthetic"]


class TestBackfill:
    def test_gate_dropped_finalist_is_backfilled_from_tail(self) -> None:
        # near-c has 0 reviews: it is a rating-blind finalist, then the review
        # gate drops it after enrichment, and the 4th place backfills.
        sample = _row(
            [
                _place("near-a", 5, CAFE, 4.0, 40),
                _place("near-b", 10, CAFE, 4.0, 40),
                _place("near-c", 15, CAFE, 0, 0),
                _place("tail-d", 30, CAFE, 4.5, 500),
            ],
            expected="near-a",
        )
        ids = [p["place_id"] for p in rank_two_pass(make_matcher(), sample, None)]
        assert "near-c" not in ids
        assert ids[-1] == "tail-d"
        assert len(ids) == 3


class TestProbeIsolation:
    def _sample(self, **extra: Any) -> dict:
        return _row(
            [
                _place("exhibit-a", 5, ["tourist_attraction"], 4.5, 60),
                _place("exhibit-b", 12, ["art_gallery"], 4.5, 60),
            ],
            expected="parent",
            **extra,
        )

    def test_probe_places_never_enter_ranking(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # With the roll-up call site neutralized, probe places change nothing:
        # they never join the first pass, the re-rank or the backfill.
        monkeypatch.setattr(
            two_pass, "simulate_venue_rollup", lambda _m, suggestions, _c: suggestions
        )
        parent = _place("parent", 150, ["museum"], 4.7, 300_000)
        without = rank_two_pass(make_matcher(), self._sample(), None)
        with_probe = rank_two_pass(
            make_matcher(), self._sample(probe_places=[parent]), None
        )
        assert with_probe == without
        assert "parent" not in {p["place_id"] for p in with_probe}

    def test_rollup_promotes_the_probe_parent(self) -> None:
        parent = _place("parent", 150, ["museum"], 4.7, 300_000)
        ranked = rank_two_pass(
            make_matcher(), self._sample(probe_places=[parent]), None
        )
        assert [p["place_id"] for p in ranked] == ["parent", "exhibit-a", "exhibit-b"]

    def test_rollup_ignores_probe_places_when_the_trigger_would_not_fire(
        self,
    ) -> None:
        # Mirrors production: a cluster whose candidates carry no
        # museum/landmark/attraction type (and no museum hint) is never probed.
        sample = _row(
            [_place("cafe-a", 5, CAFE, 4.5, 900), _place("cafe-b", 12, CAFE, 4.5, 80)],
            expected="cafe-a",
            probe_places=[_place("parent", 150, ["museum"], 4.7, 300_000)],
        )
        ids = [p["place_id"] for p in rank_two_pass(make_matcher(), sample, None)]
        assert ids[0] == "cafe-a"
        assert "parent" not in ids

    def test_rollup_hook_is_the_only_probe_reader(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: list[two_pass.RollupContext] = []

        def spy(matcher, suggestions, context):
            seen.append(context)
            return suggestions

        monkeypatch.setattr(two_pass, "simulate_venue_rollup", spy)
        parent = _place("parent", 150, ["museum"], 4.7, 300_000)
        rank_two_pass(
            make_matcher(),
            self._sample(
                probe_places=[parent],
                scene_hints=[{"label": "museum_interior", "weight": 0.8}],
                sign_text=["Salle des États"],
            ),
            None,
        )
        assert len(seen) == 1
        ctx = seen[0]
        assert [p["id"] for p in ctx.probe_places] == ["parent"]
        assert ctx.scene_hints == [{"label": "museum_interior", "weight": 0.8}]
        assert ctx.sign_text == ["Salle des États"]
        assert ctx.name_match_locked is False


class TestHintFields:
    def test_absent_fields_parse_empty(self) -> None:
        assert parse_scene_hints(None) == []
        assert parse_sign_text(None) == []

    @pytest.mark.parametrize(
        "raw",
        [
            [{"label": "beach", "weight": 0.5}],
            [{"label": "food", "weight": 1.5}],
            "food",
        ],
    )
    def test_invalid_scene_hints_rejected(self, raw: Any) -> None:
        with pytest.raises(ValueError):
            parse_scene_hints(raw)

    def test_sign_text_capped_at_five(self) -> None:
        with pytest.raises(ValueError):
            parse_sign_text(["a", "b", "c", "d", "e", "f"])

    def test_dataset_hint_fields_are_valid(self) -> None:
        for sample in load_dataset(SAMPLE_DATASET):
            parse_scene_hints(sample.get("scene_hints"))
            parse_sign_text(sample.get("sign_text"))


class TestSampleDatasetTwoPass:
    def test_known_failing_set_is_exact(self) -> None:
        metrics = evaluate_two_pass(
            make_matcher(), load_dataset(SAMPLE_DATASET), _vision
        )
        assert set(metrics.top1_failures) == KNOWN_TWO_PASS_FAILURES
        assert metrics.top3_constraint_failures == []

    def test_every_other_row_keeps_top1(self) -> None:
        samples = [
            s
            for s in load_dataset(SAMPLE_DATASET)
            if s["id"] not in KNOWN_TWO_PASS_FAILURES
        ]
        metrics = evaluate_two_pass(make_matcher(), samples, _vision)
        assert metrics.top1 == 1.0
        assert metrics.total == len(samples)

    def test_without_the_rollup_the_pre_u7_rows_fail(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The red half of the U5/U7 pair: with the roll-up call site turned
        # back into a no-op, exactly the pre-U7 red set fails again.
        monkeypatch.setattr(
            two_pass, "simulate_venue_rollup", lambda _m, suggestions, _c: suggestions
        )
        metrics = evaluate_two_pass(
            make_matcher(), load_dataset(SAMPLE_DATASET), _vision
        )
        assert set(metrics.top1_failures) == PRE_ROLLUP_FAILURES

    def test_louvre_interior_rows_roll_up_to_the_parent(self) -> None:
        rows = [
            s for s in load_dataset(SAMPLE_DATASET) if s["id"] in LOUVRE_INTERIOR_ROWS
        ]
        assert {s["id"] for s in rows} == LOUVRE_INTERIOR_ROWS
        for sample in rows:
            ranked = rank_two_pass(make_matcher(), sample, _vision(sample))
            assert ranked[0]["place_id"] == sample["expected_place_id"]
            ids = [p["place_id"] for p in ranked]
            assert len(ids) == len(set(ids)) <= 3

    def test_unprobed_cafe_row_keeps_the_cafe_first(self) -> None:
        # User decision 2026-09-27: a café cluster whose candidates carry no
        # museum/landmark/attraction type and no museum hint is never probed,
        # so the roll-up cannot see the Louvre and the café stays first.
        (row,) = [
            s
            for s in load_dataset(SAMPLE_DATASET)
            if s["id"] == "paris-cafe-marly-no-hints-real"
        ]
        assert not should_probe_venue(row["places"], row.get("scene_hints"))
        ranked = rank_two_pass(make_matcher(), row, _vision(row))
        assert ranked[0]["place_id"] == CAFE_MARLY
        assert LOUVRE not in {p["place_id"] for p in ranked}

    def test_probed_cafe_row_without_evidence_keeps_the_cafe_in_top3(self) -> None:
        (row,) = [
            s
            for s in load_dataset(SAMPLE_DATASET)
            if s["id"] == "hand-cafe-in-landmark-no-hints"
        ]
        assert should_probe_venue(row["places"], row.get("scene_hints"))
        ids = [p["place_id"] for p in rank_two_pass(make_matcher(), row, _vision(row))]
        assert ids[0] == row["expected_place_id"]
        assert ids[1] == "place-hand-cafe-arcade"

    def test_real_louvre_rows_carry_the_live_parent_in_probe(self) -> None:
        # U4 evidence: the POPULARITY probe returned the Louvre at every
        # captured interior point, rated, with a viewport.
        for sample in load_dataset(SAMPLE_DATASET):
            if sample["expected_place_id"] != LOUVRE:
                continue
            probe = {p["id"]: p for p in sample["probe_places"]}
            assert LOUVRE in probe
            assert probe[LOUVRE]["userRatingCount"] > 300_000
            assert "viewport" in probe[LOUVRE]
