"""Tests for the owner quiz list (GET /quiz).

The management surface serves each quiz with a `cover_image_url` — the first
question's public image URL, built exactly like the play payloads build theirs
(public media bucket URL from the storage path). The list must stay one
batched question fetch regardless of how many quizzes the owner has, and a
quiz with no questions (a fresh draft) must serve None, never crash.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import TEST_USER_ID, mock_auth_dependency, supabase_tables

QUIZ_A = "770e8400-e29b-41d4-a716-446655440001"
QUIZ_B = "770e8400-e29b-41d4-a716-446655440002"

# Pinned by conftest's pin_environment_settings.
MEDIA_BASE = "https://test.supabase.co/storage/v1/object/public/media"


def _quiz_row(quiz_id: str, **overrides: Any) -> dict[str, Any]:
    row = {
        "id": quiz_id,
        "owner_id": TEST_USER_ID,
        "state": "awaiting_owner_play",
        "slug": None,
        "score_to_beat_correct": None,
        "score_to_beat_total": None,
        "created_at": "2026-08-01T00:00:00+00:00",
        "revoked_at": None,
    }
    row.update(overrides)
    return row


def _question_row(quiz_id: str, position: int, storage_path: str) -> dict[str, Any]:
    return {"quiz_id": quiz_id, "position": position, "storage_path": storage_path}


def _list_quizzes(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    *,
    quiz_rows: list[dict[str, Any]],
    question_rows: list[dict[str, Any]],
) -> Any:
    mock_supabase_client.get.side_effect = supabase_tables(
        quiz=quiz_rows, quiz_question=question_rows
    )
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.quiz.get_supabase_client", return_value=mock_supabase_client
        ):
            return client.get("/quiz", headers=auth_headers)
    finally:
        app.dependency_overrides.clear()


def test_list_serves_first_question_image_as_cover(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """cover_image_url is the FIRST question's public URL, even when the
    question rows come back out of position order."""
    response = _list_quizzes(
        client,
        mock_supabase_client,
        mock_user,
        auth_headers,
        quiz_rows=[_quiz_row(QUIZ_A)],
        question_rows=[
            _question_row(QUIZ_A, 3, f"quiz/{QUIZ_A}/photo-c.jpg"),
            _question_row(QUIZ_A, 1, f"quiz/{QUIZ_A}/photo-a.jpg"),
            _question_row(QUIZ_A, 2, f"quiz/{QUIZ_A}/photo-b.jpg"),
        ],
    )

    assert response.status_code == 200
    quizzes = response.json()["quizzes"]
    assert len(quizzes) == 1
    assert quizzes[0]["cover_image_url"] == f"{MEDIA_BASE}/quiz/{QUIZ_A}/photo-a.jpg"
    assert quizzes[0]["question_count"] == 3


def test_list_is_none_safe_for_a_quiz_without_questions(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A fresh draft with no questions serves cover_image_url None (and the
    quiz WITH questions on the same list still gets its cover)."""
    response = _list_quizzes(
        client,
        mock_supabase_client,
        mock_user,
        auth_headers,
        quiz_rows=[
            _quiz_row(QUIZ_A, state="building", created_at="2026-08-02T00:00:00+00:00"),
            _quiz_row(QUIZ_B),
        ],
        question_rows=[_question_row(QUIZ_B, 1, f"quiz/{QUIZ_B}/photo-a.jpg")],
    )

    assert response.status_code == 200
    by_id = {q["id"]: q for q in response.json()["quizzes"]}
    assert by_id[QUIZ_A]["cover_image_url"] is None
    assert by_id[QUIZ_A]["question_count"] == 0
    assert by_id[QUIZ_B]["cover_image_url"] == f"{MEDIA_BASE}/quiz/{QUIZ_B}/photo-a.jpg"


def test_list_batches_the_question_fetch(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """The covers never turn the list into N+1: one quiz fetch, one batched
    quiz_question fetch, regardless of how many quizzes the owner has."""
    response = _list_quizzes(
        client,
        mock_supabase_client,
        mock_user,
        auth_headers,
        quiz_rows=[
            _quiz_row(QUIZ_A, created_at="2026-08-02T00:00:00+00:00"),
            _quiz_row(QUIZ_B),
        ],
        question_rows=[
            _question_row(QUIZ_A, 1, f"quiz/{QUIZ_A}/photo-a.jpg"),
            _question_row(QUIZ_B, 1, f"quiz/{QUIZ_B}/photo-a.jpg"),
        ],
    )

    assert response.status_code == 200
    assert mock_supabase_client.get.await_count == 2
    tables = [call.args[0] for call in mock_supabase_client.get.await_args_list]
    assert tables.count("quiz_question") == 1
