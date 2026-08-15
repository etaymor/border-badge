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


class TestEnrichBackfillLimit:
    """U4: bounded second enrichment batch for gate-dropped finalists."""

    def test_default_is_three(self) -> None:
        assert _settings().places_enrich_backfill_limit == 3

    def test_zero_disables_second_batch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PLACES_ENRICH_BACKFILL_LIMIT", "0")
        assert Settings(_env_file=None).places_enrich_backfill_limit == 0

    def test_rejects_negative(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_enrich_backfill_limit=-1)

    def test_rejects_above_max(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_enrich_backfill_limit=11)


class TestLandmarkRescueKnobs:
    """U5: landmark text-rescue flag + bias radius."""

    def test_rescue_default_on(self) -> None:
        assert _settings().places_landmark_text_rescue is True

    def test_bias_radius_default(self) -> None:
        assert _settings().places_landmark_rescue_bias_radius_m == 500

    def test_rescue_env_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PLACES_LANDMARK_TEXT_RESCUE", "false")
        assert Settings(_env_file=None).places_landmark_text_rescue is False

    def test_bias_radius_bounds(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_landmark_rescue_bias_radius_m=10)
        with pytest.raises(ValidationError):
            _settings(places_landmark_rescue_bias_radius_m=5000)


class TestPopularityProbeKnob:
    """U6: last-resort POPULARITY Nearby probe, default OFF."""

    def test_default_off(self) -> None:
        assert _settings().places_popularity_probe is False

    def test_env_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PLACES_POPULARITY_PROBE", "true")
        assert Settings(_env_file=None).places_popularity_probe is True


class TestTypePriorKnobs:
    """U3: lodging demotion + landmark boost ranking knobs."""

    def test_lodging_penalty_default(self) -> None:
        assert _settings().places_rank_lodging_penalty == 2.5

    def test_landmark_boost_default(self) -> None:
        assert _settings().places_rank_landmark_boost == 1.5

    def test_lodging_penalty_env_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PLACES_RANK_LODGING_PENALTY", "0")
        assert Settings(_env_file=None).places_rank_lodging_penalty == 0.0

    def test_landmark_boost_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PLACES_RANK_LANDMARK_BOOST", "3.0")
        assert Settings(_env_file=None).places_rank_landmark_boost == 3.0

    def test_lodging_penalty_rejects_negative(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_rank_lodging_penalty=-0.5)

    def test_landmark_boost_rejects_above_max(self) -> None:
        with pytest.raises(ValidationError):
            _settings(places_rank_landmark_boost=11.0)


class TestQuizClassificationCaps:
    """Spend controls for the quiz vision eligibility gate.

    These bounds are load-bearing rather than cosmetic: an out-of-range env
    value fails validation at import time and takes the whole API down, so the
    accepted range is part of the deploy contract documented in
    ``backend/.env.example`` and ``docs/environment-setup.md``.
    """

    def test_per_quiz_budget_default(self) -> None:
        assert _settings().quiz_classification_budget_per_quiz == 70

    def test_daily_cap_default(self) -> None:
        assert _settings().quiz_classification_daily_cap == 50_000

    def test_per_quiz_budget_env_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("QUIZ_CLASSIFICATION_BUDGET_PER_QUIZ", "120")
        assert Settings(_env_file=None).quiz_classification_budget_per_quiz == 120

    def test_daily_cap_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("QUIZ_CLASSIFICATION_DAILY_CAP", "1000")
        assert Settings(_env_file=None).quiz_classification_daily_cap == 1000

    @pytest.mark.parametrize("value", [1, 500])
    def test_per_quiz_budget_accepts_inclusive_bounds(self, value: int) -> None:
        settings = _settings(quiz_classification_budget_per_quiz=value)
        assert settings.quiz_classification_budget_per_quiz == value

    @pytest.mark.parametrize("value", [0, -1, 501])
    def test_per_quiz_budget_rejects_out_of_range(self, value: int) -> None:
        with pytest.raises(ValidationError):
            _settings(quiz_classification_budget_per_quiz=value)

    @pytest.mark.parametrize("value", [0, 1_000_000])
    def test_daily_cap_accepts_inclusive_bounds(self, value: int) -> None:
        """0 is a legal emergency stop, not a validation error."""
        settings = _settings(quiz_classification_daily_cap=value)
        assert settings.quiz_classification_daily_cap == value

    @pytest.mark.parametrize("value", [-1, 1_000_001])
    def test_daily_cap_rejects_out_of_range(self, value: int) -> None:
        with pytest.raises(ValidationError):
            _settings(quiz_classification_daily_cap=value)
