"""Per-quiz funnel counters for the public quiz surface (R12/R16).

Four steps, recorded server-side and persisted as one counter row per
(quiz, event) in quiz_funnel:

- ``page_view``          -- once per /q/{slug} render
- ``session_started``    -- once per session, at the session INSERT
- ``session_completed``  -- once per session, at the FIRST completion
- ``install_cta_tap``    -- once per /q/{slug}/install redirect

Start/complete ride the session row's own lifecycle (insert / conditional
first-completion write), so refreshes, resumes, and replayed complete calls
never double count. The (quiz_id, event) keying keeps "started vs completed
per quiz" -- which is also the leaderboard harvest-pattern signal (KTD9) --
a single filtered read.

Writes go through the ``increment_quiz_funnel`` SQL function (migration
0060): an atomic insert-or-bump, so concurrent requests never lose counts to
read-modify-write races. Recording is best-effort: a failed counter write is
logged and swallowed -- analytics must never take down the play surface.
"""

import logging
from typing import Any

from app.core.analytics import QuizFunnelEvent, log_quiz_funnel_event
from app.db.session import SupabaseClient

logger = logging.getLogger(__name__)


async def record_quiz_funnel_event(
    db: SupabaseClient, quiz_id: Any, event: QuizFunnelEvent, slug: str
) -> None:
    """Log and persist one funnel step for one quiz. Never raises."""
    log_quiz_funnel_event(event, slug)
    try:
        await db.rpc(
            "increment_quiz_funnel",
            {"p_quiz_id": str(quiz_id), "p_event": event},
        )
    except Exception as e:  # counters are best-effort; never break the page
        logger.warning(
            "Failed to record quiz funnel event %s for quiz %s: %s",
            event,
            quiz_id,
            e,
        )
