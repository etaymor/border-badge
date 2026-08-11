"""Anonymous public quiz play API (U8): the /q/{slug}/* JSON endpoints.

The server side of the contract `quiz-play.js` (U7) codes against. Design
invariants:

- Every endpoint resolves the slug UNCACHED and serves only state 'shared';
  unknown, pre-share, and revoked quizzes are indistinguishable 404s --
  mid-session included, so a revocation ends running games immediately.
- No auth: sessions are identified by an unguessable opaque bearer token
  minted server-side (`secrets.token_urlsafe`). Every session lookup filters
  by quiz_id, so a token from one quiz can never touch another.
- Grading goes through `app.services.quiz_grading.grade_answer` -- the ONE
  grading code path shared with owner play (KTD4). Scores are always
  server-computed from recorded answers; clients never submit scores.
- The leaderboard is a READ-TIME aggregation (KTD9) over completed,
  non-hidden, non-owner sessions: best score + attempt count per
  canonicalized display name (trim, Unicode NFKC, casefold -- AE4). There is
  no cached best-score column. A per-quiz cap bounds the number of distinct
  names (first-completion order); once full, new names still get their score
  back with a `leaderboard_full` indicator while existing names keep
  updating through the cap.
- Owner sessions (token prefix 'owner-', born hidden) never surface here;
  the owner's result rides along separately as the quiz's score-to-beat pair.

Quiz tables are backend-only (RLS with no user policies), so everything uses
the service-role client; authorization is the slug + token pair.
"""

import logging
import secrets
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Path, Request, Response, status

from app.db.session import SupabaseClient, get_supabase_client
from app.main import limiter
from app.schemas.quiz import (
    PublicAnsweredQuestion,
    PublicCompleteLeaderboardEntry,
    PublicLeaderboardEntry,
    PublicQuizAnswerRequest,
    PublicQuizAnswerResponse,
    PublicQuizCompleteRequest,
    PublicQuizCompleteResponse,
    PublicQuizLeaderboardResponse,
    PublicQuizSessionRequest,
    PublicQuizSessionResponse,
    ScoreToBeat,
)
from app.services.quiz_funnel import record_quiz_funnel_event
from app.services.quiz_grading import grade_answer

# The aggregation implementation lives in app/services/quiz_leaderboard.py —
# ONE implementation shared with the owner-facing board (U11). The size
# constants are re-imported here as module attributes (monkeypatchable in
# tests) and passed explicitly at each call site.
from app.services.quiz_leaderboard import (
    QUIZ_LEADERBOARD_MAX_NAMES,
    QUIZ_LEADERBOARD_TOP_N,
    aggregate_leaderboard,
    canonical_name,
    completed_public_sessions,
    is_public_session,
    top_entries,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["public-quiz"])

_SESSION_TOKEN_MINT_ATTEMPTS = 3

# Mirrors the /q/{slug} page route's slug handling (U7): minted slugs are
# lowercase hex, and nothing outside this alphabet ever reaches the DB.
SlugPath = Path(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


async def _get_shared_quiz(db: SupabaseClient, slug: str) -> dict[str, Any]:
    """Resolve the slug iff the quiz is currently 'shared'; 404 otherwise.

    Unknown, pre-share, and revoked slugs are indistinguishable -- a revoked
    slug must not confirm that a quiz ever existed, and a revocation must cut
    off running sessions at their very next request.
    """
    rows = await db.get(
        "quiz",
        {
            "slug": f"eq.{slug}",
            "select": "id,owner_id,state,slug,score_to_beat_correct,score_to_beat_total",
        },
    )
    quiz = rows[0] if rows else None
    if quiz is None or quiz.get("state") != "shared":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Quiz not found"
        )
    return quiz


async def _require_public_session(
    db: SupabaseClient, quiz: dict[str, Any], token: str
) -> dict[str, Any]:
    """The session this token names, scoped to THIS quiz; 404 otherwise.

    The quiz_id filter is the cross-quiz isolation guarantee, and the
    owner-prefix check keeps owner sessions off the anonymous surface.
    """
    rows = await db.get(
        "quiz_session",
        {"token": f"eq.{token}", "quiz_id": f"eq.{quiz['id']}"},
    )
    if not rows or not is_public_session(rows[0]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Play session not found"
        )
    return rows[0]


async def _get_questions(db: SupabaseClient, quiz_id: Any) -> list[dict[str, Any]]:
    rows = await db.get("quiz_question", {"quiz_id": f"eq.{quiz_id}"})
    return sorted(rows, key=lambda r: r["position"])


def _score_to_beat(quiz: dict[str, Any]) -> ScoreToBeat | None:
    if quiz.get("score_to_beat_correct") is None:
        return None
    return ScoreToBeat(
        correct=quiz["score_to_beat_correct"], total=quiz["score_to_beat_total"]
    )


# ============================================================================
# POST /q/{slug}/session -- mint or resume an anonymous session
# ============================================================================


@router.post("/q/{slug}/session", response_model=PublicQuizSessionResponse)
# Tightest limit of the public surface: session creation is the one endpoint
# that unconditionally inserts rows, so it is the abuse lever. A legitimate
# player needs exactly one call per page load (resume included).
@limiter.limit("10/minute")
async def start_public_quiz_session(
    request: Request,  # Required for rate limiter
    data: PublicQuizSessionRequest,
    slug: str = SlugPath,
) -> PublicQuizSessionResponse:
    """Start a fresh session, or resume the one a stored token names.

    A token that is unknown, malformed, or belongs to a DIFFERENT quiz is
    silently ignored and a fresh session minted -- the game must never stall
    on a stale sessionStorage value.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_shared_quiz(db, slug)

    if data.token:
        rows = await db.get(
            "quiz_session",
            {"token": f"eq.{data.token}", "quiz_id": f"eq.{quiz['id']}"},
        )
        if rows and is_public_session(rows[0]):
            return await _session_snapshot(db, quiz, rows[0])

    for _ in range(_SESSION_TOKEN_MINT_ATTEMPTS):
        token = secrets.token_urlsafe(32)
        try:
            rows = await db.post(
                "quiz_session", {"quiz_id": str(quiz["id"]), "token": token}
            )
        except HTTPException as exc:
            if exc.status_code == status.HTTP_409_CONFLICT:
                continue  # token collision (astronomically rare): re-mint
            raise
        if rows:
            # U12 funnel: started counts at the session INSERT -- resumes above
            # return early, so one session is one count no matter how many
            # times the player reloads.
            await record_quiz_funnel_event(db, quiz["id"], "session_started", slug)
            return PublicQuizSessionResponse(
                token=token, answered=[], completed=False, score=None
            )
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to start a play session. Please try again.",
    )


async def _session_snapshot(
    db: SupabaseClient, quiz: dict[str, Any], session: dict[str, Any]
) -> PublicQuizSessionResponse:
    """What a resuming client needs: its recorded answers, in question order,
    each with the ground truth that answering already revealed."""
    questions = await _get_questions(db, quiz["id"])
    by_id = {str(q["id"]): q for q in questions}
    answers = await db.get("quiz_answer", {"session_id": f"eq.{session['id']}"})
    answered: list[PublicAnsweredQuestion] = []
    for a in answers:
        question = by_id.get(str(a["question_id"]))
        if question is None:
            continue  # answer to a since-removed question: not part of this game
        answered.append(
            PublicAnsweredQuestion(
                question_id=str(a["question_id"]),
                selected_option_index=int(a.get("selected_option_index") or 0),
                correct=bool(a.get("place_correct")),
                correct_country=list(question["options"])[
                    int(question["correct_index"])
                ],
            )
        )
    answered.sort(key=lambda a: by_id[a.question_id]["position"])
    completed = session.get("completed_at") is not None
    return PublicQuizSessionResponse(
        token=str(session["token"]),
        answered=answered,
        completed=completed,
        score=int(session.get("score") or 0) if completed else None,
    )


# ============================================================================
# POST /q/{slug}/answer -- grade one question (KTD4: shared grading path)
# ============================================================================


@router.post("/q/{slug}/answer", response_model=PublicQuizAnswerResponse)
@limiter.limit("60/minute")
async def answer_public_quiz_question(
    request: Request,  # Required for rate limiter
    data: PublicQuizAnswerRequest,
    slug: str = SlugPath,
) -> PublicQuizAnswerResponse:
    """Grade one (session, question, choice) server-side.

    409 when this session already answered the question (double tap or
    replayed request); the recorded verdict and score are untouched.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_shared_quiz(db, slug)
    session = await _require_public_session(db, quiz, data.token)

    questions = await db.get(
        "quiz_question",
        {"id": f"eq.{data.question_id}", "quiz_id": f"eq.{quiz['id']}"},
    )
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Question not found"
        )

    graded = await grade_answer(
        db,
        session=session,
        question=questions[0],
        selected_option_index=data.selected_option_index,
    )
    recorded = await db.get(
        "quiz_answer", {"session_id": f"eq.{session['id']}", "select": "id"}
    )
    return PublicQuizAnswerResponse(
        correct=graded.place_correct,
        correct_country=graded.correct_option,
        answered_count=len(recorded),
    )


# ============================================================================
# POST /q/{slug}/complete -- idempotent completion + leaderboard entry
# ============================================================================


@router.post("/q/{slug}/complete", response_model=PublicQuizCompleteResponse)
@limiter.limit("20/minute")
async def complete_public_quiz_session(
    request: Request,  # Required for rate limiter
    data: PublicQuizCompleteRequest,
    slug: str = SlugPath,
) -> PublicQuizCompleteResponse:
    """Finish the session, bind the display name, and return the board.

    IDEMPOTENT: the game re-calls this on refresh-after-completion. The name
    binds at FIRST completion (a conditional write on completed_at being
    unset); repeat calls -- same name or different -- return the original
    result with `already_completed` true and never create a second entry.
    The score is recomputed from recorded answers on every call; the request
    carries no score and any client-sent one is ignored by schema.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_shared_quiz(db, slug)
    session = await _require_public_session(db, quiz, data.token)

    questions = await _get_questions(db, quiz["id"])
    answers = await db.get("quiz_answer", {"session_id": f"eq.{session['id']}"})
    by_question = {str(a["question_id"]): a for a in answers}
    missing = [q for q in questions if str(q["id"]) not in by_question]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "QUIZ_PLAY_INCOMPLETE",
                "message": "Answer every question before finishing.",
                "unanswered": len(missing),
            },
        )

    # Server-computed, always: the count of place-correct recorded answers
    # over the CURRENT question set.
    score = sum(1 for q in questions if by_question[str(q["id"])].get("place_correct"))
    total = len(questions)

    already_completed = session.get("completed_at") is not None
    if not already_completed:
        # First completion binds name + score + timestamp in one conditional
        # write; a concurrent duplicate updates zero rows and is treated as a
        # repeat call.
        claimed = await db.patch(
            "quiz_session",
            {
                "display_name": data.display_name,
                "score": score,
                "completed_at": _now_iso(),
            },
            {"id": f"eq.{session['id']}", "completed_at": "is.null"},
        )
        if claimed:
            session = claimed[0]
            # U12 funnel: completed counts at the FIRST completion only --
            # this branch is exactly the conditional write that claimed it,
            # so replayed complete calls can never double count.
            await record_quiz_funnel_event(db, quiz["id"], "session_completed", slug)
        else:
            already_completed = True
            refreshed = await db.get("quiz_session", {"id": f"eq.{session['id']}"})
            if refreshed:
                session = refreshed[0]

    bound_name = str(session.get("display_name") or data.display_name)
    viewer_key = canonical_name(bound_name)

    entries = aggregate_leaderboard(
        await completed_public_sessions(db, quiz["id"]),
        max_names=QUIZ_LEADERBOARD_MAX_NAMES,
    )
    on_board = any(e["key"] == viewer_key for e in entries)
    # Board-full indicator (KTD9): a completed, named session missing from
    # the aggregation means the distinct-name cap excluded it.
    leaderboard_full = not on_board and len(entries) >= QUIZ_LEADERBOARD_MAX_NAMES

    return PublicQuizCompleteResponse(
        score=score,
        total=total,
        score_to_beat=_score_to_beat(quiz),
        leaderboard=[
            PublicCompleteLeaderboardEntry(
                display_name=e["display_name"],
                best_score=e["best_score"],
                attempts=e["attempts"],
                is_you=e["key"] == viewer_key,
            )
            for e in top_entries(
                entries, viewer_key=viewer_key, top_n=QUIZ_LEADERBOARD_TOP_N
            )
        ],
        already_completed=already_completed,
        leaderboard_full=leaderboard_full,
    )


# ============================================================================
# GET /q/{slug}/leaderboard -- the read-time board (KTD9)
# ============================================================================


@router.get("/q/{slug}/leaderboard", response_model=PublicQuizLeaderboardResponse)
@limiter.limit("30/minute")
async def get_public_quiz_leaderboard(
    request: Request,  # Required for rate limiter
    response: Response,
    slug: str = SlugPath,
) -> PublicQuizLeaderboardResponse:
    """The current board: top N aggregated rows plus the owner's score-to-beat.

    Anonymous read -- no is_you flag, and never cached: a just-hidden session
    must disappear on the next request.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_shared_quiz(db, slug)
    entries = aggregate_leaderboard(
        await completed_public_sessions(db, quiz["id"]),
        max_names=QUIZ_LEADERBOARD_MAX_NAMES,
    )
    response.headers["Cache-Control"] = "no-store"
    return PublicQuizLeaderboardResponse(
        score_to_beat=_score_to_beat(quiz),
        leaderboard=[
            PublicLeaderboardEntry(
                display_name=e["display_name"],
                best_score=e["best_score"],
                attempts=e["attempts"],
            )
            for e in top_entries(entries, top_n=QUIZ_LEADERBOARD_TOP_N)
        ],
    )
