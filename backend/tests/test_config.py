"""Tests for application settings, focused on the place-matcher recall knobs.

These cover the U1 config layer: the PLACES_DIAGNOSTICS feature flag plus the
recall tunables migrated out of constants.py into Settings (defaults preserved
as the constants' values, env-overridable, validated bounds).
"""

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.services.place_matcher.constants import (
    MIN_QUALITY_RESULTS_BEFORE_STOP,
    MIN_REVIEW_COUNT,
)


def _settings(**env: str) -> Settings:
    """Build a Settings instance from explicit env values only.

    ``_env_file=None`` keeps the developer's local ``.env`` from leaking into
    the assertions about defaults.
    """
    return Settings(_env_file=None, **env)


class TestPlacesDiagnosticsFlag:
    def test_defaults_to_false(self) -> None:
        assert _settings().places_diagnostics is False

    def test_env_override_true(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PLACES_DIAGNOSTICS", "true")
        assert Settings(_env_file=None).places_diagnostics is True


class TestRecallTunableDefaults:
    def test_stop_threshold_default_matches_constant(self) -> None:
        assert (
            _settings().places_min_quality_results_before_stop
            == MIN_QUALITY_RESULTS_BEFORE_STOP
        )

    def test_review_count_default_matches_constant(self) -> None:
        assert _settings().places_min_review_count == MIN_REVIEW_COUNT

    def test_extra_search_tier_default_is_none(self) -> None:
        # No extra outer tier by default — preserves current DENSITY_SEARCH_RADII.
        assert _settings().places_extra_search_tier_m is None


class TestRecallTunableOverrides:
    def test_stop_threshold_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PLACES_MIN_QUALITY_RESULTS_BEFORE_STOP", "8")
        assert Settings(_env_file=None).places_min_quality_results_before_stop == 8

    def test_review_count_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PLACES_MIN_REVIEW_COUNT", "3")
        assert Settings(_env_file=None).places_min_review_count == 3

    def test_extra_search_tier_env_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PLACES_EXTRA_SEARCH_TIER_M", "200")
        assert Settings(_env_file=None).places_extra_search_tier_m == 200


class TestRecallTunableBounds:
    def test_review_count_rejects_negative(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_min_review_count=-1)

    def test_stop_threshold_rejects_zero(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_min_quality_results_before_stop=0)

    def test_stop_threshold_rejects_above_max(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_min_quality_results_before_stop=21)

    def test_extra_search_tier_rejects_below_min(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_extra_search_tier_m=10)
