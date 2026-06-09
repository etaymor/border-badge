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

import app.services.place_matcher._matcher_search as matcher_search_module
from app.services.photo_vision import PhotoClassifier, VisionResult
from app.services.place_matcher import MAX_PLACES_PER_SEARCH, PlaceMatcher
from app.services.place_matcher.utils import haversine

WeightName = Literal[
    "places_rank_distance_weight",
    "places_rank_review_weight",
    "places_rank_rating_weight",
    "places_rank_fame_weight",
    "places_rank_dwell_weight",
    "places_rank_vision_weight",
    "places_rank_name_match_weight",
]

WEIGHT_NAMES: tuple[WeightName, ...] = (
    "places_rank_distance_weight",
    "places_rank_review_weight",
    "places_rank_rating_weight",
    "places_rank_fame_weight",
    "places_rank_dwell_weight",
    "places_rank_vision_weight",
    "places_rank_name_match_weight",
)

DEFAULT_SEARCH_RANGES: dict[WeightName, tuple[float, float]] = {
    "places_rank_distance_weight": (0.2, 3.0),
    "places_rank_review_weight": (0.2, 3.0),
    "places_rank_rating_weight": (0.2, 3.0),
    "places_rank_fame_weight": (0.2, 3.0),
    "places_rank_dwell_weight": (0.2, 3.0),
    "places_rank_vision_weight": (0.2, 3.0),
    "places_rank_name_match_weight": (0.2, 3.0),
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
    return VisionResult(
        category=str(raw.get("category", "unknown")),
        detected_text=[str(t) for t in raw.get("detected_text", []) if t],
        confidence=str(raw.get("confidence", "low")),
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


def evaluate_pipeline(
    matcher: PlaceMatcher,
    samples: list[dict[str, Any]],
    vision_mode: Literal["none", "single", "aggregate"],
    stop_threshold: int | None,
) -> PipelineMetrics:
    """Simulate the tiered Nearby search per sample to measure recall + cost.

    Treats the sample's `places` list as the complete world: a simulated
    Nearby call at radius R returns the places within R meters of the search
    point, distance-sorted and capped at MAX_PLACES_PER_SEARCH (matching
    rankPreference=DISTANCE). This exposes failures the ranking-only eval
    cannot see — the visited place never being fetched at all — and counts
    the paid Nearby calls each policy makes.
    """
    original_threshold = matcher_search_module.MIN_QUALITY_RESULTS_BEFORE_STOP
    if stop_threshold is not None:
        matcher_search_module.MIN_QUALITY_RESULTS_BEFORE_STOP = stop_threshold

    total = 0
    recall_hits = 0
    top1_hits = 0
    call_counts: list[int] = []

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
            candidates, _radius = asyncio.run(
                matcher._search_nearby_tiered(
                    cluster["centroid"]["latitude"],
                    cluster["centroid"]["longitude"],
                )
            )

            total += 1
            call_counts.append(calls)
            candidate_ids = {p.get("id") for p in candidates}
            if expected_place_id in candidate_ids:
                recall_hits += 1

            vision_result = select_vision_for_sample(sample, vision_mode)
            ranked = matcher._rank_by_distance(
                places=candidates,
                cluster=cluster,
                time_hint=cluster.get("time_hint"),
                vision_result=vision_result,
            )
            if ranked and ranked[0].get("place_id") == expected_place_id:
                top1_hits += 1
    finally:
        matcher_search_module.MIN_QUALITY_RESULTS_BEFORE_STOP = original_threshold

    if total == 0:
        raise ValueError("No valid labeled samples found in dataset")

    return PipelineMetrics(
        total=total,
        candidate_recall=recall_hits / total,
        e2e_top1=top1_hits / total,
        avg_nearby_calls=mean(call_counts),
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
        )
        threshold_note = (
            f"stop_threshold={args.stop_threshold}"
            if args.stop_threshold is not None
            else "stop_threshold=current"
        )
        print(
            f"Pipeline ({threshold_note}): "
            f"candidate_recall={pipeline.candidate_recall:.3f} "
            f"e2e_top1={pipeline.e2e_top1:.3f} "
            f"avg_nearby_calls={pipeline.avg_nearby_calls:.2f} "
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
