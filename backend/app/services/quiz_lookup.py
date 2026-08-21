"""Shared-state slug resolution for the public quiz surfaces.

Every public /q/{slug} surface (playable page, JSON play API, unfurl card
image, install redirect) resolves the slug UNCACHED on each request and serves
only quizzes currently in state 'shared'. Unknown slugs, pre-share states
(which cannot hold a slug today, but the check is deliberately positive), and
revoked quizzes are indistinguishable not-founds -- a revoked slug must not
confirm that a quiz ever existed, and a revocation must cut off every surface
(mid-session included) at its very next request. Each caller keeps its own
not-found response shape (HTML gone page, bare 404, JSON HTTPException).
"""

from typing import Any

from app.db.session import SupabaseClient

# Superset of the fields any caller reads off the resolved quiz row.
_SHARED_QUIZ_SELECT = "id,owner_id,state,slug,score_to_beat_correct,score_to_beat_total"


async def fetch_shared_quiz_by_slug(
    db: SupabaseClient, slug: str
) -> dict[str, Any] | None:
    """The quiz this slug names iff it is currently 'shared'; None otherwise."""
    rows = await db.get(
        "quiz",
        {"slug": f"eq.{slug}", "select": _SHARED_QUIZ_SELECT},
    )
    quiz = rows[0] if rows else None
    if quiz is None or quiz.get("state") != "shared":
        return None
    return quiz
