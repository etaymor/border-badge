"""Canonical landscape vocabulary for the travel photo quiz.

Owned here so the vision JSON schema, finalize validator, and decoy scorer
cannot drift. Distinctive tags drive lookalike ranking; generic tags
(urban/coastal/other) never award a photo-match score.
"""

from __future__ import annotations

QUIZ_LANDSCAPE_VALUES: tuple[str, ...] = (
    "coastal",
    "mediterranean",
    "prairie",
    "alpine",
    "desert",
    "tropical",
    "temperate_forest",
    "urban",
    "other",
)

QUIZ_LANDSCAPE_SET: frozenset[str] = frozenset(QUIZ_LANDSCAPE_VALUES)

DISTINCTIVE_LANDSCAPES: frozenset[str] = frozenset(
    {
        "prairie",
        "mediterranean",
        "alpine",
        "desert",
        "tropical",
        "temperate_forest",
    }
)
