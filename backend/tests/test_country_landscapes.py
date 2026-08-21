"""Country biome catalog: subregion defaults, overrides, seed alignment."""

import re
from pathlib import Path

from app.core.quiz_landscape import QUIZ_LANDSCAPE_VALUES
from app.services.country_landscapes import (
    COUNTRY_OVERRIDES,
    SUBREGION_DEFAULTS,
    landscapes_for,
)
from app.services.photo_vision.quiz_constants import QUIZ_ELIGIBILITY_RESPONSE_FORMAT

SEED_PATH = (
    Path(__file__).resolve().parents[1].parent / "supabase" / "seed" / "countries.sql"
)
SEED_CODE_RE = re.compile(r"\('([A-Z]{2})',")
SEED_SUBREGION_RE = re.compile(r"\('[A-Z]{2}', '[^']*', '[^']*', '([^']*)'")


def test_subregion_defaults_match_seed() -> None:
    seed = SEED_PATH.read_text()
    seed_subregions = set(SEED_SUBREGION_RE.findall(seed))
    assert seed_subregions == set(SUBREGION_DEFAULTS)


def test_override_codes_are_in_the_seed() -> None:
    seed_codes = set(SEED_CODE_RE.findall(SEED_PATH.read_text()))
    assert set(COUNTRY_OVERRIDES) <= seed_codes


def test_unknown_code_has_no_biomes() -> None:
    assert landscapes_for("ZZZ") == frozenset()
    assert landscapes_for("TH") == frozenset()  # needs subregion when no override
    assert landscapes_for("TH", "East & Southeast Asia") == frozenset({"tropical"})


def test_bulgaria_and_united_states_share_prairie_and_mediterranean() -> None:
    us = landscapes_for("US")
    bg = landscapes_for("BG")
    assert "prairie" in us and "prairie" in bg
    assert "mediterranean" in us and "mediterranean" in bg


def test_vision_schema_enum_matches_canonical_list() -> None:
    schema = QUIZ_ELIGIBILITY_RESPONSE_FORMAT["json_schema"]["schema"]
    assert schema["properties"]["landscape"]["enum"] == list(QUIZ_LANDSCAPE_VALUES)
