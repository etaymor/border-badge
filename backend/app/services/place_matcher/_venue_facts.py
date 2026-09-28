"""Place facts for the venue roll-up (KTD4): pure readers of raw Places dicts.

Split out of ``venue_rollup`` to keep that module under the 500-line standard
once the U8 containingPlaces tie-breaker landed. No I/O.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from app.services.photo_vision import VisionResult
from app.services.photo_vision.constants import VISION_TO_PLACE_TYPES

from ._venue_probe import _hint_label
from .constants import (
    TYPE_TO_CATEGORY,
    VENUE_ROLLUP_EVIDENCE_GATED_TYPES,
    VENUE_ROLLUP_NON_ROLLABLE_TYPES,
    VENUE_ROLLUP_SUB_POI_TYPES,
)
from .utils import haversine, name_match_strength, sanitize_address, sanitize_place_name

KIND_SUB_POI = "sub_poi"
KIND_GATED = "evidence_gated"
KIND_OTHER = "other"


def all_types(place: Mapping[str, Any]) -> set[str]:
    types = set(place.get("types") or ())
    primary = place.get("primaryType")
    if primary:
        types.add(primary)
    return types


def key_types(place: Mapping[str, Any]) -> set[str]:
    """The types that say what a place IS: its primaryType, else all types."""
    primary = place.get("primaryType")
    return {primary} if primary else set(place.get("types") or ())


def review_count(place: Mapping[str, Any]) -> int | None:
    count = place.get("userRatingCount")
    if isinstance(count, bool) or not isinstance(count, int | float):
        return None
    return int(count)


def finalist_kind(place: Mapping[str, Any]) -> str:
    key = key_types(place)
    if key & VENUE_ROLLUP_NON_ROLLABLE_TYPES:
        return KIND_OTHER
    if key & VENUE_ROLLUP_SUB_POI_TYPES:
        return KIND_SUB_POI
    if all_types(place) & VENUE_ROLLUP_EVIDENCE_GATED_TYPES:
        return KIND_GATED
    return KIND_OTHER


def is_museum(place: Mapping[str, Any]) -> bool:
    return any(t == "museum" or t.endswith("_museum") for t in all_types(place))


def has_evidence(
    finalist: Mapping[str, Any],
    name: str,
    vision_result: VisionResult | None,
    scene_hints: Sequence[Any] | None,
    sign_text: Sequence[str] | None,
) -> bool:
    """Positive evidence that the photos are OF this food/drink/lodging/retail
    place (R6): a food hint, a matching vision category or business name, or a
    strong sign-text match to its name."""
    types = all_types(finalist)
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


def inside_viewport(place: Mapping[str, Any], lat: float, lng: float) -> bool:
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


def distance_m(place: Mapping[str, Any], lat: float, lng: float) -> float | None:
    location = place.get("location") or {}
    try:
        return haversine(lat, lng, location["latitude"], location["longitude"])
    except (KeyError, TypeError):
        return None


def parent_suggestion(
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
