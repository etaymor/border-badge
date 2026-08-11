"""Read-time quiz leaderboard aggregation (KTD9) — the ONE implementation.

Shared by the anonymous public surface (``app/api/public_quiz.py``) and the
owner-facing board (``app/api/quiz.py``, R14): best score + attempt count
per canonicalized display name (trim, Unicode NFKC, casefold — AE4), a
distinct-name cap claimed in first-completion order, sorted best score first
with earliest first completion breaking ties.

The cap and top-N sizes are parameters (defaulting to the module constants)
so callers can pass their own module-level constants — the public endpoints
resolve theirs at call time, which keeps them monkeypatchable in tests.
"""

import unicodedata
from typing import Any

from app.db.session import SupabaseClient

# KTD9: at most this many DISTINCT canonicalized names ever join a quiz's
# board, claimed in first-completion order. Existing names update forever.
QUIZ_LEADERBOARD_MAX_NAMES = 100
# Public reads serve at most the top N rows (plus the player's own standing
# when it falls outside the top N in the completion response).
QUIZ_LEADERBOARD_TOP_N = 50

# Owner play sessions share the quiz_session table with anonymous ones (KTD4:
# one grading path); the token prefix is what distinguishes them, and they are
# born hidden so they can never surface on the public leaderboard.
OWNER_SESSION_TOKEN_PREFIX = "owner-"


def canonical_name(name: str) -> str:
    """AE4 leaderboard identity: Unicode NFKC, trimmed, case-folded."""
    return unicodedata.normalize("NFKC", name).strip().casefold()


def is_public_session(row: dict[str, Any]) -> bool:
    return not str(row.get("token", "")).startswith(OWNER_SESSION_TOKEN_PREFIX)


async def completed_public_sessions(
    db: SupabaseClient, quiz_id: Any, *, include_hidden: bool = False
) -> list[dict[str, Any]]:
    """Every session eligible for the leaderboard: completed, named, non-owner.

    Hidden filtering happens here — a hidden session is never served anywhere
    on the public surface. The owner view passes ``include_hidden=True`` to
    keep hidden sessions in the fold (they render marked, not removed).
    """
    rows = await db.get(
        "quiz_session",
        {"quiz_id": f"eq.{quiz_id}", "completed_at": "not.is.null"},
    )
    return [
        r
        for r in rows
        if is_public_session(r)
        and (include_hidden or not r.get("hidden"))
        and (r.get("display_name") or "").strip()
    ]


def aggregate_leaderboard(
    sessions: list[dict[str, Any]],
    max_names: int = QUIZ_LEADERBOARD_MAX_NAMES,
) -> list[dict[str, Any]]:
    """READ-TIME aggregation (KTD9): one row per canonicalized name.

    Sessions fold in first-completion order, so the distinct-name cap is
    deterministic: the first ``max_names`` names to complete own the board
    permanently, and a later new name never displaces them — while replays of
    existing names keep updating best score and attempts straight through the
    cap. The displayed raw name follows the best-scoring attempt. Each group
    also carries its contributing ``session_ids`` (fold order) so the owner
    surface can act on every session behind an entry. Returned entries are
    sorted best score first, earliest first completion breaking ties.
    """
    groups: dict[str, dict[str, Any]] = {}
    for s in sorted(sessions, key=lambda r: str(r.get("completed_at") or "")):
        raw = str(s.get("display_name") or "").strip()
        key = canonical_name(raw)
        if not key:
            continue
        score = int(s.get("score") or 0)
        group = groups.get(key)
        if group is None:
            if len(groups) >= max_names:
                continue  # board full: new names no longer join (KTD9 cap)
            groups[key] = {
                "key": key,
                "display_name": raw,
                "best_score": score,
                "attempts": 1,
                "first_completed_at": str(s.get("completed_at") or ""),
                "session_ids": [s["id"]],
            }
        else:
            group["attempts"] += 1
            group["session_ids"].append(s["id"])
            if score > group["best_score"]:
                group["best_score"] = score
                group["display_name"] = raw
    return sorted(
        groups.values(),
        key=lambda g: (-g["best_score"], g["first_completed_at"]),
    )


def top_entries(
    entries: list[dict[str, Any]],
    viewer_key: str | None = None,
    top_n: int = QUIZ_LEADERBOARD_TOP_N,
) -> list[dict[str, Any]]:
    """The top N rows, plus the viewer's own standing when outside them."""
    top = entries[:top_n]
    if viewer_key is not None and all(e["key"] != viewer_key for e in top):
        own = next((e for e in entries if e["key"] == viewer_key), None)
        if own is not None:
            top = [*top, own]
    return top
