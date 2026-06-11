"""Tests for the place-matcher eval harness (scripts/eval_place_matcher.py).

Covers U5 of the photo-match-quality remediation plan:

- The ``--stop-threshold`` override must drive ``matcher._settings`` (U2 made
  ``_search_nearby_tiered`` read the Settings value, so the old module-global
  override is a silent no-op). The threshold-override test pins that the
  override actually moves ``candidate_recall``/``avg_nearby_calls``.
- ``--simulate-type-filter`` (C5): filters Nearby RESULTS by the
  ``SEARCHABLE_PLACE_TYPES`` allowlist without changing call cost.
- ``--simulate-text-rescue`` (C2): a name-match rescue against the world for
  places that sit outside every search radius (Nearby genuinely misses them).
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from app.services.place_matcher import PlaceMatcher
from app.services.place_matcher.constants import SEARCHABLE_PLACE_TYPES
from scripts.eval_place_matcher import (
    PipelineMetrics,
    evaluate_pipeline,
    load_dataset,
)

SAMPLE_DATASET = "docs/place_matcher_eval_dataset.sample.json"


def make_matcher() -> PlaceMatcher:
    return PlaceMatcher(http_client=AsyncMock())


def _place(
    place_id: str,
    name: str,
    lat: float,
    lng: float,
    types: list[str],
    rating: float = 4.5,
    review_count: int = 200,
) -> dict:
    return {
        "id": place_id,
        "displayName": {"text": name},
        "formattedAddress": f"{name} address",
        "location": {"latitude": lat, "longitude": lng},
        "primaryType": types[0],
        "types": types,
        "rating": rating,
        "userRatingCount": review_count,
    }


# Coordinate helpers (at the equator, 1 deg latitude ~= 111_320 m).
def _lat_offset(meters: float) -> float:
    return meters / 111_320.0


# ---------------------------------------------------------------------------
# Threshold override (the feasibility fix — written FIRST, must fail pre-fix)
# ---------------------------------------------------------------------------


class TestStopThresholdOverride:
    """``--stop-threshold`` must target matcher._settings, not the inert global.

    A world with a near decoy (inside the 15m tier) and the expected place one
    tier out: with stop_threshold=1 the search stops at the first quality hit
    and misses the expected place; with the default threshold (5) it keeps
    expanding and recalls it. If the override is a no-op, both runs read the
    Settings default and recall/calls do not move.
    """

    def _sample(self) -> list[dict]:
        return [
            {
                "id": "threshold-row",
                "cluster": {
                    "centroid": {"latitude": 0.0, "longitude": 0.0},
                    "time_hint": "food",
                },
                "expected_place_id": "place-far",
                "vision_results": [],
                "places": [
                    _place(
                        "place-near-decoy",
                        "Near Decoy Cafe",
                        _lat_offset(10),
                        0.0,
                        ["cafe", "coffee_shop", "food"],
                    ),
                    _place(
                        "place-far",
                        "Far Trattoria",
                        _lat_offset(60),
                        0.0,
                        ["restaurant", "italian_restaurant", "food"],
                    ),
                ],
            }
        ]

    def test_threshold_one_misses_far_place(self) -> None:
        samples = self._sample()
        default_run = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="none",
            stop_threshold=None,
        )
        capped_run = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="none",
            stop_threshold=1,
        )

        # Default threshold (5) keeps expanding and recalls the far place.
        assert default_run.candidate_recall == 1.0
        # stop_threshold=1 stops at the near decoy and misses it.
        assert capped_run.candidate_recall == 0.0
        # And it makes strictly fewer paid Nearby calls (stopped early).
        assert capped_run.avg_nearby_calls < default_run.avg_nearby_calls

    def test_threshold_override_is_restored(self) -> None:
        matcher = make_matcher()
        original = matcher._settings.places_min_quality_results_before_stop
        evaluate_pipeline(
            matcher=matcher,
            samples=self._sample(),
            vision_mode="none",
            stop_threshold=1,
        )
        assert matcher._settings.places_min_quality_results_before_stop == original


# ---------------------------------------------------------------------------
# Type-filter sim (C5)
# ---------------------------------------------------------------------------


class TestSimulateTypeFilter:
    """--simulate-type-filter drops candidates whose types miss the allowlist."""

    def _excluded_type(self) -> str:
        # Pick a type that is NOT in SEARCHABLE_PLACE_TYPES.
        for candidate in ("gym", "school", "dentist", "hospital", "pharmacy"):
            if candidate not in SEARCHABLE_PLACE_TYPES:
                return candidate
        raise AssertionError("expected an excluded type")

    def _sample_with_types(self, expected_types: list[str]) -> list[dict]:
        return [
            {
                "id": "type-filter-row",
                "cluster": {
                    "centroid": {"latitude": 0.0, "longitude": 0.0},
                    "time_hint": "food",
                },
                "expected_place_id": "place-expected",
                "vision_results": [],
                "places": [
                    _place(
                        "place-expected",
                        "Expected Venue",
                        _lat_offset(8),
                        0.0,
                        expected_types,
                    ),
                ],
            }
        ]

    def test_excluded_type_drops_recall(self) -> None:
        excluded = [self._excluded_type()]
        samples = self._sample_with_types(excluded)

        baseline = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="none",
            stop_threshold=None,
        )
        filtered = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="none",
            stop_threshold=None,
            simulate_type_filter=True,
        )

        assert baseline.candidate_recall == 1.0
        # Type-filtering the allowlist removes the expected place from Nearby.
        assert filtered.candidate_recall == 0.0

    def test_allowed_type_recovers_recall(self) -> None:
        # Same row but the expected place now carries an allowlisted type.
        allowed = [SEARCHABLE_PLACE_TYPES[0], "food"]
        samples = self._sample_with_types(allowed)

        filtered = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="none",
            stop_threshold=None,
            simulate_type_filter=True,
        )
        assert filtered.candidate_recall == 1.0

    def test_type_filter_is_cost_invariant(self) -> None:
        # Filtering RESULTS must not change the number of paid Nearby CALLS.
        # An always-allowed place sits at the 15m density probe so DENSITY (which
        # keys off the raw first-radius count) is identical in both runs — without
        # it, filtering the lone probe result flips medium->sparse and the sparse
        # profile (C6: [50,100,250]) legitimately issues a different call count,
        # which is a density effect, not a cost-invariance violation.
        excluded = [self._excluded_type()]
        samples = self._sample_with_types(excluded)
        # Add an allowlisted place right at the centroid (within the 15m probe) so
        # both runs detect the same density.
        samples[0]["places"].append(
            _place(
                "place-probe-anchor",
                "Probe Anchor",
                _lat_offset(2),
                0.0,
                [SEARCHABLE_PLACE_TYPES[0], "food"],
            )
        )

        baseline = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="none",
            stop_threshold=None,
        )
        filtered = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="none",
            stop_threshold=None,
            simulate_type_filter=True,
        )
        assert filtered.avg_nearby_calls == baseline.avg_nearby_calls


# ---------------------------------------------------------------------------
# Text-rescue sim (C2)
# ---------------------------------------------------------------------------


class TestSimulateTextRescue:
    """--simulate-text-rescue recovers a place outside every search radius.

    The expected place sits ~400m out (beyond even the sparse 250m tier), so
    geometric Nearby never returns it. Its displayName matches the vision
    detected_text, so the name-match rescue can find it in the world.
    """

    def _far_sample(self) -> list[dict]:
        return [
            {
                "id": "text-rescue-row",
                "cluster": {
                    "centroid": {"latitude": 0.0, "longitude": 0.0},
                    "time_hint": "food",
                },
                "expected_place_id": "place-far-signage",
                "vision_results": [
                    {
                        "category": "food",
                        "detected_text": ["Hidden Izakaya"],
                        "confidence": "high",
                    }
                ],
                "places": [
                    # A near decoy so Nearby returns something (but not the
                    # expected place, which is far out of radius).
                    _place(
                        "place-near-noodle",
                        "Corner Noodle Bar",
                        _lat_offset(8),
                        0.0,
                        ["restaurant", "ramen_restaurant", "food"],
                    ),
                    _place(
                        "place-far-signage",
                        "Hidden Izakaya",
                        _lat_offset(400),
                        0.0,
                        ["restaurant", "bar", "food"],
                    ),
                ],
            }
        ]

    def test_without_rescue_far_place_is_missed(self) -> None:
        baseline = evaluate_pipeline(
            matcher=make_matcher(),
            samples=self._far_sample(),
            vision_mode="aggregate",
            stop_threshold=None,
        )
        assert baseline.candidate_recall == 0.0
        assert baseline.avg_text_search_calls is None

    def test_rescue_lifts_recall_and_counts_calls(self) -> None:
        rescued = evaluate_pipeline(
            matcher=make_matcher(),
            samples=self._far_sample(),
            vision_mode="aggregate",
            stop_threshold=None,
            simulate_text_rescue=True,
        )
        assert rescued.candidate_recall == 1.0
        assert rescued.avg_text_search_calls == 1.0

    def test_rescue_suppressed_when_nearby_already_has_name_match(self) -> None:
        # If Nearby already surfaces a name-matching place, the production
        # matcher suppresses the text search — the sim must mirror that.
        samples = [
            {
                "id": "already-found-row",
                "cluster": {
                    "centroid": {"latitude": 0.0, "longitude": 0.0},
                    "time_hint": "food",
                },
                "expected_place_id": "place-near-izakaya",
                "vision_results": [
                    {
                        "category": "food",
                        "detected_text": ["Hidden Izakaya"],
                        "confidence": "high",
                    }
                ],
                "places": [
                    _place(
                        "place-near-izakaya",
                        "Hidden Izakaya",
                        _lat_offset(8),
                        0.0,
                        ["restaurant", "bar", "food"],
                    ),
                ],
            }
        ]
        rescued = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
            simulate_text_rescue=True,
        )
        # Nearby already has it -> no text-search call fired.
        assert rescued.candidate_recall == 1.0
        assert rescued.avg_text_search_calls == 0.0


# ---------------------------------------------------------------------------
# Combined flags + no-regression
# ---------------------------------------------------------------------------


class TestPipelineRegressionAndComposition:
    def test_sample_dataset_baseline_shape(self) -> None:
        # Happy path: with no sim flags the metrics carry the legacy shape and
        # avg_text_search_calls stays None (existing runs unaffected). The
        # baseline recall is < 1.0 because the C2 row sits beyond every search
        # radius on purpose; the text-rescue sim is what recovers it.
        samples = load_dataset(SAMPLE_DATASET)
        metrics = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
        )
        assert isinstance(metrics, PipelineMetrics)
        assert metrics.avg_text_search_calls is None
        # The C2 far row is the only sample Nearby cannot reach geometrically.
        assert metrics.candidate_recall < 1.0

    def test_sample_dataset_text_rescue_lifts_to_full_recall(self) -> None:
        # The C2 row in the sample dataset is recovered by the rescue sim,
        # lifting recall to 1.0 and counting exactly one text-search call.
        samples = load_dataset(SAMPLE_DATASET)
        baseline = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
        )
        rescued = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
            simulate_text_rescue=True,
        )
        assert rescued.candidate_recall > baseline.candidate_recall
        assert rescued.candidate_recall == 1.0
        assert rescued.avg_text_search_calls is not None
        # Exactly one rescue call across the dataset.
        assert rescued.avg_text_search_calls * rescued.total == 1.0

    def test_sample_dataset_type_filter_drops_recall(self) -> None:
        # The C5 row's gym type is excluded by the allowlist, so type-filter
        # drops recall below baseline while leaving call cost unchanged.
        samples = load_dataset(SAMPLE_DATASET)
        baseline = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
        )
        filtered = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
            simulate_type_filter=True,
        )
        assert filtered.candidate_recall < baseline.candidate_recall
        assert filtered.avg_nearby_calls == baseline.avg_nearby_calls

    def test_both_sims_additive_not_double_counted(self) -> None:
        # Type-filter excludes the near decoy's nothing here; the far place is
        # rescued by text search. Both flags together: recall recovers via
        # rescue, type-filter leaves call cost untouched, rescue counts once.
        samples = [
            {
                "id": "combined-row",
                "cluster": {
                    "centroid": {"latitude": 0.0, "longitude": 0.0},
                    "time_hint": "food",
                },
                "expected_place_id": "place-far-combined",
                "vision_results": [
                    {
                        "category": "food",
                        "detected_text": ["Lantern House"],
                        "confidence": "high",
                    }
                ],
                "places": [
                    _place(
                        "place-near-allowed",
                        "Allowed Cafe",
                        _lat_offset(8),
                        0.0,
                        ["cafe", "coffee_shop", "food"],
                    ),
                    _place(
                        "place-far-combined",
                        "Lantern House",
                        _lat_offset(400),
                        0.0,
                        ["restaurant", "food"],
                    ),
                ],
            }
        ]
        nearby_only = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
        )
        both = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
            simulate_type_filter=True,
            simulate_text_rescue=True,
        )
        assert nearby_only.candidate_recall == 0.0
        assert both.candidate_recall == 1.0
        # Type-filter does not add Nearby calls; rescue counted exactly once.
        assert both.avg_nearby_calls == nearby_only.avg_nearby_calls
        assert both.avg_text_search_calls == 1.0

    def test_full_raw_world_row_parses(self) -> None:
        # Edge: a raw-world-shaped row (full Google Places fields) yields
        # non-error metrics.
        samples = [
            {
                "id": "raw-world-row",
                "cluster": {
                    "centroid": {"latitude": 35.6, "longitude": 139.7},
                    "time_hint": "food",
                    "start_time": "2024-04-11T11:55:00Z",
                    "end_time": "2024-04-11T12:40:00Z",
                },
                "expected_place_id": "raw-place-1",
                "vision_results": [
                    {
                        "category": "food",
                        "detected_text": ["Raw Place"],
                        "confidence": "high",
                    }
                ],
                "places": [
                    _place(
                        "raw-place-1",
                        "Raw Place",
                        35.60005,
                        139.7,
                        ["restaurant", "food"],
                        rating=4.6,
                        review_count=512,
                    ),
                ],
            }
        ]
        metrics = evaluate_pipeline(
            matcher=make_matcher(),
            samples=samples,
            vision_mode="aggregate",
            stop_threshold=None,
        )
        assert metrics.total == 1
        assert metrics.candidate_recall == 1.0
