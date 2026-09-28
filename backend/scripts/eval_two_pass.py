"""Two-pass ranking simulation for the place-matcher eval harness (KTD5).

``scripts/eval_place_matcher.py --two-pass`` routes here. The legacy eval ranks
each row's whole ``places`` world in ONE pass with every rating visible, which
production never does. Production (``_matcher_cluster_processing``):

1. ranks the rating-blind wide-search candidates (the wide field mask omits
   ``rating``/``userRatingCount``) on distance, vision, dwell and type priors;
2. takes the top ``MAX_SUGGESTIONS_PER_CLUSTER`` finalists (skipping the rest of
   the flow when the top finalist STRONG-matches vision signage, or on-device
   sign text on a finalist that is not sub-POI-like (KTD6): name lock);
3. restores live ratings for those finalists ONLY, re-applies the review gate,
   and re-ranks them;
4. backfills a short list from the first-pass tail: gate-approved (enriched)
   tail places first, then un-gated filler.

This module mirrors that flow against a row's ``places`` world, then hands the
result to :func:`simulate_venue_rollup`, the single roll-up call site, which
runs production's KTD4 roll-up (``app.services.place_matcher.venue_rollup``).

Row fields read here (all optional except the legacy ones):

- ``probe_places``: raw Google places a POPULARITY venue probe returns for the
  cluster (KTD3). Read ONLY by the roll-up step: never in the first pass, the
  enrichment re-rank, or the backfill (KTD3 isolation), so rows without a
  roll-up rank byte-identically to production. Like production, the roll-up
  sees them only when production's trigger (``should_probe_venue`` over the
  row's ``places`` and ``scene_hints``) would have fired the probe.
- ``scene_hints``: ``[{"label": <vocab>, "weight": 0..1}]`` on-device scene
  labels (KTD6). Vocabulary: :data:`SCENE_HINT_VOCABULARY`.
- ``sign_text``: up to :data:`MAX_SIGN_TEXT` short signage strings (KTD6):
  a name signal in both ranking passes, the lock above, and roll-up evidence.
- ``containingPlaces`` on a row place: the Google field (U8, KTD9). Read only
  when production would fetch it: for the top finalist, when KTD4 alone could
  not settle a probed cluster (``containment_fetch_target``).
- ``expected_in_top3``: extra place ids that must also appear in the top 3
  (e.g. the café kept as an option when the parent venue wins, R6).

Rating restoration uses the row's own values. A row place with no
``userRatingCount`` stays unrated (enrichment unavailable), so the review gate
skips it, instead of production's "Details omitted the count = 0 reviews"
normalization: in a hand-labeled row a missing count means "not labeled".
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from statistics import mean
from typing import Any

from app.services.photo_vision import VisionResult
from app.services.place_matcher import PlaceMatcher
from app.services.place_matcher._containing_places import (
    CONTAINING_PLACES_KEY,
    containing_places_enabled,
    parse_containing_ids,
)
from app.services.place_matcher._venue_facts import sign_text_sets_lock
from app.services.place_matcher._venue_probe import should_probe_venue
from app.services.place_matcher.constants import MAX_SUGGESTIONS_PER_CLUSTER
from app.services.place_matcher.utils import name_match_strength
from app.services.place_matcher.venue_rollup import (
    apply_venue_rollup,
    containment_fetch_target,
    rollup_thresholds,
)

RATING_FIELDS = ("rating", "userRatingCount")

# KTD6: normalized on-device scene-label names a cluster may carry.
SCENE_HINT_VOCABULARY = frozenset(
    {"museum_interior", "artwork", "food", "outdoor_landmark"}
)
MAX_SIGN_TEXT = 5


def parse_scene_hints(raw: Any) -> list[dict[str, Any]]:
    """Validate a row's ``scene_hints`` (KTD6 shape). Absent -> ``[]``."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("scene_hints must be a list")
    hints: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("scene_hints entries must be objects")
        label = item.get("label")
        weight = item.get("weight")
        if label not in SCENE_HINT_VOCABULARY:
            raise ValueError(f"unknown scene hint label: {label!r}")
        if not isinstance(weight, int | float) or not 0 <= weight <= 1:
            raise ValueError(f"scene hint weight must be in [0, 1]: {weight!r}")
        hints.append({"label": label, "weight": float(weight)})
    return hints


def parse_sign_text(raw: Any) -> list[str]:
    """Validate a row's ``sign_text`` (KTD6: at most 5 strings)."""
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(isinstance(t, str) for t in raw):
        raise ValueError("sign_text must be a list of strings")
    if len(raw) > MAX_SIGN_TEXT:
        raise ValueError(f"sign_text carries at most {MAX_SIGN_TEXT} strings")
    return [t.strip() for t in raw if t.strip()]


@dataclass
class RollupContext:
    """Everything the roll-up step may read for one cluster."""

    cluster: dict[str, Any]
    vision_result: VisionResult | None
    # Raw venue-probe places (KTD3). Only the roll-up reads these. Empty when
    # production's trigger would not have probed this cluster.
    probe_places: list[dict[str, Any]]
    scene_hints: list[dict[str, Any]]
    sign_text: list[str]
    # True when production would skip enrichment (top finalist STRONG-matched
    # vision signage).
    name_match_locked: bool
    # place_id -> the row's rated raw place (the enriched facts production
    # hands the roll-up).
    place_facts: dict[str, dict[str, Any]] = field(default_factory=dict)


def simulate_venue_rollup(
    matcher: PlaceMatcher,
    suggestions: list[dict[str, Any]],
    context: RollupContext,
) -> list[dict[str, Any]]:
    """Single roll-up call site of the two-pass simulation (KTD4, U7).

    Runs the same pure function production calls, with the matcher's settings.
    It is the only place in this module that reads ``context.probe_places``.
    The U8 containingPlaces tie-breaker runs under production's own fetch rule,
    reading the top finalist's row field in place of the paid lookup.
    """
    thresholds = rollup_thresholds(matcher._settings)

    def run(**extra: Any):
        return apply_venue_rollup(
            suggestions,
            context.probe_places,
            centroid=context.cluster["centroid"],
            place_facts=context.place_facts,
            thresholds=thresholds,
            vision_result=context.vision_result,
            scene_hints=context.scene_hints,
            sign_text=context.sign_text,
            name_match_locked=context.name_match_locked,
            **extra,
        )

    places, decision = run()
    target = (
        containment_fetch_target(
            suggestions,
            context.probe_places,
            decision,
            place_facts=context.place_facts,
            thresholds=thresholds,
            centroid=context.cluster["centroid"],
        )
        if containing_places_enabled(matcher._settings)
        else None
    )
    if target is not None:
        ids = parse_containing_ids(
            context.place_facts[target].get(CONTAINING_PLACES_KEY)
        )
        if ids:
            contained, decision = run(containing_place_ids=ids)
            if decision.rolled_up:
                places = contained
    return places


def _strip_ratings(place: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in place.items() if k not in RATING_FIELDS}


def rank_two_pass(
    matcher: PlaceMatcher,
    sample: dict[str, Any],
    vision_result: VisionResult | None,
) -> list[dict[str, Any]]:
    """Rank one row the way production's two-pass flow does. See module doc."""
    sign_text = parse_sign_text(sample.get("sign_text"))
    # U10: production ranks with the cluster's sign text as a name signal.
    cluster = {**sample["cluster"], "sign_text": sign_text or None}
    world: list[dict[str, Any]] = sample.get("places", [])
    raw_by_id = {p["id"]: p for p in world}
    time_hint = cluster.get("time_hint")
    limit = MAX_SUGGESTIONS_PER_CLUSTER

    def rank(places: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return matcher._rank_by_distance(
            places=places,
            cluster=cluster,
            time_hint=time_hint,
            vision_result=vision_result,
        )

    def enriched(place_id: str) -> dict[str, Any]:
        # The row's own values stand in for the live Details response.
        return raw_by_id[place_id]

    # Pass 1: rating-blind, over the wide-search quality set (the review gate
    # cannot fire without a count, exactly as in the wide pass).
    first_pass = rank(
        matcher._filter_low_quality_places([_strip_ratings(p) for p in world])
    )
    finalists = first_pass[:limit]

    name_candidates = (
        vision_result.business_name_candidates if vision_result is not None else []
    )
    locked = bool(finalists) and (
        any(
            name_match_strength(finalists[0]["name"], c) == "strong"
            for c in name_candidates
        )
        or sign_text_sets_lock(
            raw_by_id.get(finalists[0]["place_id"], finalists[0]),
            finalists[0]["name"],
            sign_text,
        )
    )

    if locked:
        suggestions = finalists
    else:
        finalist_ids = {p["place_id"] for p in finalists}
        reranked = rank(
            matcher._filter_low_quality_places(
                [enriched(p["id"]) for p in world if p["id"] in finalist_ids]
            )
        )
        if len(reranked) < limit:
            reranked = _backfill(matcher, reranked, first_pass, enriched)
        suggestions = reranked or finalists

    scene_hints = parse_scene_hints(sample.get("scene_hints"))
    # Production probes only clusters its trigger selects (U6); mirror it so the
    # roll-up never sees a parent production would not have fetched.
    probed = should_probe_venue(world, scene_hints)
    context = RollupContext(
        cluster=cluster,
        vision_result=vision_result,
        probe_places=list(sample.get("probe_places") or []) if probed else [],
        scene_hints=scene_hints,
        sign_text=sign_text,
        name_match_locked=locked,
        place_facts=raw_by_id,
    )
    return simulate_venue_rollup(matcher, suggestions, context)


def _backfill(
    matcher: PlaceMatcher,
    reranked: list[dict[str, Any]],
    first_pass: list[dict[str, Any]],
    enriched: Callable[[str], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Mirror production's gated backfill then un-gated filler top-up."""
    limit = MAX_SUGGESTIONS_PER_CLUSTER
    backfill_limit = matcher._settings.places_enrich_backfill_limit
    out = list(reranked)
    used = {p["place_id"] for p in out}
    tail = [p for p in first_pass[limit:] if p["place_id"] not in used]
    if backfill_limit > 0:
        candidates = tail[:backfill_limit]
        gated_ids = {
            p["id"]
            for p in matcher._filter_low_quality_places(
                [enriched(p["place_id"]) for p in candidates]
            )
        }
        for candidate in candidates:
            if len(out) >= limit:
                break
            if candidate["place_id"] in gated_ids:
                out.append(candidate)
                used.add(candidate["place_id"])
    filler = [p for p in tail if p["place_id"] not in used]
    out.extend(filler[: max(0, limit - len(out))])
    return out


@dataclass
class TwoPassMetrics:
    total: int
    top1: float
    top3: float
    mrr: float
    found_ratio: float
    mean_rank: float | None
    # Row ids whose top suggestion is not the expected place.
    top1_failures: list[str] = field(default_factory=list)
    # Row ids whose ``expected_in_top3`` ids are not all in the top 3.
    top3_constraint_failures: list[str] = field(default_factory=list)


def evaluate_two_pass(
    matcher: PlaceMatcher,
    samples: list[dict[str, Any]],
    vision_for: Callable[[dict[str, Any]], VisionResult | None],
) -> TwoPassMetrics:
    """Score every labeled row through :func:`rank_two_pass`."""
    total = top1 = top3 = found = 0
    reciprocal_sum = 0.0
    ranks: list[int] = []
    top1_failures: list[str] = []
    top3_failures: list[str] = []

    for sample in samples:
        expected = sample.get("expected_place_id")
        if not expected or not sample.get("cluster"):
            continue
        ranked_ids = [
            p["place_id"] for p in rank_two_pass(matcher, sample, vision_for(sample))
        ]
        total += 1
        if expected in ranked_ids:
            rank = ranked_ids.index(expected) + 1
            found += 1
            ranks.append(rank)
            reciprocal_sum += 1.0 / rank
            top1 += rank == 1
            top3 += rank <= MAX_SUGGESTIONS_PER_CLUSTER
        if not ranked_ids or ranked_ids[0] != expected:
            top1_failures.append(str(sample.get("id")))
        also = sample.get("expected_in_top3") or []
        if not set(also) <= set(ranked_ids[:MAX_SUGGESTIONS_PER_CLUSTER]):
            top3_failures.append(str(sample.get("id")))

    if total == 0:
        raise ValueError("No valid labeled samples found in dataset")

    return TwoPassMetrics(
        total=total,
        top1=top1 / total,
        top3=top3 / total,
        mrr=reciprocal_sum / total,
        found_ratio=found / total,
        mean_rank=mean(ranks) if ranks else None,
        top1_failures=top1_failures,
        top3_constraint_failures=top3_failures,
    )
