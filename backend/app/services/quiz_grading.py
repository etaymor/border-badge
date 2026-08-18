"""Server-side quiz answer grading (KTD4).

This is the ONE grading code path for the travel photo quiz: the owner's
authenticated play and the anonymous public play both grade through
`grade_answer`. It takes an already-authorized session + question pair -- the
caller is responsible for loading them with the appropriate ownership/state
filters -- and performs the grade server-side:

- rejects double-grading (pre-check here, DB unique constraint as backstop),
- records the graded `quiz_answer` row,
- recomputes the session's server-computed running score from its recorded
  answers (clients never submit scores),
- returns the verdict along with the ground truth revealed by answering.

Ground truth (correct index/country) exists only in this return value and in
backend-only tables; question payloads served to players never contain it.
"""

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status

from app.db.session import SupabaseClient


@dataclass
class GradedAnswer:
    """The server's verdict for one answered question."""

    place_correct: bool
    correct_option_index: int
    correct_option: str
    # The session's updated running score (count of place-correct answers).
    score: int
    # How many questions the session has answered, this one included --
    # derived from the same recorded-answers read that computes the score.
    answered_count: int


async def grade_answer(
    db: SupabaseClient,
    *,
    session: dict[str, Any],
    question: dict[str, Any],
    selected_option_index: int,
) -> GradedAnswer:
    """Grade one (session, question, choice) server-side and record it.

    Raises 409 if the session already answered this question -- each question
    grades at most once per session (DB-guaranteed by the unique constraint on
    (session_id, question_id)). The pre-check gives a clean message on the
    common path; when a concurrent duplicate slips past it and trips the
    constraint at insert, that 409 is normalized to the SAME clean message.
    """
    already_answered = HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="This question has already been answered in this session.",
    )

    existing = await db.get(
        "quiz_answer",
        {
            "session_id": f"eq.{session['id']}",
            "question_id": f"eq.{question['id']}",
            "select": "id",
        },
    )
    if existing:
        raise already_answered

    correct_index = int(question["correct_index"])
    place_correct = selected_option_index == correct_index

    try:
        await db.post(
            "quiz_answer",
            {
                "session_id": str(session["id"]),
                "question_id": str(question["id"]),
                "selected_option_index": selected_option_index,
                "place_correct": place_correct,
            },
        )
    except HTTPException as exc:
        # The pre-check and this insert are not atomic: a concurrent duplicate
        # answer for the same (session, question) can pass the pre-check and
        # then trip the UNIQUE (session_id, question_id) constraint here.
        # PostgREST surfaces that 23505 as a 409 with a raw DB detail; convert
        # it to the same clean, documented "already answered" 409 the pre-check
        # raises. Any other status re-raises unchanged.
        if exc.status_code == status.HTTP_409_CONFLICT:
            raise already_answered from exc
        raise

    # Derive the running score from recorded answers rather than incrementing
    # in place -- concurrent answers converge on the recorded truth.
    answers = await db.get(
        "quiz_answer",
        {"session_id": f"eq.{session['id']}", "select": "place_correct"},
    )
    score = sum(1 for a in answers if a.get("place_correct"))
    await db.patch("quiz_session", {"score": score}, {"id": f"eq.{session['id']}"})

    options = list(question["options"])
    return GradedAnswer(
        place_correct=place_correct,
        correct_option_index=correct_index,
        correct_option=options[correct_index],
        score=score,
        answered_count=len(answers),
    )
