"""Unit tests for visited-first scenic quiz decoy ranking."""

from random import Random

import pytest

from app.services.quiz_decoys import (
    QuizDecoyPoolExhausted,
    parse_visited_codes,
    pick_decoys,
    score_country,
)

COUNTRIES = [
    ("BG", "Bulgaria"),
    ("US", "United States"),
    ("FR", "France"),
    ("JP", "Japan"),
    ("TH", "Thailand"),
    ("AR", "Argentina"),
    ("SG", "Singapore"),
]


def test_prairie_bulgaria_ranks_united_states_highest() -> None:
    """The motivating lookalike: Bulgarian grassland reads as the US plains."""
    assert score_country("US", "prairie", "BG") == 2
    assert score_country("FR", "prairie", "BG") == 1
    assert score_country("TH", "prairie", "BG") == 1


def test_visited_lookalikes_fill_before_unvisited() -> None:
    decoys = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape="prairie",
        countries=COUNTRIES,
        visited_codes={"BG", "US", "FR", "JP"},
        excluded_names={"Bulgaria"},
        rng=Random(0),
    )
    assert len(decoys) == 3
    assert "United States" in decoys
    assert set(decoys) <= {"United States", "France", "Japan"}
    assert "Bulgaria" not in decoys
    assert "Thailand" not in decoys


def test_thin_visited_set_pads_with_lookalikes() -> None:
    decoys = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape="prairie",
        countries=COUNTRIES,
        visited_codes={"BG", "US"},
        excluded_names={"Bulgaria"},
        rng=Random(0),
    )
    assert len(decoys) == 3
    assert "United States" in decoys
    assert "Argentina" in decoys  # unvisited prairie lookalike pads next


def test_zero_stamps_pads_entirely_from_lookalikes() -> None:
    decoys = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape="prairie",
        countries=COUNTRIES,
        visited_codes=set(),
        excluded_names={"Bulgaria"},
        rng=Random(0),
    )
    assert len(decoys) == 3
    assert "Bulgaria" not in decoys
    assert "United States" in decoys


def test_quiz_wide_correct_answers_are_not_decoys() -> None:
    decoys = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape="prairie",
        countries=COUNTRIES,
        visited_codes={"BG", "US", "FR", "JP"},
        excluded_names={"Bulgaria", "United States", "France"},
        rng=Random(0),
    )
    assert "United States" not in decoys
    assert "France" not in decoys
    assert "Japan" in decoys


def test_missing_landscape_falls_back_to_biome_overlap() -> None:
    assert score_country("US", None, "BG") == 1
    assert score_country("US", "other", "BG") == 1
    decoys = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape=None,
        countries=COUNTRIES,
        visited_codes={"BG", "US", "FR", "JP"},
        excluded_names={"Bulgaria"},
        rng=Random(0),
    )
    assert "United States" in decoys


def test_exhausted_pool_raises() -> None:
    with pytest.raises(QuizDecoyPoolExhausted):
        pick_decoys(
            correct_code="BG",
            correct_name="Bulgaria",
            photo_landscape="prairie",
            countries=[("BG", "Bulgaria"), ("US", "United States")],
            visited_codes={"BG", "US"},
            excluded_names={"Bulgaria"},
            rng=Random(0),
        )


def test_parse_visited_codes_ignores_malformed_rows() -> None:
    codes = parse_visited_codes(
        [
            {"country": {"code": "us", "name": "United States"}},
            {"country": None},
            {"country_id": "x"},
            {"country": {"name": "France"}},
        ]
    )
    assert codes == {"US"}
