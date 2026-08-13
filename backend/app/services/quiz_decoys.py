"""Quiz country-option generation: visited stamps first, scenic lookalikes pad.

Replaces region-neighbor sampling (KTD6). Options are still shuffled once at
creation and stored with a server-only correct index so owner and players
answer identical questions.
"""

from __future__ import annotations

import random
from typing import Any

from app.db.session import SupabaseClient
from app.services.country_landscapes import landscapes_for

DECOYS_PER_QUESTION = 3


class QuizDecoyPoolExhausted(Exception):
    """Fewer than three valid decoy countries exist after exclusions."""


def score_country(
    code: str,
    photo_landscape: str | None,
    correct_code: str,
) -> int:
    """Rank a candidate against the photo and the correct country.

    2 — country is tagged with the photo's landscape.
    1 — country shares any biome with the correct country.
    0 — otherwise.
    """
    biomes = landscapes_for(code)
    landscape = _usable_landscape(photo_landscape)
    if landscape and landscape in biomes:
        return 2
    if biomes & landscapes_for(correct_code):
        return 1
    return 0


def pick_decoys(
    *,
    correct_code: str,
    correct_name: str,
    photo_landscape: str | None,
    countries: list[tuple[str, str]],
    visited_codes: set[str],
    excluded_names: set[str],
    rng: random.Random | None = None,
) -> list[str]:
    """Return three decoy country names, preferring visited lookalikes.

    ``excluded_names`` must already include every other question's correct
    answer. The correct country itself is never a decoy.
    """
    picker = rng or random.Random()
    blocked = set(excluded_names) | {correct_name}

    visited: list[tuple[int, str]] = []
    unvisited: list[tuple[int, str]] = []
    for code, name in countries:
        if name in blocked:
            continue
        scored = (score_country(code, photo_landscape, correct_code), name)
        if code in visited_codes:
            visited.append(scored)
        else:
            unvisited.append(scored)

    decoys = _sample_ranked(visited, DECOYS_PER_QUESTION, picker)
    if len(decoys) < DECOYS_PER_QUESTION:
        already = set(decoys)
        pad_pool = [(s, n) for s, n in unvisited if n not in already]
        decoys.extend(
            _sample_ranked(pad_pool, DECOYS_PER_QUESTION - len(decoys), picker)
        )

    if len(decoys) < DECOYS_PER_QUESTION:
        raise QuizDecoyPoolExhausted(
            "Not enough countries available to build quiz options"
        )
    return decoys


def _usable_landscape(landscape: str | None) -> str | None:
    if landscape is None or landscape == "other":
        return None
    return landscape


def _sample_ranked(
    pool: list[tuple[int, str]],
    n: int,
    rng: random.Random,
) -> list[str]:
    """Take ``n`` names, highest score first, random among ties."""
    if n <= 0 or not pool:
        return []
    by_score: dict[int, list[str]] = {2: [], 1: [], 0: []}
    for score, name in pool:
        by_score[score].append(name)

    picked: list[str] = []
    for score in (2, 1, 0):
        need = n - len(picked)
        if need <= 0:
            break
        bucket = by_score[score]
        if len(bucket) <= need:
            picked.extend(bucket)
        else:
            picked.extend(rng.sample(bucket, need))
    return picked


def parse_visited_codes(rows: list[dict[str, Any]]) -> set[str]:
    """Extract ISO codes from ``user_countries`` rows with a nested country."""
    codes: set[str] = set()
    for row in rows:
        nested = row.get("country")
        if isinstance(nested, dict):
            code = nested.get("code")
            if isinstance(code, str) and code:
                codes.add(code.upper())
    return codes


async def fetch_visited_codes(db: SupabaseClient, owner_id: str) -> set[str]:
    rows = await db.get(
        "user_countries",
        {
            "user_id": f"eq.{owner_id}",
            "status": "eq.visited",
            "select": "country_id,country:country_id(code,name)",
        },
    )
    return parse_visited_codes(rows)


async def build_place_options(
    db: SupabaseClient,
    corrects: list[dict[str, Any]],
    *,
    owner_id: str,
    landscapes: list[str | None] | None = None,
    extra_excluded: set[str] | None = None,
    rng: random.Random | None = None,
) -> list[tuple[list[str], int]]:
    """Generate per-question options: correct country plus three decoys.

    Decoys prefer the owner's visited stamps, ranked by scenic similarity,
    then pad with unvisited lookalikes so every question still has four
    options. Decoys never duplicate any correct answer in the quiz.
    """
    if landscapes is None:
        landscapes = [None] * len(corrects)
    if len(landscapes) != len(corrects):
        raise ValueError("landscapes must align with corrects")

    country_rows = await db.get("country", {"select": "code,name"})
    countries = [(r["code"], r["name"]) for r in country_rows]
    visited_codes = await fetch_visited_codes(db, owner_id)

    excluded = {c["name"] for c in corrects} | set(extra_excluded or ())
    picker = rng or random.Random()
    results: list[tuple[list[str], int]] = []
    for correct, landscape in zip(corrects, landscapes, strict=True):
        decoys = pick_decoys(
            correct_code=correct["code"],
            correct_name=correct["name"],
            photo_landscape=landscape,
            countries=countries,
            visited_codes=visited_codes,
            excluded_names=excluded,
            rng=picker,
        )
        options = [correct["name"], *decoys]
        picker.shuffle(options)
        results.append((options, options.index(correct["name"])))
    return results
