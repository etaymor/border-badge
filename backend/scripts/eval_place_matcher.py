#!/usr/bin/env python3
"""Lightweight offline evaluator for place matcher ranking.

Usage:
    cd backend
    poetry run python scripts/eval_place_matcher.py \
      --dataset docs/place_matcher_eval_dataset.sample.json \
      --trials 200 --optimize-for top1

Dataset schema (JSON):
[
  {
    "id": "sample-1",
    "cluster": {
      "centroid": {"latitude": 35.6762, "longitude": 139.6503},
      "time_hint": "food",
      "start_time": "2024-05-10T12:00:00Z",
      "end_time": "2024-05-10T12:45:00Z"
    },
    "places": [ ... raw Google Places-style candidates ... ],
    "expected_place_id": "place-123",
    "vision_result": {
      "category": "food",
      "detected_text": ["Sushi Dai"],
      "confidence": "high"
    },
    "vision_results": [
      {"category": "food", "detected_text": ["Sushi Dai"], "confidence": "high"},
      {"category": "landmark", "detected_text": [], "confidence": "low"}
    ]
  }
]

`vision_results` is optional and is useful for measuring multi-photo aggregation.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any, Literal
from unittest.mock import AsyncMock

# Add backend root to import path.
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.photo_vision import PhotoClassifier, VisionResult
from app.services.place_matcher import MAX_PLACES_PER_SEARCH, PlaceMatcher
from app.services.place_matcher.constants import SEARCHABLE_PLACE_TYPES
from app.services.place_matcher.utils import (
    haversine,
    name_match_strength,
    name_matches_candidate,
)

WeightName = Literal[
    "places_rank_distance_weight",
    "places_rank_review_weight",
    "places_rank_rating_weight",
    "places_rank_fame_weight",
    "places_rank_dwell_weight",
    "places_rank_vision_weight",
    "places_rank_name_match_weight",
    "places_rank_lodging_penalty",
    "places_rank_landmark_boost",
]

WEIGHT_NAMES: tuple[WeightName, ...] = (
    "places_rank_distance_weight",
    "places_rank_review_weight",
    "places_rank_rating_weight",
    "places_rank_fame_weight",
    "places_rank_dwell_weight",
    "places_rank_vision_weight",
    "places_rank_name_match_weight",
    "places_rank_lodging_penalty",
    "places_rank_landmark_boost",
)

DEFAULT_SEARCH_RANGES: dict[WeightName, tuple[float, float]] = {
    "places_rank_distance_weight": (0.2, 3.0),
    "places_rank_review_weight": (0.2, 3.0),
    "places_rank_rating_weight": (0.2, 3.0),
    "places_rank_fame_weight": (0.2, 3.0),
    "places_rank_dwell_weight": (0.2, 3.0),
    "places_rank_vision_weight": (0.2, 3.0),
    "places_rank_name_match_weight": (0.2, 3.0),
    # U3 type-prior magnitudes (points, not multipliers): 0 disables.
    "places_rank_lodging_penalty": (0.0, 5.0),
    "places_rank_landmark_boost": (0.0, 5.0),
}


@dataclass
class EvalMetrics:
    total: int
    top1: float
    top3: float
    mrr: float
    found_ratio: float
    mean_rank: float | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate/tune place matcher ranking.")
    parser.add_argument("--dataset", required=True, help="Path to JSON dataset")
    parser.add_argument(
        "--trials",
        type=int,
        default=200,
        help="Number of random search weight trials",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducible search",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=5,
        help="How many top configs to print",
    )
    parser.add_argument(
        "--optimize-for",
        choices=["top1", "mrr"],
        default="top1",
        help="Primary metric for selecting best weight config",
    )
    parser.add_argument(
        "--vision-mode",
        choices=["none", "single", "aggregate"],
        default="aggregate",
        help="How to consume vision data in dataset evaluation",
    )
    parser.add_argument(
        "--no-search",
        action="store_true",
        help="Only evaluate current config; skip random search",
    )
    parser.add_argument(
        "--pipeline",
        action="store_true",
        help=(
            "Also simulate the tiered Nearby search per sample (treating the "
            "sample's places as the ground-truth world) to measure candidate "
            "RECALL, end-to-end top-1, and paid Nearby calls per cluster"
        ),
    )
    parser.add_argument(
        "--stop-threshold",
        type=int,
        default=None,
        help=(
            "Override MIN_QUALITY_RESULTS_BEFORE_STOP for --pipeline (1 "
            "reproduces the legacy stop-at-first-hit behavior)"
        ),
    )
    parser.add_argument(
        "--simulate-type-filter",
        action="store_true",
        help=(
            "C5 sim: filter the simulated Nearby RESULTS to places whose types "
            "intersect SEARCHABLE_PLACE_TYPES (the includedTypes allowlist). "
            "Filters results, not per-call cost — though dropping results can "
            "leave the tiered search short of its stop threshold, adding tiers."
        ),
    )
    parser.add_argument(
        "--simulate-text-rescue",
        action="store_true",
        help=(
            "C2 sim: when Nearby misses a place matching the vision detected "
            "text, simulate a Text Search that recovers world places whose "
            "displayName matches the vision business_name_candidates. Reports "
            "avg_text_search_calls."
        ),
    )
    return parser.parse_args()


def load_dataset(path: str) -> list[dict[str, Any]]:
    dataset_path = Path(path)
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    data = json.loads(dataset_path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        raise ValueError("Dataset must be a non-empty JSON array")
    return data


def parse_vision_result(raw: dict[str, Any] | None) -> VisionResult | None:
    if not raw:
        return None
    landmark_name = raw.get("landmark_name")
    return VisionResult(
        category=str(raw.get("category", "unknown")),
        detected_text=[str(t) for t in raw.get("detected_text", []) if t],
        confidence=str(raw.get("confidence", "low")),
        landmark_name=str(landmark_name) if landmark_name else None,
    )


def select_vision_for_sample(
    sample: dict[str, Any],
    vision_mode: Literal["none", "single", "aggregate"],
) -> VisionResult | None:
    if vision_mode == "none":
        return None

    raw_list = sample.get("vision_results")
    if isinstance(raw_list, list) and raw_list:
        parsed = [
            parse_vision_result(item) for item in raw_list if isinstance(item, dict)
        ]
        if vision_mode == "single":
            return parsed[0] if parsed else None
        return PhotoClassifier.aggregate_results(parsed)

    # Fallback to legacy single result.
    return parse_vision_result(sample.get("vision_result"))


def set_weights(matcher: PlaceMatcher, weights: dict[WeightName, float]) -> None:
    for name, value in weights.items():
        setattr(matcher._settings, name, float(value))


def current_weights(matcher: PlaceMatcher) -> dict[WeightName, float]:
    out: dict[WeightName, float] = {}
    for name in WEIGHT_NAMES:
        value = getattr(matcher._settings, name, 1.0)
        out[name] = float(value) if isinstance(value, int | float) else 1.0
    return out


def evaluate(
    matcher: PlaceMatcher,
    samples: list[dict[str, Any]],
    weights: dict[WeightName, float],
    vision_mode: Literal["none", "single", "aggregate"],
) -> EvalMetrics:
    set_weights(matcher, weights)

    total = 0
    top1_hits = 0
    top3_hits = 0
    reciprocal_sum = 0.0
    found = 0
    found_ranks: list[int] = []

    for sample in samples:
        cluster = sample.get("cluster", {})
        places = sample.get("places", [])
        expected_place_id = sample.get("expected_place_id")
        if not expected_place_id or not cluster or not isinstance(places, list):
            continue

        vision_result = select_vision_for_sample(sample, vision_mode)
        ranked = matcher._rank_by_distance(
            places=places,
            cluster=cluster,
            time_hint=cluster.get("time_hint"),
            vision_result=vision_result,
        )
        ranked_ids = [p.get("place_id") for p in ranked]

        total += 1
        if expected_place_id in ranked_ids:
            rank = ranked_ids.index(expected_place_id) + 1
            found += 1
            found_ranks.append(rank)
            reciprocal_sum += 1.0 / rank
            if rank == 1:
                top1_hits += 1
            if rank <= 3:
                top3_hits += 1

    if total == 0:
        raise ValueError("No valid labeled samples found in dataset")

    return EvalMetrics(
        total=total,
        top1=top1_hits / total,
        top3=top3_hits / total,
        mrr=reciprocal_sum / total,
        found_ratio=found / total,
        mean_rank=mean(found_ranks) if found_ranks else None,
    )


@dataclass
class PipelineMetrics:
    total: int
    candidate_recall: float
    e2e_top1: float
    avg_nearby_calls: float
    # Average simulated text-search calls per cluster. Only populated when the
    # text-rescue sim is on; None otherwise so existing runs are unaffected.
    avg_text_search_calls: float | None = None


def _simulate_text_rescue(
    *,
    world: list[dict[str, Any]],
    nearby_places: list[dict[str, Any]],
    vision_result: VisionResult | None,
) -> tuple[list[dict[str, Any]], int]:
    """Simulate the production Text-Search rescue against the sample world.

    Rescue rule (mirrors ``_matcher_cluster_processing`` rescue triggering):

    1. Vision must carry at least one ``business_name_candidate``, OR (U5) a
       visually recognized ``landmark_name`` on a non-low-confidence landmark
       cluster (the same gates the production matcher uses; low-confidence
       text only rescues when Nearby is empty, matching ``confidence_ok``).
    2. Suppress the rescue only when a Nearby place STRONG-matches the query
       (same venue, per ``name_match_strength``) — the production matcher
       skips the (Enterprise-tier) Text Search in that case because it would
       only re-find what we already have. A weak containment match must NOT
       suppress (U2): that is exactly how 'Eiffel Tower' matched a nearby
       Airbnb's marketing name and the real tower was never fetched.
    3. Otherwise simulate ONE Text Search: return every world place whose
       ``displayName.text`` name-matches any query. This is a name-match
       against the whole world (NOT a radius filter, NOT a real API call), so
       it can recover a place Nearby missed because it sat outside every
       search radius.

    Returns ``(rescued_places, text_search_calls)`` where ``text_search_calls``
    is 0 (rescue suppressed / not eligible) or 1 (one simulated call).
    """
    if vision_result is None:
        return [], 0

    if vision_result.has_business_name:
        queries = vision_result.business_name_candidates
    elif (
        vision_result.category == "landmark"
        and vision_result.confidence != "low"
        and vision_result.landmark_name
    ):
        queries = [vision_result.landmark_name]
    else:
        return [], 0

    if not queries:
        return [], 0

    # Cost-bounded gate: low-confidence text only rescues when Nearby is empty.
    if vision_result.confidence == "low" and nearby_places:
        return [], 0

    # Suppress only on a STRONG (same-venue) match among Nearby results.
    already_found = any(
        name_match_strength(p.get("displayName", {}).get("text", ""), queries[0])
        == "strong"
        for p in nearby_places
    )
    if already_found:
        return [], 0

    rescued = [
        place
        for place in world
        if any(
            name_matches_candidate(place.get("displayName", {}).get("text", ""), query)
            for query in queries
        )
    ]
    return rescued, 1


def evaluate_pipeline(
    matcher: PlaceMatcher,
    samples: list[dict[str, Any]],
    vision_mode: Literal["none", "single", "aggregate"],
    stop_threshold: int | None,
    *,
    simulate_type_filter: bool = False,
    simulate_text_rescue: bool = False,
) -> PipelineMetrics:
    """Simulate the tiered Nearby search per sample to measure recall + cost.

    Treats the sample's `places` list as the complete world: a simulated
    Nearby call at radius R returns the places within R meters of the search
    point, distance-sorted and capped at MAX_PLACES_PER_SEARCH (matching
    rankPreference=DISTANCE). This exposes failures the ranking-only eval
    cannot see — the visited place never being fetched at all — and counts
    the paid Nearby calls each policy makes.

    Args:
        simulate_type_filter: C5 sim. Filter the in-radius candidate set to
            places whose ``types`` intersect ``SEARCHABLE_PLACE_TYPES`` (the
            ``includedTypes`` allowlist). Filters RESULTS, not per-call cost;
            ``avg_nearby_calls`` can still rise vs baseline when the dropped
            results leave a tier short of the stop threshold.
        simulate_text_rescue: C2 sim. After the Nearby search, run a simulated
            name-match Text Search (see :func:`_simulate_text_rescue`) so a
            place that sits outside every search radius can be recovered. When
            on, ``avg_text_search_calls`` is reported.

    The ``--stop-threshold`` override targets ``matcher._settings`` (U2 made
    ``_search_nearby_tiered`` read the Settings value; the old module-global
    override is an inert no-op), restored in ``finally``.
    """
    original_threshold = matcher._settings.places_min_quality_results_before_stop
    if stop_threshold is not None:
        matcher._settings.places_min_quality_results_before_stop = stop_threshold

    total = 0
    recall_hits = 0
    top1_hits = 0
    call_counts: list[int] = []
    text_search_counts: list[int] = []

    allowlist = set(SEARCHABLE_PLACE_TYPES)

    try:
        for sample in samples:
            cluster = sample.get("cluster", {})
            world = sample.get("places", [])
            expected_place_id = sample.get("expected_place_id")
            if not expected_place_id or not cluster or not isinstance(world, list):
                continue

            calls = 0

            async def fake_execute_search(
                latitude: float,
                longitude: float,
                radius: float,
                _world: list[dict[str, Any]] = world,
            ) -> list[dict[str, Any]]:
                nonlocal calls
                calls += 1
                in_radius = [
                    p
                    for p in _world
                    if haversine(
                        latitude,
                        longitude,
                        p["location"]["latitude"],
                        p["location"]["longitude"],
                    )
                    <= radius
                ]
                if simulate_type_filter:
                    # C5: a place whose types miss the allowlist is never
                    # returned by Nearby (includedTypes gate). Filters results,
                    # not calls.
                    in_radius = [
                        p
                        for p in in_radius
                        if allowlist.intersection(p.get("types", []))
                    ]
                in_radius.sort(
                    key=lambda p: haversine(
                        latitude,
                        longitude,
                        p["location"]["latitude"],
                        p["location"]["longitude"],
                    )
                )
                return in_radius[:MAX_PLACES_PER_SEARCH]

            matcher._execute_search = fake_execute_search  # type: ignore[method-assign]
            search_result = asyncio.run(
                matcher._search_nearby_tiered(
                    cluster["centroid"]["latitude"],
                    cluster["centroid"]["longitude"],
                )
            )
            candidates = search_result.places

            vision_result = select_vision_for_sample(sample, vision_mode)

            if simulate_text_rescue:
                rescued, text_calls = _simulate_text_rescue(
                    world=world,
                    nearby_places=candidates,
                    vision_result=vision_result,
                )
                text_search_counts.append(text_calls)
                if rescued:
                    seen = {p.get("id") for p in candidates}
                    candidates = candidates + [
                        p for p in rescued if p.get("id") not in seen
                    ]

            total += 1
            call_counts.append(calls)
            candidate_ids = {p.get("id") for p in candidates}
            if expected_place_id in candidate_ids:
                recall_hits += 1

            ranked = matcher._rank_by_distance(
                places=candidates,
                cluster=cluster,
                time_hint=cluster.get("time_hint"),
                vision_result=vision_result,
            )
            if ranked and ranked[0].get("place_id") == expected_place_id:
                top1_hits += 1
    finally:
        matcher._settings.places_min_quality_results_before_stop = original_threshold

    if total == 0:
        raise ValueError("No valid labeled samples found in dataset")

    return PipelineMetrics(
        total=total,
        candidate_recall=recall_hits / total,
        e2e_top1=top1_hits / total,
        avg_nearby_calls=mean(call_counts),
        avg_text_search_calls=(
            mean(text_search_counts) if simulate_text_rescue else None
        ),
    )


def random_weight_configs(
    base: dict[WeightName, float],
    trials: int,
    seed: int,
) -> list[dict[WeightName, float]]:
    rng = random.Random(seed)
    configs = [dict(base)]

    for _ in range(max(0, trials)):
        candidate: dict[WeightName, float] = {}
        for name in WEIGHT_NAMES:
            lo, hi = DEFAULT_SEARCH_RANGES[name]
            candidate[name] = round(rng.uniform(lo, hi), 3)
        configs.append(candidate)

    return configs


def format_metrics(metrics: EvalMetrics) -> str:
    mean_rank_str = (
        f"{metrics.mean_rank:.2f}" if metrics.mean_rank is not None else "n/a"
    )
    return (
        f"top1={metrics.top1:.3f} top3={metrics.top3:.3f} mrr={metrics.mrr:.3f} "
        f"found={metrics.found_ratio:.3f} mean_rank={mean_rank_str} n={metrics.total}"
    )


def score_value(metrics: EvalMetrics, optimize_for: Literal["top1", "mrr"]) -> float:
    return metrics.top1 if optimize_for == "top1" else metrics.mrr


def main() -> None:
    args = parse_args()
    samples = load_dataset(args.dataset)

    matcher = PlaceMatcher(http_client=AsyncMock())
    baseline_weights = current_weights(matcher)
    baseline_metrics = evaluate(
        matcher=matcher,
        samples=samples,
        weights=baseline_weights,
        vision_mode=args.vision_mode,
    )

    print("Baseline:", format_metrics(baseline_metrics))
    print("Baseline weights:", json.dumps(baseline_weights, indent=2))

    if args.pipeline:
        pipeline = evaluate_pipeline(
            matcher=matcher,
            samples=samples,
            vision_mode=args.vision_mode,
            stop_threshold=args.stop_threshold,
            simulate_type_filter=args.simulate_type_filter,
            simulate_text_rescue=args.simulate_text_rescue,
        )
        notes = [
            (
                f"stop_threshold={args.stop_threshold}"
                if args.stop_threshold is not None
                else "stop_threshold=current"
            )
        ]
        if args.simulate_type_filter:
            notes.append("type_filter=on")
        if args.simulate_text_rescue:
            notes.append("text_rescue=on")
        text_calls_note = (
            f"avg_text_search_calls={pipeline.avg_text_search_calls:.2f} "
            if pipeline.avg_text_search_calls is not None
            else ""
        )
        print(
            f"Pipeline ({', '.join(notes)}): "
            f"candidate_recall={pipeline.candidate_recall:.3f} "
            f"e2e_top1={pipeline.e2e_top1:.3f} "
            f"avg_nearby_calls={pipeline.avg_nearby_calls:.2f} "
            f"{text_calls_note}"
            f"n={pipeline.total}"
        )

    if args.no_search:
        return

    configs = random_weight_configs(
        base=baseline_weights,
        trials=args.trials,
        seed=args.seed,
    )
    scored: list[tuple[float, EvalMetrics, dict[WeightName, float]]] = []
    for cfg in configs:
        metrics = evaluate(
            matcher=matcher,
            samples=samples,
            weights=cfg,
            vision_mode=args.vision_mode,
        )
        scored.append((score_value(metrics, args.optimize_for), metrics, cfg))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_n = max(1, args.top)

    print(f"\nTop {top_n} configs by {args.optimize_for}:")
    for i, (_, metrics, cfg) in enumerate(scored[:top_n], start=1):
        print(f"{i}. {format_metrics(metrics)}")
        print("   ", json.dumps(cfg))

    best_metrics = scored[0][1]
    best_weights = scored[0][2]
    print("\nBest config env vars:")
    for name in WEIGHT_NAMES:
        print(f"{name.upper()}={best_weights[name]}")

    print("\nImprovement over baseline:")
    print(f"top1: {baseline_metrics.top1:.3f} -> {best_metrics.top1:.3f}")
    print(f"top3: {baseline_metrics.top3:.3f} -> {best_metrics.top3:.3f}")
    print(f"mrr:  {baseline_metrics.mrr:.3f} -> {best_metrics.mrr:.3f}")


if __name__ == "__main__":
    main()
