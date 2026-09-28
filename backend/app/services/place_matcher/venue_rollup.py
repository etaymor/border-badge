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
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.services.photo_vision import VisionResult
from app.services.photo_vision.constants import VISION_TO_PLACE_TYPES

from ._venue_probe import _guarded, _hint_label
from .constants import (
    MAX_SUGGESTIONS_PER_CLUSTER,
    TYPE_TO_CATEGORY,
    VENUE_ROLLUP_EVIDENCE_GATED_TYPES,
    VENUE_ROLLUP_NON_ROLLABLE_TYPES,
    VENUE_ROLLUP_PARENT_TYPES,
    VENUE_ROLLUP_PARK_TYPES,
    VENUE_ROLLUP_SUB_POI_TYPES,
    VENUE_ROLLUP_WAIVER_MIN_RATIO,
    VENUE_ROLLUP_WAIVER_TYPES,
)
from .utils import haversine, name_match_strength, sanitize_address, sanitize_place_name

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

_KIND_SUB_POI = "sub_poi"
_KIND_GATED = "evidence_gated"
_KIND_OTHER = "other"


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

    @property
    def rolled_up(self) -> bool:
        return self.reason == REASON_ROLLED_UP

    def as_trace(self) -> dict[str, Any]:
        return {"reason": self.reason, "parent_place_id": self.parent_place_id}


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
# Place facts
# ---------------------------------------------------------------------------


def _all_types(place: Mapping[str, Any]) -> set[str]:
    types = set(place.get("types") or ())
    primary = place.get("primaryType")
    if primary:
        types.add(primary)
    return types


def _key_types(place: Mapping[str, Any]) -> set[str]:
    """The types that say what a place IS: its primaryType, else all types."""
    primary = place.get("primaryType")
    return {primary} if primary else set(place.get("types") or ())


def _review_count(place: Mapping[str, Any]) -> int | None:
    count = place.get("userRatingCount")
    if isinstance(count, bool) or not isinstance(count, int | float):
        return None
    return int(count)


def _finalist_kind(place: Mapping[str, Any]) -> str:
    key = _key_types(place)
    if key & VENUE_ROLLUP_NON_ROLLABLE_TYPES:
        return _KIND_OTHER
    if key & VENUE_ROLLUP_SUB_POI_TYPES:
        return _KIND_SUB_POI
    if _all_types(place) & VENUE_ROLLUP_EVIDENCE_GATED_TYPES:
        return _KIND_GATED
    return _KIND_OTHER


def _is_museum(place: Mapping[str, Any]) -> bool:
    return any(t == "museum" or t.endswith("_museum") for t in _all_types(place))


def _has_evidence(
    finalist: Mapping[str, Any],
    name: str,
    vision_result: VisionResult | None,
    scene_hints: Sequence[Any] | None,
    sign_text: Sequence[str] | None,
) -> bool:
    """Positive evidence that the photos are OF this food/drink/lodging/retail
    place (R6): a food hint, a matching vision category or business name, or a
    strong sign-text match to its name."""
    types = _all_types(finalist)
    is_food = bool(types & (VISION_TO_PLACE_TYPES["food"] | {"food"}))
    if is_food and any(_hint_label(h) == "food" for h in scene_hints or ()):
        return True
    if vision_result is not None:
        category_types = VISION_TO_PLACE_TYPES.get(vision_result.category, set())
        if vision_result.confidence != "low" and types & category_types:
            return True
        if any(
            name_match_strength(name, c) != "none"
            for c in vision_result.business_name_candidates
        ):
            return True
    return any(name_match_strength(name, t) == "strong" for t in sign_text or ())


def _inside_viewport(place: Mapping[str, Any], lat: float, lng: float) -> bool:
    viewport = place.get("viewport")
    if not isinstance(viewport, Mapping):
        return False
    try:
        low, high = viewport["low"], viewport["high"]
        return (
            low["latitude"] <= lat <= high["latitude"]
            and low["longitude"] <= lng <= high["longitude"]
        )
    except (KeyError, TypeError):
        return False


def _distance_m(place: Mapping[str, Any], lat: float, lng: float) -> float | None:
    location = place.get("location") or {}
    try:
        return haversine(lat, lng, location["latitude"], location["longitude"])
    except (KeyError, TypeError):
        return None


def _parent_suggestion(
    parent: Mapping[str, Any],
    distance_m: float,
    vision_result: VisionResult | None,
) -> dict[str, Any]:
    """The parent in exactly the shape ``_rank_by_distance`` returns."""
    location = parent.get("location") or {}
    primary_type = parent.get("primaryType", "point_of_interest")
    raw_name = (parent.get("displayName") or {}).get("text", "") or "Unknown Place"
    return {
        "place_id": parent["id"],
        "name": sanitize_place_name(raw_name),
        "address": sanitize_address(parent.get("formattedAddress", "")),
        "location": {
            "latitude": location.get("latitude", 0),
            "longitude": location.get("longitude", 0),
        },
        "category": TYPE_TO_CATEGORY.get(primary_type, "place"),
        "distance_m": round(distance_m, 1),
        "types": parent.get("types", []),
        "vision_category": (
            vision_result.category if vision_result is not None else None
        ),
    }


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
        if not _key_types(place) & VENUE_ROLLUP_PARENT_TYPES:
            continue
        count = _review_count(place)
        if count is None or count < thresholds.min_parent_reviews:
            continue
        distance = _distance_m(place, lat, lng)
        if distance is None:
            continue
        inside = _inside_viewport(place, lat, lng)
        if not inside and distance > thresholds.max_distance_m:
            continue
        ratio = count / top_count if top_count > 0 else float("inf")
        dominant = ratio >= thresholds.dominance_ratio
        waived = (
            top_waivable
            and inside
            and not _key_types(place) & VENUE_ROLLUP_PARK_TYPES
            and ratio >= VENUE_ROLLUP_WAIVER_MIN_RATIO
        )
        if (dominant or waived) and count > best_count:
            best, best_count = (place, distance), count
    return best


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
) -> tuple[list[dict[str, Any]], RollupDecision]:
    """Apply KTD4 to one cluster's final suggestions. Pure; never raises on
    malformed place data (a malformed parent is simply not a parent).

    ``suggestions`` are ranked suggestion dicts (``_rank_by_distance`` shape).
    ``probe_places`` are the cluster's raw venue-probe places (rated, with
    viewport). ``place_facts`` maps a suggestion's ``place_id`` to its raw,
    rated place dict (``primaryType``, ``types``, ``userRatingCount``).

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
    kind = _finalist_kind(facts)
    if kind == _KIND_OTHER:
        return keep(REASON_NOT_SUB_POI)
    if kind == _KIND_GATED and _has_evidence(
        facts, top.get("name", ""), vision_result, scene_hints, sign_text
    ):
        return keep(REASON_EVIDENCE)
    top_count = _review_count(facts)
    if top_count is None:
        return keep(REASON_UNRATED)
    if _is_museum(facts) and top_count >= thresholds.min_parent_reviews:
        return keep(REASON_DISTINCT)

    lat, lng = centroid["latitude"], centroid["longitude"]
    found = _qualifying_parent(
        probe_places,
        top_id=top["place_id"],
        top_count=top_count,
        top_waivable=(
            kind == _KIND_SUB_POI
            and bool(_key_types(facts) & VENUE_ROLLUP_WAIVER_TYPES)
        ),
        lat=lat,
        lng=lng,
        thresholds=thresholds,
    )
    if found is None:
        return keep(REASON_NO_PARENT)

    parent, distance = found
    parent_id = parent["id"]
    existing = next((s for s in suggestions if s["place_id"] == parent_id), None)
    promoted = existing or _parent_suggestion(parent, distance, vision_result)
    rest = [s for s in suggestions if s["place_id"] != parent_id]
    return [promoted, *rest][:limit], RollupDecision(REASON_ROLLED_UP, parent_id)
