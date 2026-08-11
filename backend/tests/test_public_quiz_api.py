"""Tests for the anonymous public quiz play API (U8: /q/{slug}/* JSON routes).

The contract under test is the one `quiz-play.js` (U7) codes against:

- POST /q/{slug}/session mints or resumes an opaque-token session.
- POST /q/{slug}/answer grades ONE question server-side (KTD4: through the
  shared grading service) and reveals the correct country only in the verdict.
- POST /q/{slug}/complete is IDEMPOTENT: the first completion binds the
  display name and posts the server-computed score to the leaderboard; repeat
  calls (refresh-after-completion, possibly with a different name) return the
  original result with no second entry.
- GET /q/{slug}/leaderboard is a read-time aggregation over completed,
  non-hidden, non-owner sessions: best score + attempts per canonicalized
  name (trim, NFKC, casefold -- AE4). Never a cached best-score column.
- Every endpoint 404s for unknown/pre-share/revoked quizzes -- mid-session
  included -- and a token from one quiz can never grade another.

Quizzes are built through the real owner lifecycle (finalize -> play ->
complete -> share) against the stateful FakeDB from tests/api/test_quiz_api.py
so the public surface is exercised against genuinely shared quizzes with a
hidden owner session already in the sessions table.
"""

from typing import Any
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import limiter
from tests.api.test_quiz_api import FakeDB, build_playable, call, share
from tests.conftest import OTHER_USER_ID


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    limiter.reset()
    yield


@pytest.fixture(autouse=True)
def quiz_settings(monkeypatch):
    """Pin the settings the quiz endpoints read."""
    settings = get_settings()
    monkeypatch.setattr(settings, "base_url", "https://example.com")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role-key")
    yield


# ============================================================================
# Helpers
# ============================================================================


def shared_quiz(
    client: TestClient, db: FakeDB, n: int = 5, wrong_positions: tuple = ()
) -> tuple[str, str]:
    """Owner lifecycle end-to-end: build, play, complete, share. Returns
    (quiz_id, slug). Leaves the owner's hidden session in the table."""
    quiz_id, _, _ = build_playable(client, db, n=n, wrong_positions=wrong_positions)
    resp = share(client, db, quiz_id)
    assert resp.status_code == 200, resp.text
    return quiz_id, resp.json()["slug"]


def public(client: TestClient, db: FakeDB, method: str, url: str, json=None):
    """Anonymous request against the public quiz routes (no auth header)."""
    with patch("app.api.public_quiz.get_supabase_client", return_value=db):
        return client.request(method, url, json=json)


def start_session(client, db, slug, token: str | None = None):
    body: dict[str, Any] = {} if token is None else {"token": token}
    return public(client, db, "POST", f"/q/{slug}/session", json=body)


def grade(client, db, slug, token, question, *, correct=True):
    idx = question["correct_index"]
    if not correct:
        idx = (idx + 1) % 4
    return public(
        client,
        db,
        "POST",
        f"/q/{slug}/answer",
        json={
            "token": token,
            "question_id": question["id"],
            "selected_option_index": idx,
        },
    )


def answer_all_public(client, db, slug, quiz_id, token, wrong_positions=()):
    responses = []
    for q in db.questions(quiz_id):
        resp = grade(
            client,
            db,
            slug,
            token,
            q,
            correct=q["position"] not in wrong_positions,
        )
        assert resp.status_code == 200, resp.text
        responses.append(resp.json())
    return responses


def finish(client, db, slug, token, name, extra: dict[str, Any] | None = None):
    body: dict[str, Any] = {"token": token, "display_name": name}
    if extra:
        body.update(extra)
    return public(client, db, "POST", f"/q/{slug}/complete", json=body)


def run_through(client, db, slug, quiz_id, name, wrong_positions=()):
    """One full anonymous play: session -> all answers -> complete."""
    resp = start_session(client, db, slug)
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    answer_all_public(client, db, slug, quiz_id, token, wrong_positions)
    resp = finish(client, db, slug, token, name)
    assert resp.status_code == 200, resp.text
    return token, resp.json()


def leaderboard(client, db, slug):
    return public(client, db, "GET", f"/q/{slug}/leaderboard")


# ============================================================================
# Core flow: session -> graded answers -> completion -> leaderboard
# ============================================================================


class TestFullSessionFlow:
    def test_new_session_mints_opaque_token(self, client: TestClient) -> None:
        db = FakeDB()
        _, slug = shared_quiz(client, db)
        resp = start_session(client, db, slug)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data["token"]) >= 32
        assert not data["token"].startswith("owner-")
        assert data["answered"] == []
        assert data["completed"] is False
        assert data["score"] is None

    def test_answers_graded_server_side_with_verdict_and_count(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        questions = db.questions(quiz_id)

        right = grade(client, db, slug, token, questions[0], correct=True)
        assert right.status_code == 200, right.text
        body = right.json()
        assert body["correct"] is True
        assert (
            body["correct_country"]
            == questions[0]["options"][questions[0]["correct_index"]]
        )
        assert body["answered_count"] == 1

        wrong = grade(client, db, slug, token, questions[1], correct=False)
        body = wrong.json()
        assert body["correct"] is False
        assert (
            body["correct_country"]
            == questions[1]["options"][questions[1]["correct_index"]]
        )
        assert body["answered_count"] == 2

    def test_completion_returns_server_score_and_posts_name(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        _, result = run_through(
            client, db, slug, quiz_id, "Priya", wrong_positions=(1, 3)
        )

        assert result["score"] == 3
        assert result["total"] == 5
        assert result["already_completed"] is False
        # The owner's seeded pair rides along for the beat-the-owner framing.
        assert result["score_to_beat"] == {"correct": 5, "total": 5}
        # Exactly one leaderboard entry: the player. The owner's hidden
        # session (present in the table) must never surface.
        assert len(result["leaderboard"]) == 1
        entry = result["leaderboard"][0]
        assert entry["display_name"] == "Priya"
        assert entry["best_score"] == 3
        assert entry["attempts"] == 1
        assert entry["is_you"] is True

    def test_incomplete_session_cannot_complete(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        grade(client, db, slug, token, db.questions(quiz_id)[0])
        resp = finish(client, db, slug, token, "Priya")
        assert resp.status_code == 409

    def test_resume_returns_recorded_answers(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        questions = db.questions(quiz_id)
        grade(client, db, slug, token, questions[0], correct=True)
        grade(client, db, slug, token, questions[1], correct=False)

        resumed = start_session(client, db, slug, token=token)
        assert resumed.status_code == 200
        data = resumed.json()
        assert data["token"] == token
        assert data["completed"] is False
        answered = data["answered"]
        assert len(answered) == 2
        assert answered[0]["question_id"] == str(questions[0]["id"])
        assert answered[0]["correct"] is True
        assert (
            answered[0]["correct_country"]
            == questions[0]["options"][questions[0]["correct_index"]]
        )
        assert answered[1]["correct"] is False

    def test_unknown_token_mints_fresh_session(self, client: TestClient) -> None:
        db = FakeDB()
        _, slug = shared_quiz(client, db)
        resp = start_session(client, db, slug, token="no-such-token")
        assert resp.status_code == 200
        assert resp.json()["token"] != "no-such-token"
        assert resp.json()["answered"] == []


# ============================================================================
# Idempotent completion (refresh-after-completion contract)
# ============================================================================


class TestIdempotentCompletion:
    def test_repeat_completion_returns_original_result(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        token, first = run_through(
            client, db, slug, quiz_id, "Priya", wrong_positions=(0,)
        )

        again = finish(client, db, slug, token, "Priya")
        assert again.status_code == 200
        body = again.json()
        assert body["already_completed"] is True
        assert body["score"] == first["score"] == 4
        assert len(body["leaderboard"]) == 1
        assert body["leaderboard"][0]["attempts"] == 1

    def test_replay_with_different_name_keeps_original_name(
        self, client: TestClient
    ) -> None:
        """The name binds at FIRST completion; later different names are
        ignored and never create a second entry."""
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        token, _ = run_through(client, db, slug, quiz_id, "Priya")

        again = finish(client, db, slug, token, "Somebody Else")
        assert again.status_code == 200
        body = again.json()
        assert body["already_completed"] is True
        assert len(body["leaderboard"]) == 1
        assert body["leaderboard"][0]["display_name"] == "Priya"
        assert body["leaderboard"][0]["is_you"] is True
        # Stored session still carries the original name.
        session = db.find("quiz_session", token=token)[0]
        assert session["display_name"] == "Priya"


# ============================================================================
# AE4: name canonicalization -- best score kept, attempts increment
# ============================================================================


class TestNameCanonicalization:
    def test_same_name_replays_keep_best_score_and_count_attempts(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "Priya", wrong_positions=(0, 1))  # 3
        run_through(client, db, slug, quiz_id, "Priya")  # 5
        _, result = run_through(
            client, db, slug, quiz_id, "Priya", wrong_positions=(2,)
        )  # 4

        assert len(result["leaderboard"]) == 1
        entry = result["leaderboard"][0]
        assert entry["best_score"] == 5
        assert entry["attempts"] == 3
        assert entry["is_you"] is True

    def test_case_whitespace_and_nfkc_variants_collapse(
        self, client: TestClient
    ) -> None:
        """'Maya', '  maya ', and fullwidth 'ＭＡＹＡ' are one player."""
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "Maya", wrong_positions=(0,))
        run_through(client, db, slug, quiz_id, "  maya ")
        _, result = run_through(
            client, db, slug, quiz_id, "ＭＡＹＡ", wrong_positions=(1, 2)
        )

        assert len(result["leaderboard"]) == 1
        entry = result["leaderboard"][0]
        assert entry["attempts"] == 3
        assert entry["best_score"] == 5
        assert entry["is_you"] is True


# ============================================================================
# Server-computed scores only
# ============================================================================


class TestScoreIntegrity:
    def test_client_sent_score_has_no_effect(self, client: TestClient) -> None:
        """The completion schema carries no score field; a fabricated one is
        dropped and the response score comes from recorded answers."""
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        token = start_session(client, db, slug).json()["token"]
        answer_all_public(client, db, slug, quiz_id, token, wrong_positions=(0, 1))

        resp = finish(
            client, db, slug, token, "Priya", extra={"score": 999, "total": 999}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["score"] == 3
        assert body["total"] == 5
        assert body["leaderboard"][0]["best_score"] == 3
        assert db.find("quiz_session", token=token)[0]["score"] == 3

    def test_double_grading_one_question_rejected(self, client: TestClient) -> None:
        """Second grade of the same question 409s and the score is untouched."""
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        q = db.questions(quiz_id)[0]

        assert grade(client, db, slug, token, q, correct=True).status_code == 200
        # Retry with a WRONG choice: must not regrade or change anything.
        retry = grade(client, db, slug, token, q, correct=False)
        assert retry.status_code == 409

        session = db.find("quiz_session", token=token)[0]
        assert session["score"] == 1
        recorded = db.find("quiz_answer", session_id=session["id"])
        assert len(recorded) == 1
        assert recorded[0]["place_correct"] is True

    def test_out_of_range_option_index_schema_rejected(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        q = db.questions(quiz_id)[0]
        for bad in (-1, 4):
            resp = public(
                client,
                db,
                "POST",
                f"/q/{slug}/answer",
                json={
                    "token": token,
                    "question_id": q["id"],
                    "selected_option_index": bad,
                },
            )
            assert resp.status_code == 422, bad


# ============================================================================
# Display-name rule: trimmed, 2-50, stored raw
# ============================================================================


class TestDisplayNameValidation:
    @pytest.mark.parametrize("bad", ["", "   ", "A", " a ", "x" * 51])
    def test_invalid_names_rejected(self, client: TestClient, bad: str) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        answer_all_public(client, db, slug, quiz_id, token)
        resp = finish(client, db, slug, token, bad)
        assert resp.status_code == 422, repr(bad)
        # Nothing completed: the session is still finishable.
        assert db.find("quiz_session", token=token)[0]["completed_at"] is None

    def test_names_are_trimmed_before_storage(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        answer_all_public(client, db, slug, quiz_id, token)
        resp = finish(client, db, slug, token, "  Bo \n")
        assert resp.status_code == 200, resp.text
        assert db.find("quiz_session", token=token)[0]["display_name"] == "Bo"
        assert resp.json()["leaderboard"][0]["display_name"] == "Bo"


# ============================================================================
# Hidden sessions and the owner hide endpoint
# ============================================================================


class TestHiddenSessions:
    def test_owner_hides_a_session_off_the_board(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "Keeper")
        troll_token, _ = run_through(client, db, slug, quiz_id, "Troll Name")
        troll_id = db.find("quiz_session", token=troll_token)[0]["id"]

        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/sessions/{troll_id}/hide",
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"session_id": troll_id, "hidden": True}
        assert db.find("quiz_session", id=troll_id)[0]["hidden"] is True

        board = leaderboard(client, db, slug)
        assert board.status_code == 200
        names = [e["display_name"] for e in board.json()["leaderboard"]]
        assert names == ["Keeper"]

    def test_hide_requires_the_quiz_owner(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        token, _ = run_through(client, db, slug, quiz_id, "Priya")
        session_id = db.find("quiz_session", token=token)[0]["id"]

        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/sessions/{session_id}/hide",
            user_id=OTHER_USER_ID,
        )
        assert resp.status_code == 404
        assert db.find("quiz_session", id=session_id)[0]["hidden"] is False

    def test_hide_unknown_session_404s(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _ = shared_quiz(client, db)
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/sessions/990e8400-e29b-41d4-a716-446655440099/hide",
        )
        assert resp.status_code == 404

    def test_owner_session_never_on_public_leaderboard(
        self, client: TestClient
    ) -> None:
        """The owner's completed (hidden, owner- prefixed) session from the
        seeding play must not surface even with zero public players."""
        db = FakeDB()
        _, slug = shared_quiz(client, db, n=5)
        board = leaderboard(client, db, slug)
        assert board.status_code == 200
        data = board.json()
        assert data["leaderboard"] == []
        # The owner's result rides along only as the score-to-beat pair.
        assert data["score_to_beat"] == {"correct": 5, "total": 5}


# ============================================================================
# Distinct-name cap (KTD9): board-full is an indicator, not an error
# ============================================================================


class TestLeaderboardCap:
    def test_new_name_past_cap_gets_score_with_board_full_flag(
        self, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr("app.api.public_quiz.QUIZ_LEADERBOARD_MAX_NAMES", 2)
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "First", wrong_positions=(0,))
        run_through(client, db, slug, quiz_id, "Second", wrong_positions=(0, 1))

        _, result = run_through(client, db, slug, quiz_id, "Latecomer")
        assert result["score"] == 5  # score still returned in full
        assert result["leaderboard_full"] is True
        names = [e["display_name"] for e in result["leaderboard"]]
        assert "Latecomer" not in names
        assert set(names) == {"First", "Second"}
        assert not any(e["is_you"] for e in result["leaderboard"])

    def test_existing_names_still_update_through_the_cap(
        self, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr("app.api.public_quiz.QUIZ_LEADERBOARD_MAX_NAMES", 2)
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "First", wrong_positions=(0, 1, 2))
        run_through(client, db, slug, quiz_id, "Second")

        # Board is full; "First" replays (case variant) and still improves.
        _, result = run_through(client, db, slug, quiz_id, "FIRST")
        assert result["leaderboard_full"] is False
        entry = next(e for e in result["leaderboard"] if e["is_you"])
        assert entry["best_score"] == 5
        assert entry["attempts"] == 2

    def test_below_cap_completions_are_not_flagged(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        _, result = run_through(client, db, slug, quiz_id, "Priya")
        assert result["leaderboard_full"] is False


# ============================================================================
# Leaderboard reads: top-N capping and anonymous shape
# ============================================================================


class TestLeaderboardReads:
    def test_get_leaderboard_entries_have_no_is_you(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "Priya", wrong_positions=(0,))

        board = leaderboard(client, db, slug)
        assert board.status_code == 200
        assert board.headers["Cache-Control"] == "no-store"
        data = board.json()
        assert data["score_to_beat"] == {"correct": 5, "total": 5}
        assert len(data["leaderboard"]) == 1
        entry = data["leaderboard"][0]
        assert entry == {"display_name": "Priya", "best_score": 4, "attempts": 1}
        assert "is_you" not in entry

    def test_read_capped_at_top_n_best_scores_first(
        self, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr("app.api.public_quiz.QUIZ_LEADERBOARD_TOP_N", 2)
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "Bronze", wrong_positions=(0, 1))
        run_through(client, db, slug, quiz_id, "Gold")
        run_through(client, db, slug, quiz_id, "Silver", wrong_positions=(0,))

        board = leaderboard(client, db, slug).json()["leaderboard"]
        assert [e["display_name"] for e in board] == ["Gold", "Silver"]

    def test_completion_appends_own_standing_outside_top_n(
        self, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr("app.api.public_quiz.QUIZ_LEADERBOARD_TOP_N", 2)
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        run_through(client, db, slug, quiz_id, "Gold")
        run_through(client, db, slug, quiz_id, "Silver", wrong_positions=(0,))
        _, result = run_through(
            client, db, slug, quiz_id, "Bronze", wrong_positions=(0, 1)
        )

        rows = result["leaderboard"]
        assert [e["display_name"] for e in rows] == ["Gold", "Silver", "Bronze"]
        assert [e["is_you"] for e in rows] == [False, False, True]


# ============================================================================
# 404 gating: unknown, pre-share, revoked (mid-session too)
# ============================================================================


class TestUnavailableQuiz:
    def test_unknown_slug_404s_every_endpoint(self, client: TestClient) -> None:
        db = FakeDB()
        shared_quiz(client, db)  # a real quiz exists, under a different slug
        for method, url, body in [
            ("POST", "/q/deadbeef/session", {}),
            (
                "POST",
                "/q/deadbeef/answer",
                {
                    "token": "t" * 43,
                    "question_id": str(uuid4()),
                    "selected_option_index": 0,
                },
            ),
            (
                "POST",
                "/q/deadbeef/complete",
                {"token": "t" * 43, "display_name": "Priya"},
            ),
            ("GET", "/q/deadbeef/leaderboard", None),
        ]:
            resp = public(client, db, method, url, json=body)
            assert resp.status_code == 404, f"{method} {url} -> {resp.status_code}"

    def test_pre_share_quiz_404s(self, client: TestClient) -> None:
        """A minted-but-unshared state never serves (positive 'shared' check)."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        db.quiz(quiz_id)["slug"] = "a" * 32  # slug exists but state is playable
        resp = start_session(client, db, "a" * 32)
        assert resp.status_code == 404

    def test_revocation_cuts_off_a_running_session(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db)
        token = start_session(client, db, slug).json()["token"]
        questions = db.questions(quiz_id)
        assert grade(client, db, slug, token, questions[0]).status_code == 200

        assert call(client, db, "POST", f"/quiz/{quiz_id}/revoke").status_code == 200

        assert grade(client, db, slug, token, questions[1]).status_code == 404
        assert finish(client, db, slug, token, "Priya").status_code == 404
        assert start_session(client, db, slug, token=token).status_code == 404
        assert leaderboard(client, db, slug).status_code == 404

    def test_invalid_slug_format_rejected(self, client: TestClient) -> None:
        db = FakeDB()
        resp = public(client, db, "POST", "/q/NOT_A_SLUG!/session", json={})
        assert resp.status_code in (404, 422)
        assert db.rows("quiz_session") == []


# ============================================================================
# Token isolation: one quiz's token is worthless against another
# ============================================================================


class TestTokenIsolation:
    def test_token_from_one_quiz_cannot_grade_another(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_a, slug_a = shared_quiz(client, db, n=5)
        quiz_b, slug_b = shared_quiz(client, db, n=5)
        token_a = start_session(client, db, slug_a).json()["token"]

        # The owner plays seeded answer rows during shared_quiz(); the cross-
        # quiz grade attempt must not add any beyond that baseline.
        baseline_answers = len(db.find("quiz_answer"))
        target = db.questions(quiz_b)[0]
        resp = grade(client, db, slug_b, token_a, target)
        assert resp.status_code == 404
        assert len(db.find("quiz_answer")) == baseline_answers

        # Completion is equally scoped.
        resp = finish(client, db, slug_b, token_a, "Priya")
        assert resp.status_code == 404

    def test_foreign_token_on_session_mints_fresh(self, client: TestClient) -> None:
        db = FakeDB()
        _, slug_a = shared_quiz(client, db, n=5)
        _, slug_b = shared_quiz(client, db, n=5)
        token_a = start_session(client, db, slug_a).json()["token"]

        resp = start_session(client, db, slug_b, token=token_a)
        assert resp.status_code == 200
        assert resp.json()["token"] != token_a
        assert resp.json()["answered"] == []

    def test_owner_token_is_not_resumable_publicly(self, client: TestClient) -> None:
        """The owner's hidden session token mints a fresh public session
        instead of resuming, and cannot grade through the public route."""
        db = FakeDB()
        quiz_id, slug = shared_quiz(client, db, n=5)
        owner_token = next(
            r["token"]
            for r in db.rows("quiz_session")
            if r["token"].startswith("owner-")
        )
        resp = start_session(client, db, slug, token=owner_token)
        assert resp.status_code == 200
        assert resp.json()["token"] != owner_token

        q = db.questions(quiz_id)[0]
        assert grade(client, db, slug, owner_token, q).status_code == 404


# ============================================================================
# Rate limiting
# ============================================================================


class TestRateLimits:
    def test_session_creation_abuse_hits_the_limit(self, client: TestClient) -> None:
        """Session creation carries the tightest public limit (10/minute)."""
        db = FakeDB()
        _, slug = shared_quiz(client, db)
        statuses = [start_session(client, db, slug).status_code for _ in range(11)]
        assert statuses[:10] == [200] * 10
        assert statuses[10] == 429

    def test_every_public_endpoint_is_registered_with_the_limiter(self) -> None:
        for handler in (
            "start_public_quiz_session",
            "answer_public_quiz_question",
            "complete_public_quiz_session",
            "get_public_quiz_leaderboard",
        ):
            assert any(
                handler in key for key in limiter._route_limits
            ), f"{handler} is not rate limited"
        assert any("hide_quiz_session" in key for key in limiter._route_limits)
