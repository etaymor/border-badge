"""Quiz country-option generation: visited stamps first, scenic lookalikes pad.

Replaces region-neighbor sampling (KTD6). Options are still shuffled once at
creation and stored with a server-only correct index so owner and players
answer identical questions.
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

from app.core.quiz_landscape import DISTINCTIVE_LANDSCAPES
from app.db.session import SupabaseClient
from app.services.country_landscapes import landscapes_for

DECOYS_PER_QUESTION = 3
# When an unused unvisited distinctive lookalike exists, keep one slot for it
# so leftover stamps are not copy-pasted onto every question.
MAX_VISITED_WHEN_LOOKALIKE = 2

CountryRow = tuple[str, str, str | None]  # code, name, subregion


class QuizDecoyPoolExhausted(Exception):
    """Fewer than three valid decoy countries exist after exclusions."""


def score_country(
    code: str,
    photo_landscape: str | None,
    correct_code: str,
    *,
    candidate_subregion: str | None = None,
    correct_subregion: str | None = None,
) -> int:
    """Rank a candidate against the photo and the correct country.

    2 — photo tag is distinctive and the candidate country has it.
    1 — candidate and correct country share a distinctive biome.
    0 — otherwise. urban/coastal/other never award a photo-match score.
    """
    biomes = landscapes_for(code, candidate_subregion)
    landscape = _usable_landscape(photo_landscape)
    if landscape and landscape in biomes:
        return 2
    if _distinctive(biomes) & _distinctive(
        landscapes_for(correct_code, correct_subregion)
    ):
        return 1
    return 0


def pick_decoys(
    *,
    correct_code: str,
    correct_name: str,
    photo_landscape: str | None,
    countries: list[CountryRow],
    visited_codes: set[str],
    excluded_names: set[str],
    used_names: set[str] | None = None,
    rng: random.Random | None = None,
) -> list[str]:
    """Return three decoy country names, preferring unused visited lookalikes.

    Caps visited fill at two when an unused unvisited distinctive lookalike
    exists, so each question can take a fresh scenic distractor. ``used_names``
    are deprioritized within a score bucket, not hard-excluded.
    """
    picker = rng or random.Random()
    used = used_names or set()
    blocked = set(excluded_names) | {correct_name}
    subregions = {code: sub for code, _name, sub in countries}

    visited: list[tuple[int, str]] = []
    unvisited: list[tuple[int, str]] = []
    for code, name, subregion in countries:
        if name in blocked:
            continue
        scored = (
            score_country(
                code,
                photo_landscape,
                correct_code,
                candidate_subregion=subregion,
                correct_subregion=subregions.get(correct_code),
            ),
            name,
        )
        if code in visited_codes:
            visited.append(scored)
        else:
            unvisited.append(scored)

    unused_unvisited_lookalikes = [
        item for item in unvisited if item[0] >= 1 and item[1] not in used
    ]
    visited_limit = (
        MAX_VISITED_WHEN_LOOKALIKE
        if unused_unvisited_lookalikes
        else DECOYS_PER_QUESTION
    )

    decoys = _sample_ranked(visited, visited_limit, picker, used)
    if len(decoys) < DECOYS_PER_QUESTION:
        already = set(decoys)
        pad_pool = [(s, n) for s, n in unvisited if n not in already]
        decoys.extend(
            _sample_ranked(pad_pool, DECOYS_PER_QUESTION - len(decoys), picker, used)
        )

    if len(decoys) < DECOYS_PER_QUESTION:
        raise QuizDecoyPoolExhausted(
            "Not enough countries available to build quiz options"
        )
    return decoys


def _usable_landscape(landscape: str | None) -> str | None:
    if landscape not in DISTINCTIVE_LANDSCAPES:
        return None
    return landscape


def _distinctive(biomes: frozenset[str]) -> frozenset[str]:
    return biomes & DISTINCTIVE_LANDSCAPES


def _sample_ranked(
    pool: list[tuple[int, str]],
    n: int,
    rng: random.Random,
    used_names: set[str],
) -> list[str]:
    """Take ``n`` names, highest score first; unused before used in a bucket."""
    if n <= 0 or not pool:
        return []
    by_score: dict[int, list[str]] = {2: [], 1: [], 0: []}
    for score, name in pool:
        by_score[score].append(name)

    picked: list[str] = []
    for score in (2, 1, 0):
        unused = [name for name in by_score[score] if name not in used_names]
        reused = [name for name in by_score[score] if name in used_names]
        for bucket in (unused, reused):
            need = n - len(picked)
            if need <= 0:
                return picked
            if len(bucket) <= need:
                picked.extend(bucket)
            else:
                picked.extend(rng.sample(bucket, need))
    return picked


def visited_codes_from_rows(
    country_rows: list[dict[str, Any]],
    visited_rows: list[dict[str, Any]],
) -> set[str]:
    """Join visited ``country_id`` rows onto the country table in process."""
    id_to_code = {
        str(row["id"]): str(row["code"]).upper()
        for row in country_rows
        if row.get("id") and row.get("code")
    }
    codes: set[str] = set()
    for row in visited_rows:
        country_id = row.get("country_id")
        if country_id is None:
            continue
        code = id_to_code.get(str(country_id))
        if code:
            codes.add(code)
    return codes


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

    country_rows, visited_rows = await asyncio.gather(
        db.get("country", {"select": "id,code,name,subregion"}),
        db.get(
            "user_countries",
            {
                "user_id": f"eq.{owner_id}",
                "status": "eq.visited",
                "select": "country_id",
            },
        ),
    )
    countries: list[CountryRow] = [
        (r["code"], r["name"], r.get("subregion")) for r in country_rows
    ]
    visited_codes = visited_codes_from_rows(country_rows, visited_rows)

    excluded = {c["name"] for c in corrects} | set(extra_excluded or ())
    picker = rng or random.Random()
    used_names: set[str] = set()
    results: list[tuple[list[str], int]] = []
    for correct, landscape in zip(corrects, landscapes, strict=True):
        decoys = pick_decoys(
            correct_code=correct["code"],
            correct_name=correct["name"],
            photo_landscape=landscape,
            countries=countries,
            visited_codes=visited_codes,
            excluded_names=excluded,
            used_names=used_names,
            rng=picker,
        )
        used_names.update(decoys)
        options = [correct["name"], *decoys]
        picker.shuffle(options)
        results.append((options, options.index(correct["name"])))
    return results
