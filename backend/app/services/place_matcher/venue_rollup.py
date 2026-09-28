"""Venue roll-up: promote a major parent venue over the minor places inside it.

KTD4 of the venue-rollup plan (U7). A cluster inside the Louvre ranks against
exhibits, departments and kiosks; the museum itself only arrives through the
U6 venue probe, in a separate per-cluster map. This module is the ONLY reader
of that map. It is a deterministic post-rank step, not a ``sort_key`` weight:
linear distance against log-scaled fame cannot be tuned to fix this without
breaking ordinary clusters.

After re-rank and backfill, a venue-probe place becomes ``places[0]`` when all
of these hold:

* **Contained.** The centroid is inside the parent's viewport, or within
  ``places_rollup_max_distance_m`` of its point.
* **Major.** ``userRatingCount >= places_rollup_min_parent_reviews``, and its
  type is a parent type (museum, landmark, attraction, park, church).
* **Dominant.** Its reviews are at least ``places_rollup_dominance_ratio``
  times the top finalist's. Waived for an exhibit / landmark-family finalist
  when the centroid is inside the parent's viewport and the parent is not a
  park, down to a floor of ``VENUE_ROLLUP_WAIVER_MIN_RATIO``.
* **The top finalist is sub-POI-like**: an exhibit, gallery, department,
  landmark-family POI or small garden; or a food / drink / lodging / retail
  place with no evidence for it (no on-device ``food`` hint, no matching
  vision category or business name, no strong sign-text match). R6.
* **Not a distinct institution**: a museum finalist with its own
  ``min_parent_reviews`` keeps its place (Musée des Arts Décoratifs).

The parent goes to ``places[0]``; the remaining slots keep the best finalists
in order, so a displaced café stays in slot 2. Nothing here does I/O: the eval
harness (``scripts/eval_two_pass.py``) calls the same function production does.

**containingPlaces tie-breaker (U8, KTD9).** When Google's ``containingPlaces``
for the top finalist names a probe parent, containment and sub-POI-likeness
hold outright and the dominance ratio is waived; the other guards (parent
minimum reviews, name-match lock, R6 evidence, distinct institution,
never-rollable types) still apply, plus a floor: the container must have at
least as many reviews as the finalist, so Champ de Mars never absorbs the
Eiffel Tower. A containing place that is not a probe parent, or no field at all,
leaves KTD4 exactly as it was. :func:`containment_fetch_target` says when the
paid lookup could change the outcome at all.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.services.photo_vision import VisionResult

from ._venue_facts import (
    KIND_GATED,
    KIND_OTHER,
    KIND_SUB_POI,
    distance_m,
    finalist_kind,
    has_evidence,
    inside_viewport,
    is_museum,
    key_types,
    parent_suggestion,
    review_count,
)
from ._venue_probe import _guarded
from .constants import (
    MAX_SUGGESTIONS_PER_CLUSTER,
    VENUE_ROLLUP_NON_ROLLABLE_TYPES,
    VENUE_ROLLUP_PARENT_TYPES,
    VENUE_ROLLUP_PARK_TYPES,
    VENUE_ROLLUP_WAIVER_MIN_RATIO,
    VENUE_ROLLUP_WAIVER_TYPES,
)

# Settings fallbacks for a stand-in that does not carry well-typed values;
# they equal the Settings defaults.
_MAX_DISTANCE_FALLBACK_M = 250
_MIN_PARENT_REVIEWS_FALLBACK = 2000
_DOMINANCE_RATIO_FALLBACK = 10.0

# Decision reasons (diagnostics trace vocabulary).
REASON_ROLLED_UP = "rolled_up"
REASON_DISABLED = "disabled"
REASON_NAME_LOCKED = "name_match_locked"
REASON_NO_PROBE = "no_probe_places"
REASON_NO_FINALIST = "no_finalist"
REASON_NOT_SUB_POI = "finalist_not_sub_poi"
REASON_EVIDENCE = "finalist_has_evidence"
REASON_DISTINCT = "distinct_institution"
REASON_UNRATED = "finalist_unrated"
REASON_NO_PARENT = "no_qualifying_parent"

# U8: a container named by containingPlaces must have at least this many times
# the finalist's reviews (1.0 = at least as many).
CONTAINMENT_MIN_RATIO = 1.0


@dataclass(frozen=True)
class RollupThresholds:
    """The three KTD4 knobs. ``min_parent_reviews == 0`` turns the rule off."""

    max_distance_m: float
    min_parent_reviews: int
    dominance_ratio: float

    @property
    def enabled(self) -> bool:
        return self.min_parent_reviews > 0


@dataclass(frozen=True)
class RollupDecision:
    """What the roll-up did for one cluster, for the diagnostics trace."""

    reason: str
    parent_place_id: str | None = None
    via_containing_places: bool = False

    @property
    def rolled_up(self) -> bool:
        return self.reason == REASON_ROLLED_UP

    def as_trace(self) -> dict[str, Any]:
        trace: dict[str, Any] = {
            "reason": self.reason,
            "parent_place_id": self.parent_place_id,
        }
        if self.via_containing_places:
            trace["containing_places"] = True
        return trace


def rollup_thresholds(settings: Any) -> RollupThresholds:
    """Read the roll-up knobs, falling back on missing or wrong-typed values."""
    return RollupThresholds(
        max_distance_m=_guarded(
            settings,
            "places_rollup_max_distance_m",
            _MAX_DISTANCE_FALLBACK_M,
            (int, float),
        ),
        min_parent_reviews=_guarded(
            settings,
            "places_rollup_min_parent_reviews",
            _MIN_PARENT_REVIEWS_FALLBACK,
            int,
        ),
        dominance_ratio=_guarded(
            settings,
            "places_rollup_dominance_ratio",
            _DOMINANCE_RATIO_FALLBACK,
            (int, float),
        ),
    )


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------


def _qualifying_parent(
    probe_places: Sequence[Mapping[str, Any]],
    *,
    top_id: str,
    top_count: int,
    top_waivable: bool,
    lat: float,
    lng: float,
    thresholds: RollupThresholds,
) -> tuple[Mapping[str, Any], float] | None:
    """The most-reviewed probe place that contains, is major and dominates."""
    best: tuple[Mapping[str, Any], float] | None = None
    best_count = -1
    for place in probe_places:
        if place.get("id") in (None, top_id):
            continue
        if not key_types(place) & VENUE_ROLLUP_PARENT_TYPES:
            continue
        count = review_count(place)
        if count is None or count < thresholds.min_parent_reviews:
            continue
        distance = distance_m(place, lat, lng)
        if distance is None:
            continue
        inside = inside_viewport(place, lat, lng)
        if not inside and distance > thresholds.max_distance_m:
            continue
        ratio = count / top_count if top_count > 0 else float("inf")
        dominant = ratio >= thresholds.dominance_ratio
        waived = (
            top_waivable
            and inside
            and not key_types(place) & VENUE_ROLLUP_PARK_TYPES
            and ratio >= VENUE_ROLLUP_WAIVER_MIN_RATIO
        )
        if (dominant or waived) and count > best_count:
            best, best_count = (place, distance), count
    return best


def _containment_candidates(
    probe_places: Sequence[Mapping[str, Any]],
    *,
    top_id: str,
    top_count: int,
    lat: float,
    lng: float,
    thresholds: RollupThresholds,
) -> list[tuple[Mapping[str, Any], float]]:
    """Probe places that WOULD be the parent if containingPlaces named them:
    parent-typed, major, at least as reviewed as the finalist, locatable."""
    found = []
    for place in probe_places:
        if place.get("id") in (None, top_id):
            continue
        if not key_types(place) & VENUE_ROLLUP_PARENT_TYPES:
            continue
        count = review_count(place)
        if count is None or count < thresholds.min_parent_reviews:
            continue
        if count < CONTAINMENT_MIN_RATIO * top_count:
            continue
        distance = distance_m(place, lat, lng)
        if distance is not None:
            found.append((place, distance))
    return found


def apply_venue_rollup(
    suggestions: Sequence[dict[str, Any]],
    probe_places: Sequence[Mapping[str, Any]],
    *,
    centroid: Mapping[str, float],
    place_facts: Mapping[str, Mapping[str, Any]],
    thresholds: RollupThresholds,
    vision_result: VisionResult | None = None,
    scene_hints: Sequence[Any] | None = None,
    sign_text: Sequence[str] | None = None,
    name_match_locked: bool = False,
    limit: int = MAX_SUGGESTIONS_PER_CLUSTER,
    containing_place_ids: Collection[str] | None = None,
) -> tuple[list[dict[str, Any]], RollupDecision]:
    """Apply KTD4 to one cluster's final suggestions. Pure; never raises on
    malformed place data (a malformed parent is simply not a parent).

    ``suggestions`` are ranked suggestion dicts (``_rank_by_distance`` shape).
    ``probe_places`` are the cluster's raw venue-probe places (rated, with
    viewport). ``place_facts`` maps a suggestion's ``place_id`` to its raw,
    rated place dict (``primaryType``, ``types``, ``userRatingCount``).

    ``containing_place_ids`` is the top finalist's Google ``containingPlaces``
    (U8). ``None`` or empty behaves exactly as KTD4 alone.

    Returns the new suggestion list (a new list; inputs are not mutated) and
    the decision. When the rule does not fire, the list equals ``suggestions``.
    """
    unchanged = list(suggestions)

    def keep(reason: str) -> tuple[list[dict[str, Any]], RollupDecision]:
        return unchanged, RollupDecision(reason)

    if not thresholds.enabled:
        return keep(REASON_DISABLED)
    if name_match_locked:
        return keep(REASON_NAME_LOCKED)
    if not probe_places:
        return keep(REASON_NO_PROBE)
    if not suggestions:
        return keep(REASON_NO_FINALIST)

    top = suggestions[0]
    facts = place_facts.get(top["place_id"]) or {"types": top.get("types") or []}
    kind = finalist_kind(facts)
    # U8: containingPlaces can stand in for sub-POI-likeness, never for a
    # never-rollable type. Any exit a KTD4 run would take at NOT_SUB_POI keeps
    # that reason, so an unmatched container leaves the decision identical.
    may_contain = bool(containing_place_ids) and not (
        key_types(facts) & VENUE_ROLLUP_NON_ROLLABLE_TYPES
    )
    if kind == KIND_OTHER and not may_contain:
        return keep(REASON_NOT_SUB_POI)

    def early(reason: str) -> tuple[list[dict[str, Any]], RollupDecision]:
        return keep(REASON_NOT_SUB_POI if kind == KIND_OTHER else reason)

    if kind == KIND_GATED and has_evidence(
        facts, top.get("name", ""), vision_result, scene_hints, sign_text
    ):
        return keep(REASON_EVIDENCE)
    top_count = review_count(facts)
    if top_count is None:
        return early(REASON_UNRATED)
    if is_museum(facts) and top_count >= thresholds.min_parent_reviews:
        return early(REASON_DISTINCT)

    lat, lng = centroid["latitude"], centroid["longitude"]
    if may_contain:
        named = [
            (place, distance)
            for place, distance in _containment_candidates(
                probe_places,
                top_id=top["place_id"],
                top_count=top_count,
                lat=lat,
                lng=lng,
                thresholds=thresholds,
            )
            if place["id"] in (containing_place_ids or ())
        ]
        if named:
            parent, distance = max(named, key=lambda pd: review_count(pd[0]) or 0)
            return _promote(
                suggestions, parent, distance, vision_result, limit, contained=True
            )
    if kind == KIND_OTHER:
        return keep(REASON_NOT_SUB_POI)

    found = _qualifying_parent(
        probe_places,
        top_id=top["place_id"],
        top_count=top_count,
        top_waivable=(
            kind == KIND_SUB_POI and bool(key_types(facts) & VENUE_ROLLUP_WAIVER_TYPES)
        ),
        lat=lat,
        lng=lng,
        thresholds=thresholds,
    )
    if found is None:
        return keep(REASON_NO_PARENT)

    parent, distance = found
    return _promote(suggestions, parent, distance, vision_result, limit)


def _promote(
    suggestions: Sequence[dict[str, Any]],
    parent: Mapping[str, Any],
    distance: float,
    vision_result: VisionResult | None,
    limit: int,
    *,
    contained: bool = False,
) -> tuple[list[dict[str, Any]], RollupDecision]:
    parent_id = parent["id"]
    existing = next((s for s in suggestions if s["place_id"] == parent_id), None)
    promoted = existing or parent_suggestion(parent, distance, vision_result)
    rest = [s for s in suggestions if s["place_id"] != parent_id]
    decision = RollupDecision(REASON_ROLLED_UP, parent_id, contained)
    return [promoted, *rest][:limit], decision


def containment_fetch_target(
    suggestions: Sequence[Mapping[str, Any]],
    probe_places: Sequence[Mapping[str, Any]],
    decision: RollupDecision,
    *,
    place_facts: Mapping[str, Mapping[str, Any]],
    thresholds: RollupThresholds,
    centroid: Mapping[str, float] | None = None,
) -> str | None:
    """The top finalist's place id when its containingPlaces could change the
    KTD4 outcome, else ``None`` (U8 cost rule: fetch only what can matter).

    Only a KTD4 run that stopped at containment / dominance
    (``no_qualifying_parent``) or at sub-POI-likeness (``finalist_not_sub_poi``)
    can be overturned, and only when a probe place exists that would pass
    every other guard if Google named it as the container.
    """
    if decision.reason not in (REASON_NO_PARENT, REASON_NOT_SUB_POI):
        return None
    if not suggestions or not probe_places:
        return None
    top_id = suggestions[0].get("place_id")
    facts = place_facts.get(top_id) if top_id else None
    if not facts or key_types(facts) & VENUE_ROLLUP_NON_ROLLABLE_TYPES:
        return None
    top_count = review_count(facts)
    if top_count is None:
        return None
    if is_museum(facts) and top_count >= thresholds.min_parent_reviews:
        return None
    lat = (centroid or {}).get("latitude", 0.0)
    lng = (centroid or {}).get("longitude", 0.0)
    candidates = _containment_candidates(
        probe_places,
        top_id=top_id,
        top_count=top_count,
        lat=lat,
        lng=lng,
        thresholds=thresholds,
    )
    return top_id if candidates else None
