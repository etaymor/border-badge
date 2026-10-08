"""Shared builders for the venue-probe tests (U6)."""

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.services.place_matcher import (
    MIN_REVIEW_COUNT,
    DensityLevel,
    PlaceMatcher,
)
from app.services.place_matcher._matcher_search import TieredSearchResult

LOUVRE_LAT = 48.86103
LOUVRE_LNG = 2.33583


# ---------------------------------------------------------------------------
# Fixtures and builders
# ---------------------------------------------------------------------------


def _place(
    place_id: str,
    name: str,
    primary_type: str,
    types: list[str] | None = None,
    *,
    lat: float = LOUVRE_LAT,
    lng: float = LOUVRE_LNG,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": place_id,
        "displayName": {"text": name},
        "formattedAddress": "Paris",
        "location": {"latitude": lat, "longitude": lng},
        "primaryType": primary_type,
        "types": types or [primary_type, "point_of_interest", "establishment"],
        "businessStatus": "OPERATIONAL",
        **extra,
    }


def _louvre() -> dict[str, Any]:
    return _place(
        "louvre",
        "Louvre Museum",
        "art_museum",
        ["art_museum", "tourist_attraction", "museum", "point_of_interest"],
        lat=48.86061,
        lng=2.33764,
        rating=4.7,
        userRatingCount=378404,
        viewport={
            "low": {"latitude": 48.85955, "longitude": 2.33373},
            "high": {"latitude": 48.86225, "longitude": 2.33985},
        },
    )


def _attraction_world() -> list[dict[str, Any]]:
    """Four attraction / gallery candidates, like a DENSE Louvre courtyard."""
    return [
        _place("pyramid", "Louvre Pyramid", "cultural_landmark"),
        _place("dept-islam", "Departement des Arts de l'Islam", "museum"),
        _place("galerie", "Galerie d'Apollon", "art_gallery"),
        _place(
            "victoire",
            "Victoire de Samothrace",
            "sculpture",
            ["sculpture", "tourist_attraction", "point_of_interest"],
        ),
    ]


def _restaurant_world() -> list[dict[str, Any]]:
    return [
        _place("bistrot", "Bistrot Benoit", "restaurant", ["restaurant", "food"]),
        _place("paul", "Paul", "sandwich_shop", ["sandwich_shop", "cafe", "food"]),
        _place("marly", "Le Cafe Marly", "restaurant", ["restaurant", "cafe"]),
        _place("apt", "Superb Apartment Louvre", "lodging", ["lodging"]),
    ]


def _tiered(places: list[dict], density: DensityLevel) -> TieredSearchResult:
    return TieredSearchResult(
        places=places,
        radius_used=15,
        radii_searched={15},
        raw_count_per_radius={15: len(places)},
        raw_places_per_radius={},
        stopped_early=bool(places),
        density=density,
    )


def _cluster(
    cluster_id: str = "cluster-1",
    lat: float = LOUVRE_LAT,
    lng: float = LOUVRE_LNG,
) -> dict[str, Any]:
    return {
        "id": cluster_id,
        "centroid": {"latitude": lat, "longitude": lng},
        "photos": [{"asset_id": f"{cluster_id}-photo-1"}],
    }


def _ok_response(places: list[dict] | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"places": places if places is not None else []}
    return response


def _status_response(status: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status
    response.text = "upstream error"
    response.json.return_value = {"error": {"status": "RESOURCE_EXHAUSTED"}}
    return response


def make_settings(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """A settings stand-in with the venue probe ON, installed for PlaceMatcher."""
    settings = MagicMock()
    settings.google_places_api_key = "test-key"
    settings.places_api_timeout_seconds = 5.0
    settings.places_cluster_timeout_seconds = 15.0
    settings.places_min_quality_results_before_stop = 5
    settings.places_diagnostics = False
    settings.places_extra_search_tier_m = None
    settings.places_min_review_count = MIN_REVIEW_COUNT
    settings.places_text_rescue_on_empty = False
    settings.places_landmark_text_rescue = True
    settings.places_landmark_rescue_bias_radius_m = 500
    settings.places_enrich_backfill_limit = 3
    settings.places_popularity_probe = False
    settings.places_venue_probe = True
    settings.places_venue_probe_radius_m = 400
    monkeypatch.setattr(
        "app.services.place_matcher.matcher.get_settings", lambda: settings
    )
    return settings


def _wire_flow(
    matcher: PlaceMatcher,
    monkeypatch: pytest.MonkeyPatch,
    nearby: list[dict],
    density: DensityLevel,
    probe_result: list[dict] | BaseException | None = None,
    ratings: dict[str, dict[str, Any]] | None = None,
) -> list[tuple[float, float]]:
    """Mock the search, the probe and enrichment; return the probe call log."""

    async def mock_search_nearby_tiered(latitude, longitude):
        return _tiered(nearby, density)

    probe_calls: list[tuple[float, float]] = []

    async def mock_probe(latitude, longitude):
        probe_calls.append((latitude, longitude))
        if isinstance(probe_result, BaseException):
            raise probe_result
        return list(probe_result or [])

    async def mock_enrich(place_ids):
        return {pid: r for pid, r in (ratings or {}).items() if pid in place_ids}

    monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
    monkeypatch.setattr(matcher, "_execute_venue_probe", mock_probe)
    monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)
    return probe_calls
