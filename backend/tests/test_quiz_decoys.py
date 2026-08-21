"""Unit tests for visited-first scenic quiz decoy ranking."""

from random import Random

import pytest

from app.services.quiz_decoys import (
    QuizDecoyPoolExhausted,
    pick_decoys,
    score_country,
    visited_codes_from_rows,
)

COUNTRIES = [
    ("BG", "Bulgaria", "Eastern Europe"),
    ("US", "United States", "North America"),
    ("FR", "France", "Core Europe"),
    ("JP", "Japan", "East & Southeast Asia"),
    ("TH", "Thailand", "East & Southeast Asia"),
    ("AR", "Argentina", "South America"),
    ("SG", "Singapore", "East & Southeast Asia"),
    ("CH", "Switzerland", "Core Europe"),
    ("DE", "Germany", "Core Europe"),
    ("NZ", "New Zealand", "Australia & New Zealand"),
]


def test_prairie_bulgaria_ranks_united_states_and_not_thailand() -> None:
    """The motivating lookalike: grassland reads as the US, not Thailand."""
    assert (
        score_country(
            "US",
            "prairie",
            "BG",
            candidate_subregion="North America",
            correct_subregion="Eastern Europe",
        )
        == 2
    )
    assert (
        score_country(
            "AR",
            "prairie",
            "BG",
            candidate_subregion="South America",
            correct_subregion="Eastern Europe",
        )
        == 2
    )
    assert (
        score_country(
            "FR",
            "prairie",
            "BG",
            candidate_subregion="Core Europe",
            correct_subregion="Eastern Europe",
        )
        == 1
    )
    assert (
        score_country(
            "TH",
            "prairie",
            "BG",
            candidate_subregion="East & Southeast Asia",
            correct_subregion="Eastern Europe",
        )
        == 0
    )


def test_urban_photo_never_awards_score_two() -> None:
    for code, _name, subregion in COUNTRIES:
        assert (
            score_country(
                code,
                "urban",
                "BG",
                candidate_subregion=subregion,
                correct_subregion="Eastern Europe",
            )
            != 2
        )


def test_visited_prefers_lookalikes_and_reserves_an_unvisited_slot() -> None:
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
    assert "Thailand" not in decoys
    assert "Bulgaria" not in decoys
    visited_decoys = set(decoys) & {"United States", "France", "Japan"}
    assert len(visited_decoys) <= 2
    assert set(decoys) - {"United States", "France", "Japan"}


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
    assert "Argentina" in decoys


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


def test_missing_landscape_falls_back_to_distinctive_overlap() -> None:
    assert (
        score_country(
            "US",
            None,
            "BG",
            candidate_subregion="North America",
            correct_subregion="Eastern Europe",
        )
        == 1
    )
    decoys = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape=None,
        countries=COUNTRIES,
        visited_codes={"BG", "US", "FR", "JP"},
        excluded_names={"Bulgaria"},
        rng=Random(0),
    )
    assert "Thailand" not in decoys
    assert "Singapore" not in decoys


def test_used_decoys_are_not_copied_onto_the_next_question() -> None:
    visited = {"US", "FR", "JP", "CH", "DE", "NZ"}
    first = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape="prairie",
        countries=COUNTRIES,
        visited_codes=visited,
        excluded_names={"Bulgaria"},
        rng=Random(1),
    )
    second = pick_decoys(
        correct_code="BG",
        correct_name="Bulgaria",
        photo_landscape="prairie",
        countries=COUNTRIES,
        visited_codes=visited,
        excluded_names={"Bulgaria"},
        used_names=set(first),
        rng=Random(1),
    )
    assert set(first) != set(second)


def test_exhausted_pool_raises() -> None:
    with pytest.raises(QuizDecoyPoolExhausted):
        pick_decoys(
            correct_code="BG",
            correct_name="Bulgaria",
            photo_landscape="prairie",
            countries=[
                ("BG", "Bulgaria", "Eastern Europe"),
                ("US", "United States", "North America"),
            ],
            visited_codes={"BG", "US"},
            excluded_names={"Bulgaria"},
            rng=Random(0),
        )


def test_visited_codes_join_on_country_id() -> None:
    countries = [
        {"id": "id-us", "code": "us", "name": "United States"},
        {"id": "id-fr", "code": "FR", "name": "France"},
    ]
    visited = [
        {"country_id": "id-us"},
        {"country_id": None},
        {"country_id": "missing"},
    ]
    assert visited_codes_from_rows(countries, visited) == {"US"}
