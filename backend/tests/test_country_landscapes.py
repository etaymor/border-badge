"""Country biome catalog coverage and the Bulgaria/US lookalike pair."""

import re
from pathlib import Path

from app.services.country_landscapes import (
    COUNTRY_LANDSCAPES,
    landscapes_for,
)

SEED_PATH = (
    Path(__file__).resolve().parents[1].parent / "supabase" / "seed" / "countries.sql"
)
SEED_CODE_RE = re.compile(r"\('([A-Z]{2})',")


def test_catalog_covers_every_seed_country() -> None:
    seed_codes = set(SEED_CODE_RE.findall(SEED_PATH.read_text()))
    assert len(seed_codes) == 227
    assert set(COUNTRY_LANDSCAPES) == seed_codes


def test_unknown_code_has_no_biomes() -> None:
    assert landscapes_for("ZZZ") == frozenset()
    assert landscapes_for("xx") == frozenset()


def test_bulgaria_and_united_states_share_prairie_and_mediterranean() -> None:
    us = landscapes_for("US")
    bg = landscapes_for("BG")
    assert "prairie" in us and "prairie" in bg
    assert "mediterranean" in us and "mediterranean" in bg
