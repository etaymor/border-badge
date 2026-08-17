"""Integrity checks for the place-matcher eval datasets.

The eval harness (scripts/eval_place_matcher.py) silently skips malformed
samples, so a typo'd expected_place_id or a broken places[] entry would
shrink the effective dataset without failing the gate. These tests make
dataset drift loud.
"""

import json
from pathlib import Path

import pytest

from app.services.photo_vision.constants import (
    VISION_CATEGORIES,
    VISION_CONFIDENCE_LEVELS,
)

DOCS_DIR = Path(__file__).parent.parent.parent / "docs"

DATASET_FILES = [
    DOCS_DIR / "place_matcher_eval_dataset.sample.json",
]


def _load(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, list) and data, f"{path.name} must be a non-empty array"
    return data


def _vision_dicts(sample: dict) -> list[dict]:
    raw_list = sample.get("vision_results")
    if isinstance(raw_list, list):
        return [item for item in raw_list if isinstance(item, dict)]
    raw = sample.get("vision_result")
    return [raw] if isinstance(raw, dict) else []


@pytest.mark.parametrize("path", DATASET_FILES, ids=lambda p: p.name)
class TestEvalDatasetIntegrity:
    def test_ids_unique(self, path: Path) -> None:
        ids = [sample.get("id") for sample in _load(path)]
        assert all(ids), "every sample needs a non-empty id"
        assert len(ids) == len(set(ids)), f"duplicate sample ids in {path.name}"

    def test_expected_place_present_in_world(self, path: Path) -> None:
        for sample in _load(path):
            expected = sample.get("expected_place_id")
            assert expected, f"{sample.get('id')}: missing expected_place_id"
            place_ids = {p.get("id") for p in sample.get("places", [])}
            assert (
                expected in place_ids
            ), f"{sample['id']}: expected_place_id {expected!r} not in places[]"

    def test_cluster_geometry_complete(self, path: Path) -> None:
        for sample in _load(path):
            centroid = sample.get("cluster", {}).get("centroid", {})
            assert (
                "latitude" in centroid and "longitude" in centroid
            ), f"{sample['id']}: cluster.centroid must carry latitude/longitude"
            for place in sample.get("places", []):
                assert place.get("displayName", {}).get(
                    "text"
                ), f"{sample['id']}: place {place.get('id')} missing displayName.text"
                loc = place.get("location", {})
                assert (
                    "latitude" in loc and "longitude" in loc
                ), f"{sample['id']}: place {place.get('id')} missing location"

    def test_vision_fields_valid(self, path: Path) -> None:
        for sample in _load(path):
            for vision in _vision_dicts(sample):
                category = vision.get("category")
                assert (
                    category in VISION_CATEGORIES
                ), f"{sample['id']}: invalid vision category {category!r}"
                confidence = vision.get("confidence")
                assert (
                    confidence in VISION_CONFIDENCE_LEVELS
                ), f"{sample['id']}: invalid vision confidence {confidence!r}"


def test_paris_recall_safety_guard_row_exists() -> None:
    """The hotel guard row pins the lodging-demotion escape hatch (vision=stay).

    If it is ever removed or its vision category drifts off "stay", the
    demotion could silently start hiding users' real hotels.
    """
    sample = _load(DOCS_DIR / "place_matcher_eval_dataset.sample.json")
    guard = next((s for s in sample if s["id"] == "paris-actual-hotel-stay"), None)
    assert guard is not None, "paris-actual-hotel-stay guard row is required"
    assert guard["vision_result"]["category"] == "stay"
