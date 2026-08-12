"""Tests for the authenticated travel-photo-quiz lifecycle (U3).

Covers creation (signed uploads + finalize with server-generated options),
server-graded owner play with score-to-beat seeding, pre-share swap/remove,
share-time locking with slug minting, revoke, and draft deletion.

The Supabase REST client is replaced with an in-memory FakeDB that honors the
PostgREST filters the endpoints use (eq/neq/in/is.null/not.is.null) and the
unique constraints from migration 0060, so conditional writes really return
zero rows on state mismatches and duplicate inserts really conflict — the
whole lifecycle is exercised as stateful flows, not per-call canned returns.
"""

import copy
import itertools
import re
from contextlib import ExitStack, contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user
from app.main import app, limiter
from tests.conftest import OTHER_USER_ID, TEST_USER_ID, mock_auth_dependency

# ============================================================================
# Country reference data (region-rich Europe, thin-region Oceania)
# ============================================================================

COUNTRIES: list[dict[str, str]] = [
    {"code": "FR", "name": "France", "region": "Europe"},
    {"code": "IT", "name": "Italy", "region": "Europe"},
    {"code": "ES", "name": "Spain", "region": "Europe"},
    {"code": "DE", "name": "Germany", "region": "Europe"},
    {"code": "PT", "name": "Portugal", "region": "Europe"},
    {"code": "CH", "name": "Switzerland", "region": "Europe"},
    {"code": "AT", "name": "Austria", "region": "Europe"},
    {"code": "GB", "name": "United Kingdom", "region": "Europe"},
    {"code": "GR", "name": "Greece", "region": "Europe"},
    {"code": "NL", "name": "Netherlands", "region": "Europe"},
    {"code": "JP", "name": "Japan", "region": "Asia"},
    {"code": "TH", "name": "Thailand", "region": "Asia"},
    {"code": "VN", "name": "Vietnam", "region": "Asia"},
    {"code": "KR", "name": "South Korea", "region": "Asia"},
    {"code": "US", "name": "United States", "region": "Americas"},
    {"code": "MX", "name": "Mexico", "region": "Americas"},
    {"code": "BR", "name": "Brazil", "region": "Americas"},
    # Thin region: only two countries, so decoys must fall back to the wider pool.
    {"code": "NZ", "name": "New Zealand", "region": "Oceania"},
    {"code": "AU", "name": "Australia", "region": "Oceania"},
]

COUNTRY_NAMES = {c["name"] for c in COUNTRIES}
CODES_10 = ["FR", "IT", "ES", "DE", "PT", "CH", "AT", "JP", "TH", "VN"]

HEADERS = {"Authorization": "Bearer mock-jwt-token"}
SLUG_RE = re.compile(r"^[0-9a-f]{32}$")


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    limiter.reset()
    yield


@pytest.fixture(autouse=True)
def quiz_settings(monkeypatch):
    """Pin the settings the quiz lifecycle endpoints read."""
    settings = get_settings()
    monkeypatch.setattr(settings, "base_url", "https://example.com")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role-key")
    yield


@pytest.fixture(autouse=True)
def stub_quiz_storage_sweep():
    """U10 wired physical storage deletion into revoke/delete. These
    lifecycle tests stub the sweep as an instant success (nothing to
    delete); the real list-delete-verify sweep, its failure modes, and the
    reconciliation retries are exercised in tests/api/test_quiz_revoke.py.
    """
    with patch(
        "app.api.quiz.delete_quiz_storage_objects",
        new=AsyncMock(return_value=None),
    ):
        yield


# ============================================================================
# In-memory Supabase stand-in
# ============================================================================


class FakeDB:
    """Stateful stand-in for SupabaseClient over the quiz tables."""

    def __init__(self) -> None:
        self._seq = itertools.count()
        # Emulates the quiz_daily_classification counter behind
        # reserve_daily_classification() (migration 0060): one in-memory
        # "today" bucket, reserved atomically.
        self.daily_classified = 0
        self.tables: dict[str, list[dict[str, Any]]] = {
            "quiz": [],
            "quiz_question": [],
            "quiz_session": [],
            "quiz_answer": [],
            "quiz_funnel": [],
            "country": [dict(c) for c in COUNTRIES],
        }

    # -- helpers for tests ---------------------------------------------------

    def rows(self, table: str) -> list[dict[str, Any]]:
        return self.tables[table]

    def find(self, table: str, **kv: Any) -> list[dict[str, Any]]:
        return [
            r
            for r in self.tables[table]
            if all(str(r.get(k)) == str(v) for k, v in kv.items())
        ]

    def quiz(self, quiz_id: str) -> dict[str, Any]:
        return self.find("quiz", id=quiz_id)[0]

    def questions(self, quiz_id: str) -> list[dict[str, Any]]:
        return sorted(
            self.find("quiz_question", quiz_id=quiz_id), key=lambda r: r["position"]
        )

    def funnel(self, quiz_id: str) -> dict[str, int]:
        """All funnel counters for one quiz in one lookup (KTD9: started vs
        completed must be queryable together)."""
        return {
            r["event"]: r["count"] for r in self.find("quiz_funnel", quiz_id=quiz_id)
        }

    def seed_quiz(self, state: str = "building", owner_id: str = TEST_USER_ID, **extra):
        row = {
            "id": str(uuid4()),
            "owner_id": owner_id,
            "state": state,
            "slug": None,
            "score_to_beat_correct": None,
            "score_to_beat_total": None,
            "seed_session_id": None,
            "version": 0,
            "classified_count": 0,
            "created_at": f"2026-08-01T00:00:{next(self._seq):02d}+00:00",
            "updated_at": "2026-08-01T00:00:00+00:00",
            "revoked_at": None,
            "objects_deleted_at": None,
        }
        row.update(extra)
        self.tables["quiz"].append(row)
        return row["id"]

    # -- PostgREST emulation -------------------------------------------------

    @staticmethod
    def _matches(row: dict[str, Any], params: dict[str, Any] | None) -> bool:
        for key, value in (params or {}).items():
            if key in ("select", "order", "limit"):
                continue
            v = str(value)
            actual = row.get(key)
            if v.startswith("eq."):
                if str(actual) != v[3:]:
                    return False
            elif v.startswith("neq."):
                if str(actual) == v[4:]:
                    return False
            elif v.startswith("in.(") and v.endswith(")"):
                if str(actual) not in v[4:-1].split(","):
                    return False
            elif v == "is.null":
                if actual is not None:
                    return False
            elif v == "not.is.null":
                if actual is None:
                    return False
            elif v.startswith("gte."):
                if actual is None or str(actual) < v[4:]:
                    return False
            else:  # pragma: no cover - guards against untested filter syntax
                raise AssertionError(f"unsupported filter {key}={value}")
        return True

    def _conflict(self, constraint: str) -> None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Database error: duplicate key value violates unique "
                f"constraint {constraint}"
            ),
        )

    def _check_unique(
        self, table: str, row: dict[str, Any], ignore: dict[str, Any] | None = None
    ) -> None:
        others = [r for r in self.tables[table] if r is not ignore]
        if table == "quiz" and row.get("slug") is not None:
            if any(r.get("slug") == row["slug"] for r in others):
                self._conflict("idx_quiz_slug")
        if table == "quiz_session":
            if any(r["token"] == row["token"] for r in others):
                self._conflict("quiz_session_token_key")
        if table == "quiz_answer":
            if any(
                str(r["session_id"]) == str(row["session_id"])
                and str(r["question_id"]) == str(row["question_id"])
                for r in others
            ):
                self._conflict("quiz_answer_session_question_unique")
        if table == "quiz_question":
            if any(
                str(r["quiz_id"]) == str(row["quiz_id"])
                and r["position"] == row["position"]
                for r in others
            ):
                self._conflict("quiz_question_position_unique")

    def _defaults(self, table: str) -> dict[str, Any]:
        now = f"2026-08-01T01:00:{next(self._seq) % 60:02d}+00:00"
        if table == "quiz":
            return {
                "state": "building",
                "slug": None,
                "score_to_beat_correct": None,
                "score_to_beat_total": None,
                "seed_session_id": None,
                "version": 0,
                "classified_count": 0,
                "created_at": now,
                "updated_at": now,
                "revoked_at": None,
                "objects_deleted_at": None,
            }
        if table == "quiz_session":
            return {
                "display_name": None,
                "score": 0,
                "completed_at": None,
                "hidden": False,
                "created_at": f"2026-08-01T01:00:00.{next(self._seq):06d}+00:00",
            }
        return {"created_at": now}

    async def get(self, table, params=None):
        return [
            copy.deepcopy(r) for r in self.tables[table] if self._matches(r, params)
        ]

    async def post(self, table, data):
        items = data if isinstance(data, list) else [data]
        inserted = []
        for item in items:
            row = {**self._defaults(table), **item}
            row.setdefault("id", str(uuid4()))
            self._check_unique(table, row)
            self.tables[table].append(row)
            inserted.append(copy.deepcopy(row))
        return inserted

    async def patch(self, table, data, params=None):
        updated = []
        for r in self.tables[table]:
            if self._matches(r, params):
                self._check_unique(table, {**r, **data}, ignore=r)
                r.update(data)
                updated.append(copy.deepcopy(r))
        return updated

    async def rpc(self, function, params=None):
        params = params or {}
        if function == "increment_quiz_funnel":
            # Emulates the increment_quiz_funnel() upsert from migration 0060.
            quiz_id = str(params["p_quiz_id"])
            event = params["p_event"]
            for row in self.tables["quiz_funnel"]:
                if str(row["quiz_id"]) == quiz_id and row["event"] == event:
                    row["count"] += 1
                    return None
            self.tables["quiz_funnel"].append(
                {"quiz_id": quiz_id, "event": event, "count": 1}
            )
            return None
        if function == "reserve_daily_classification":
            # Emulates the atomic reserve from migration 0060: a scalar
            # boolean body, True iff the reservation fit under the cap.
            count = int(params["p_count"])
            cap = int(params["p_cap"])
            if self.daily_classified + count > cap:
                return False
            self.daily_classified += count
            return True
        raise AssertionError(f"unsupported rpc {function}")

    async def delete(self, table, params):
        removed = [r for r in self.tables[table] if self._matches(r, params)]
        self.tables[table] = [r for r in self.tables[table] if r not in removed]
        # Emulate the FK ON DELETE CASCADE chains from migration 0060.
        if table == "quiz":
            for r in removed:
                await self.delete("quiz_question", {"quiz_id": f"eq.{r['id']}"})
                await self.delete("quiz_session", {"quiz_id": f"eq.{r['id']}"})
                await self.delete("quiz_funnel", {"quiz_id": f"eq.{r['id']}"})
        if table == "quiz_question":
            for r in removed:
                await self.delete("quiz_answer", {"question_id": f"eq.{r['id']}"})
        if table == "quiz_session":
            for r in removed:
                await self.delete("quiz_answer", {"session_id": f"eq.{r['id']}"})
        return [copy.deepcopy(r) for r in removed]


# ============================================================================
# Request helpers
# ============================================================================


@contextmanager
def api(db: FakeDB, user_id: str = TEST_USER_ID, http: AsyncMock | None = None):
    app.dependency_overrides[get_current_user] = mock_auth_dependency(
        AuthUser(user_id=user_id)
    )
    try:
        with ExitStack() as stack:
            stack.enter_context(
                patch("app.api.quiz.get_supabase_client", return_value=db)
            )
            if http is not None:
                stack.enter_context(
                    patch("app.api.quiz.get_http_client", return_value=http)
                )
            yield
    finally:
        app.dependency_overrides.clear()


def call(
    client: TestClient,
    db: FakeDB,
    method: str,
    url: str,
    json: Any | None = None,
    user_id: str = TEST_USER_ID,
    http: AsyncMock | None = None,
):
    with api(db, user_id=user_id, http=http):
        return client.request(method, url, headers=HEADERS, json=json)


def sign_http() -> AsyncMock:
    """Mock the Supabase Storage signed-upload-URL endpoint."""
    http = AsyncMock()

    def sign(url, headers=None, json=None):
        resp = MagicMock()
        resp.status_code = 200
        path = url.split("/storage/v1/object/upload/sign/media/", 1)[1]
        resp.json.return_value = {
            "url": f"/object/upload/sign/media/{path}?token=signed-token"
        }
        return resp

    http.post = AsyncMock(side_effect=sign)
    return http


def photos_for(quiz_id: str, codes: list[str], years: list[int | None] | None = None):
    years = years if years is not None else [2019] * len(codes)
    return [
        {
            "storage_path": f"quiz/{quiz_id}/photo-{i}.jpg",
            "country_code": code,
            "capture_year": year,
        }
        for i, (code, year) in enumerate(zip(codes, years, strict=True))
    ]


def finalize(
    client, db, quiz_id, photos=None, codes=None, years=None, user_id=TEST_USER_ID
):
    if photos is None:
        photos = photos_for(quiz_id, codes or CODES_10[:5], years)
    return call(
        client,
        db,
        "POST",
        f"/quiz/{quiz_id}/finalize",
        json={"photos": photos},
        user_id=user_id,
    )


def play(client, db, quiz_id, user_id=TEST_USER_ID):
    return call(client, db, "POST", f"/quiz/{quiz_id}/play", user_id=user_id)


def answer(
    client, db, quiz_id, session_id, question, *, correct=True, year_correct=True
):
    idx = question["correct_index"]
    if not correct:
        idx = (idx + 1) % 4
    year = None
    if question.get("capture_year") is not None:
        year = (
            question["capture_year"] if year_correct else question["capture_year"] - 1
        )
    return call(
        client,
        db,
        "POST",
        f"/quiz/{quiz_id}/answer",
        json={
            "session_id": session_id,
            "question_id": question["id"],
            "selected_option_index": idx,
            "selected_year": year,
        },
    )


def answer_all(
    client, db, quiz_id, session_id, wrong_positions=(), wrong_year_positions=()
):
    results = []
    for q in db.questions(quiz_id):
        resp = answer(
            client,
            db,
            quiz_id,
            session_id,
            q,
            correct=q["position"] not in wrong_positions,
            year_correct=q["position"] not in wrong_year_positions,
        )
        assert resp.status_code == 200, resp.text
        results.append(resp.json())
    return results


def complete(client, db, quiz_id, session_id, user_id=TEST_USER_ID):
    return call(
        client,
        db,
        "POST",
        f"/quiz/{quiz_id}/complete",
        json={"session_id": session_id},
        user_id=user_id,
    )


def share(client, db, quiz_id, user_id=TEST_USER_ID):
    return call(client, db, "POST", f"/quiz/{quiz_id}/share", user_id=user_id)


def build_playable(client, db, n=5, wrong_positions=(), wrong_year_positions=()):
    """Full flow: seed draft -> finalize -> play -> answer all -> complete."""
    quiz_id = db.seed_quiz()
    resp = finalize(client, db, quiz_id, codes=CODES_10[:n])
    assert resp.status_code == 200, resp.text
    resp = play(client, db, quiz_id)
    assert resp.status_code == 201, resp.text
    session_id = resp.json()["session_id"]
    answer_all(
        client,
        db,
        quiz_id,
        session_id,
        wrong_positions=wrong_positions,
        wrong_year_positions=wrong_year_positions,
    )
    resp = complete(client, db, quiz_id, session_id)
    assert resp.status_code == 200, resp.text
    return quiz_id, session_id, resp.json()


# ============================================================================
# Creation: signed upload URLs (KTD5)
# ============================================================================


class TestUploadUrls:
    def test_mints_signed_urls_under_quiz_prefix(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        http = sign_http()
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/upload-urls",
            json={"count": 3},
            http=http,
        )
        assert resp.status_code == 200, resp.text
        uploads = resp.json()["uploads"]
        assert len(uploads) == 3
        paths = {u["storage_path"] for u in uploads}
        assert len(paths) == 3
        for u in uploads:
            # Quiz-owned, user-anonymous path: quiz/{quiz_id}/{random}
            assert u["storage_path"].startswith(f"quiz/{quiz_id}/")
            assert TEST_USER_ID not in u["storage_path"]
            assert TEST_USER_ID not in u["upload_url"]
            assert "token=signed-token" in u["upload_url"]
            assert u["upload_url"].startswith(
                "https://test.supabase.co/storage/v1/object/upload/sign/media/quiz/"
            )
            assert u["cache_control"] == "60"
        # Minted with the service role key, not a user JWT.
        for c in http.post.call_args_list:
            assert c.kwargs["headers"]["Authorization"] == "Bearer service-role-key"

    def test_upload_urls_other_users_quiz_404(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz(owner_id=OTHER_USER_ID)
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/upload-urls",
            json={"count": 1},
            http=sign_http(),
        )
        assert resp.status_code == 404

    def test_upload_urls_require_building_state(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz(state="shared", slug="c" * 32)
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/upload-urls",
            json={"count": 1},
            http=sign_http(),
        )
        assert resp.status_code == 409

    def test_upload_urls_allowed_pre_share_for_swap(self, client: TestClient) -> None:
        # Swap (R5) uploads a replacement photo in awaiting_owner_play or
        # playable, so the gate must admit every pre-share editable state.
        for state in ("awaiting_owner_play", "playable"):
            db = FakeDB()
            quiz_id = db.seed_quiz(state=state)
            resp = call(
                client,
                db,
                "POST",
                f"/quiz/{quiz_id}/upload-urls",
                json={"count": 1},
                http=sign_http(),
            )
            assert resp.status_code == 200, f"{state}: {resp.text}"


# ============================================================================
# Creation: finalize (photo bounds AE2, path guard, options KTD6)
# ============================================================================


class TestFinalize:
    @pytest.mark.parametrize("n", [5, 10])
    def test_valid_photo_counts_succeed(self, client: TestClient, n: int) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        resp = finalize(client, db, quiz_id, codes=CODES_10[:n])
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["state"] == "awaiting_owner_play"
        assert len(data["questions"]) == n
        assert db.quiz(quiz_id)["state"] == "awaiting_owner_play"
        assert len(db.questions(quiz_id)) == n

    @pytest.mark.parametrize("n", [4, 11])
    def test_out_of_range_photo_counts_rejected_with_guidance(
        self, client: TestClient, n: int
    ) -> None:
        """AE2: 4 or 11 photos are rejected with a guidance-shaped error."""
        db = FakeDB()
        quiz_id = db.seed_quiz()
        codes = (CODES_10 + ["KR"])[:n]
        resp = finalize(client, db, quiz_id, codes=codes)
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == "QUIZ_PHOTO_COUNT_OUT_OF_RANGE"
        assert detail["min"] == 5
        assert detail["max"] == 10
        assert detail["provided"] == n
        assert "photo" in detail["message"].lower()
        # Draft stays resumable.
        assert db.quiz(quiz_id)["state"] == "building"
        assert db.questions(quiz_id) == []

    def test_storage_path_outside_quiz_prefix_rejected(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        other_quiz = db.seed_quiz()
        photos = photos_for(quiz_id, CODES_10[:5])
        photos[2]["storage_path"] = f"quiz/{other_quiz}/photo-2.jpg"
        resp = finalize(client, db, quiz_id, photos=photos)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "QUIZ_INVALID_STORAGE_PATH"
        assert db.quiz(quiz_id)["state"] == "building"

    def test_traversal_storage_path_rejected(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        photos = photos_for(quiz_id, CODES_10[:5])
        photos[0]["storage_path"] = f"quiz/{quiz_id}/../{OTHER_USER_ID}/x.jpg"
        resp = finalize(client, db, quiz_id, photos=photos)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "QUIZ_INVALID_STORAGE_PATH"

    def test_unknown_country_rejected(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        resp = finalize(client, db, quiz_id, codes=["FR", "IT", "ES", "DE", "XX"])
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "QUIZ_UNKNOWN_COUNTRY"

    def test_finalize_non_building_quiz_conflicts(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200
        resp = finalize(client, db, quiz_id)
        assert resp.status_code == 409
        # The winner's questions survive the rejected re-finalize untouched.
        assert len(db.questions(quiz_id)) == 5

    def test_failed_question_insert_leaves_draft_retryable(
        self, client: TestClient
    ) -> None:
        """Finalize is questions-first, state-last: a failure at question
        insertion must leave the quiz in 'building' so the owner can simply
        retry -- never awaiting_owner_play with zero questions."""
        db = FakeDB()
        quiz_id = db.seed_quiz()
        real_post = db.post

        async def failing_post(table, data):
            if table == "quiz_question":
                raise HTTPException(status_code=500, detail="insert blew up")
            return await real_post(table, data)

        db.post = failing_post  # type: ignore[method-assign]
        resp = finalize(client, db, quiz_id)
        assert resp.status_code == 500
        assert db.quiz(quiz_id)["state"] == "building"
        assert db.questions(quiz_id) == []

        # The stranded draft is retryable: the same finalize now succeeds.
        db.post = real_post  # type: ignore[method-assign]
        retry = finalize(client, db, quiz_id)
        assert retry.status_code == 200, retry.text
        assert db.quiz(quiz_id)["state"] == "awaiting_owner_play"
        assert len(db.questions(quiz_id)) == 5

    def test_concurrent_finalize_one_wins_one_conflicts(
        self, client: TestClient
    ) -> None:
        """Two racing finalizes on one building draft: the state claim is the
        concurrency guard, so exactly one wins and the loser 409s WITHOUT
        deleting the winner's questions (the old questions-first order let the
        loser wipe them before its state patch failed)."""
        db = FakeDB()
        quiz_id = db.seed_quiz()

        # Finalize A wins: it claims the state and stores its questions.
        assert finalize(client, db, quiz_id).status_code == 200
        winner_questions = db.questions(quiz_id)
        assert len(winner_questions) == 5
        assert db.quiz(quiz_id)["state"] == "awaiting_owner_play"

        # Finalize B raced in behind A: it read the draft while it was still
        # 'building' (a stale snapshot) but reaches its conditional state-claim
        # only after A already flipped it to awaiting_owner_play. The claim
        # matches zero rows, so B 409s -- before its delete/insert can run.
        real_get = db.get

        async def stale_building_get(table, params=None):
            rows = await real_get(table, params)
            if table == "quiz":
                for r in rows:
                    r["state"] = "building"
            return rows

        db.get = stale_building_get  # type: ignore[method-assign]
        resp = finalize(client, db, quiz_id)
        assert resp.status_code == 409

        # Exactly one success: the winner's questions and state are untouched.
        db.get = real_get  # type: ignore[method-assign]
        assert db.questions(quiz_id) == winner_questions
        assert db.quiz(quiz_id)["state"] == "awaiting_owner_play"

    def test_options_stored_shuffled_with_server_only_answer_key(
        self, client: TestClient
    ) -> None:
        """KTD6: four options stored ordered; correct_index points at the
        correct country; decoys are distinct, valid countries, and never
        another question's correct answer (dedup within the quiz)."""
        db = FakeDB()
        quiz_id = db.seed_quiz()
        codes = CODES_10[:5]
        assert finalize(client, db, quiz_id, codes=codes).status_code == 200
        by_code = {c["code"]: c["name"] for c in COUNTRIES}
        correct_names = {by_code[c] for c in codes}
        for q, code in zip(db.questions(quiz_id), codes, strict=True):
            options = q["options"]
            assert len(options) == 4
            assert len(set(options)) == 4
            assert options[q["correct_index"]] == by_code[code]
            decoys = [o for i, o in enumerate(options) if i != q["correct_index"]]
            assert len(decoys) == 3
            for d in decoys:
                assert d in COUNTRY_NAMES  # present in country table
                assert d != by_code[code]
                assert d not in correct_names  # deduplicated within the quiz

    def test_thin_region_falls_back_to_wider_pool(self, client: TestClient) -> None:
        """Oceania has only 2 countries; decoys must still be 3 distinct."""
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert (
            finalize(client, db, quiz_id, codes=["NZ", "FR", "IT", "ES", "DE"])
        ).status_code == 200
        q = db.questions(quiz_id)[0]
        assert q["options"][q["correct_index"]] == "New Zealand"
        assert len(set(q["options"])) == 4
        assert all(o in COUNTRY_NAMES for o in q["options"])

    def test_year_options_bracket_capture_year(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        years: list[int | None] = [2015, 2019, 2024, None, 2019]
        assert (
            finalize(client, db, quiz_id, codes=CODES_10[:5], years=years)
        ).status_code == 200
        for q, year in zip(db.questions(quiz_id), years, strict=True):
            if year is None:
                assert q["capture_year"] is None
                assert q["year_options"] is None
            else:
                assert q["capture_year"] == year
                assert len(q["year_options"]) == 4
                assert len(set(q["year_options"])) == 4
                assert year in q["year_options"]


# ============================================================================
# Owner play: sanitized payloads, grading, seeding (AE3, KTD4)
# ============================================================================


class TestOwnerPlayPayloads:
    def test_question_payloads_contain_no_ground_truth(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200

        detail = call(client, db, "GET", f"/quiz/{quiz_id}")
        assert detail.status_code == 200
        play_resp = play(client, db, quiz_id)
        assert play_resp.status_code == 201

        for payload in (detail.json()["questions"], play_resp.json()["questions"]):
            assert len(payload) == 5
            for q in payload:
                assert "correct_index" not in q
                assert "capture_year" not in q
                assert "correct" not in str(sorted(q.keys()))
                assert len(q["options"]) == 4
                assert q["image_url"].startswith(
                    "https://test.supabase.co/storage/v1/object/public/media/quiz/"
                )


class TestGradingAndSeeding:
    def test_grading_correct_and_incorrect(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200
        session_id = play(client, db, quiz_id).json()["session_id"]
        questions = db.questions(quiz_id)

        right = answer(client, db, quiz_id, session_id, questions[0], correct=True)
        assert right.status_code == 200
        body = right.json()
        assert body["place_correct"] is True
        assert (
            body["correct_option"]
            == questions[0]["options"][questions[0]["correct_index"]]
        )
        assert body["score"] == 1

        wrong = answer(client, db, quiz_id, session_id, questions[1], correct=False)
        assert wrong.status_code == 200
        body = wrong.json()
        assert body["place_correct"] is False
        assert (
            body["correct_option"]
            == questions[1]["options"][questions[1]["correct_index"]]
        )
        assert body["score"] == 1  # unchanged by a wrong answer

    def test_year_grading(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200
        session_id = play(client, db, quiz_id).json()["session_id"]
        questions = db.questions(quiz_id)

        good = answer(client, db, quiz_id, session_id, questions[0], year_correct=True)
        assert good.json()["year_correct"] is True
        bad = answer(client, db, quiz_id, session_id, questions[1], year_correct=False)
        assert bad.json()["year_correct"] is False
        assert bad.json()["correct_year"] == questions[1]["capture_year"]

    def test_duplicate_answer_conflicts(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200
        session_id = play(client, db, quiz_id).json()["session_id"]
        q = db.questions(quiz_id)[0]
        assert answer(client, db, quiz_id, session_id, q).status_code == 200
        assert answer(client, db, quiz_id, session_id, q).status_code == 409

    async def test_constraint_backstop_returns_clean_409(self) -> None:
        """The pre-check and insert are not atomic: a concurrent duplicate can
        pass the pre-check and trip the UNIQUE (session_id, question_id)
        constraint at insert. PostgREST surfaces that as a 409 with a raw DB
        detail; grade_answer must normalize it to the SAME clean documented
        message the pre-check raises, and the already-recorded answer (hence
        the derived score) must be unaffected."""
        from app.services.quiz_grading import grade_answer

        db = FakeDB()
        session_id = str(uuid4())
        question_id = str(uuid4())
        # A committed graded answer already exists for this (session, question).
        db.tables["quiz_answer"].append(
            {
                "id": str(uuid4()),
                "session_id": session_id,
                "question_id": question_id,
                "selected_option_index": 0,
                "selected_year": None,
                "place_correct": True,
                "year_correct": False,
            }
        )

        # Simulate the race window: the pre-check SELECT misses the existing
        # row (as if the concurrent insert had not been visible at read time),
        # so grading proceeds to the insert -- which trips the unique
        # constraint (FakeDB raises the raw-DB 409, like PostgREST does).
        real_get = db.get

        async def precheck_misses(table, params=None):
            if table == "quiz_answer" and params and "question_id" in params:
                return []
            return await real_get(table, params)

        db.get = precheck_misses  # type: ignore[method-assign]

        with pytest.raises(HTTPException) as exc_info:
            await grade_answer(
                db,
                session={"id": session_id},
                question={
                    "id": question_id,
                    "correct_index": 0,
                    "options": ["A", "B", "C", "D"],
                    "capture_year": None,
                },
                selected_option_index=1,
            )

        assert exc_info.value.status_code == 409
        assert (
            exc_info.value.detail
            == "This question has already been answered in this session."
        )
        # The insert was rejected: the original answer is the only row, and its
        # recorded correctness (the score input) is untouched.
        recorded = db.find("quiz_answer", session_id=session_id)
        assert len(recorded) == 1
        assert recorded[0]["place_correct"] is True

    def test_final_score_matches_recorded_answers(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, session_id, result = build_playable(
            client, db, n=6, wrong_positions=(1, 4)
        )
        assert result["correct"] == 4
        assert result["total"] == 6
        session = db.find("quiz_session", id=session_id)[0]
        assert session["score"] == 4
        recorded = db.find("quiz_answer", session_id=session_id)
        assert sum(1 for a in recorded if a["place_correct"]) == 4

    def test_completion_seeds_score_to_beat_and_memory_score_stays_private(
        self, client: TestClient
    ) -> None:
        """AE3: completing owner play seeds the pair; the memory (year) score
        appears only in the owner results payload, never on the quiz row or
        any share-facing field."""
        db = FakeDB()
        quiz_id, _, result = build_playable(
            client, db, n=5, wrong_positions=(0,), wrong_year_positions=(1, 2)
        )
        quiz = db.quiz(quiz_id)
        assert quiz["score_to_beat_correct"] == 4
        assert quiz["score_to_beat_total"] == 5
        assert quiz["state"] == "playable"
        # Owner results payload carries the memory score...
        assert result["memory_correct"] == 3
        assert result["memory_total"] == 5
        assert result["score_to_beat"] == {"correct": 4, "total": 5}
        # ...but nothing memory-shaped is stored on the quiz row.
        assert not any("memory" in k or "year" in k for k in quiz)
        # And the owner detail payload exposes only the place pair.
        detail = call(client, db, "GET", f"/quiz/{quiz_id}").json()
        assert detail["score_to_beat"] == {"correct": 4, "total": 5}
        assert "memory" not in str(sorted(detail.keys()))

    def test_replay_never_reseeds(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)  # seeds (5,5)
        # Replay: everything wrong.
        session_id = play(client, db, quiz_id).json()["session_id"]
        answer_all(client, db, quiz_id, session_id, wrong_positions=(0, 1, 2, 3, 4))
        resp = complete(client, db, quiz_id, session_id)
        assert resp.status_code == 200
        assert resp.json()["correct"] == 0
        # Score-to-beat is permanently the first completed play.
        assert resp.json()["score_to_beat"] == {"correct": 5, "total": 5}
        quiz = db.quiz(quiz_id)
        assert quiz["score_to_beat_correct"] == 5
        assert quiz["score_to_beat_total"] == 5

    def test_double_completion_seeds_once(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200
        session_id = play(client, db, quiz_id).json()["session_id"]
        answer_all(client, db, quiz_id, session_id, wrong_positions=(0,))
        first = complete(client, db, quiz_id, session_id)
        assert first.status_code == 200
        completed_at = db.find("quiz_session", id=session_id)[0]["completed_at"]
        second = complete(client, db, quiz_id, session_id)
        assert second.status_code == 200
        quiz = db.quiz(quiz_id)
        assert quiz["score_to_beat_correct"] == 4
        assert quiz["score_to_beat_total"] == 5
        # First completion time is preserved.
        assert db.find("quiz_session", id=session_id)[0]["completed_at"] == completed_at

    def test_completion_persists_seed_session_id(self, client: TestClient) -> None:
        """The seeding patch records WHICH session won, atomically with the
        pair; a replay's completion never overwrites it."""
        db = FakeDB()
        quiz_id, session_id, _ = build_playable(client, db, n=5)
        assert db.quiz(quiz_id)["seed_session_id"] == session_id

        replay_id = play(client, db, quiz_id).json()["session_id"]
        answer_all(client, db, quiz_id, replay_id)
        assert complete(client, db, quiz_id, replay_id).status_code == 200
        assert db.quiz(quiz_id)["seed_session_id"] == session_id

    def test_rescoring_uses_persisted_seed_session_not_earliest_created(
        self, client: TestClient
    ) -> None:
        """An owner session started EARLIER but completed later must never
        hijack rescoring: swap/remove rescale from quiz.seed_session_id, not
        from min(created_at) over completed owner sessions."""
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id, codes=CODES_10[:6]).status_code == 200

        # Session A is created first, then abandoned mid-run.
        session_a = play(client, db, quiz_id).json()["session_id"]
        # Session B seeds: created later, completed first, all correct.
        session_b = play(client, db, quiz_id).json()["session_id"]
        answer_all(client, db, quiz_id, session_b)
        assert complete(client, db, quiz_id, session_b).status_code == 200
        assert db.quiz(quiz_id)["seed_session_id"] == session_b

        # The abandoned earlier session is now finished -- badly.
        answer_all(client, db, quiz_id, session_a, wrong_positions=(0, 1))
        assert complete(client, db, quiz_id, session_a).status_code == 200
        quiz = db.quiz(quiz_id)
        assert (quiz["score_to_beat_correct"], quiz["score_to_beat_total"]) == (6, 6)

        # Removing a question rescales from B (the persisted seeder): 5/5.
        # The legacy min(created_at) pick would have rescaled from A: 3/5.
        target = next(q for q in db.questions(quiz_id) if q["position"] == 5)
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}/questions/{target['id']}")
        assert resp.status_code == 200, resp.text
        quiz = db.quiz(quiz_id)
        assert (quiz["score_to_beat_correct"], quiz["score_to_beat_total"]) == (5, 5)

    def test_legacy_null_seed_session_falls_back_to_first_completed(
        self, client: TestClient
    ) -> None:
        """Rows seeded before seed_session_id existed (none in prod) still
        rescale from the owner's first completed session."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=6, wrong_positions=(2,))
        db.quiz(quiz_id)["seed_session_id"] = None  # legacy row

        target = next(q for q in db.questions(quiz_id) if q["position"] == 2)
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}/questions/{target['id']}")
        assert resp.status_code == 200, resp.text
        quiz = db.quiz(quiz_id)
        assert (quiz["score_to_beat_correct"], quiz["score_to_beat_total"]) == (5, 5)

    def test_incomplete_play_cannot_complete(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200
        session_id = play(client, db, quiz_id).json()["session_id"]
        answer(client, db, quiz_id, session_id, db.questions(quiz_id)[0])
        resp = complete(client, db, quiz_id, session_id)
        assert resp.status_code == 409
        assert db.quiz(quiz_id)["score_to_beat_correct"] is None


# ============================================================================
# Pre-share editing: swap and remove (KTD7)
# ============================================================================


class TestSwapAndRemove:
    def test_swap_requires_answering_replacement_before_share(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id, session_id, _ = build_playable(client, db, n=5)  # (5,5)
        target = db.questions(quiz_id)[0]
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/questions/{target['id']}/swap",
            json={
                "storage_path": f"quiz/{quiz_id}/replacement.jpg",
                "country_code": "JP",
                "capture_year": 2021,
            },
        )
        assert resp.status_code == 200, resp.text

        # The replacement question is stored with fresh options and photo.
        swapped = db.find("quiz_question", id=target["id"])[0]
        assert swapped["storage_path"] == f"quiz/{quiz_id}/replacement.jpg"
        assert swapped["options"][swapped["correct_index"]] == "Japan"
        assert swapped["capture_year"] == 2021
        # Its old owner answers are gone.
        assert db.find("quiz_answer", question_id=target["id"]) == []

        # Share is blocked until the owner answers the replacement.
        blocked = share(client, db, quiz_id)
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["code"] == "QUIZ_OWNER_ANSWERS_INCOMPLETE"

        # Owner answers the replacement (country + year) in the seeding session.
        resp = answer(client, db, quiz_id, session_id, swapped, correct=True)
        assert resp.status_code == 200
        shared = share(client, db, quiz_id)
        assert shared.status_code == 200, shared.text
        # Pair reflects the re-answered set.
        quiz = db.quiz(quiz_id)
        assert (quiz["score_to_beat_correct"], quiz["score_to_beat_total"]) == (5, 5)

    def test_remove_rescales_score_pair(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=6, wrong_positions=(2,))
        quiz = db.quiz(quiz_id)
        assert (quiz["score_to_beat_correct"], quiz["score_to_beat_total"]) == (5, 6)
        # Remove the question the owner got wrong.
        target = next(q for q in db.questions(quiz_id) if q["position"] == 2)
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}/questions/{target['id']}")
        assert resp.status_code == 200, resp.text
        quiz = db.quiz(quiz_id)
        assert (quiz["score_to_beat_correct"], quiz["score_to_beat_total"]) == (5, 5)
        assert len(db.questions(quiz_id)) == 5
        assert db.find("quiz_answer", question_id=target["id"]) == []

    def test_remove_below_minimum_rejected(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        target = db.questions(quiz_id)[0]
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}/questions/{target['id']}")
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "QUIZ_PHOTO_COUNT_OUT_OF_RANGE"
        assert len(db.questions(quiz_id)) == 5

    def test_swap_after_share_conflicts(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        assert share(client, db, quiz_id).status_code == 200
        target = db.questions(quiz_id)[0]
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/questions/{target['id']}/swap",
            json={
                "storage_path": f"quiz/{quiz_id}/late.jpg",
                "country_code": "JP",
                "capture_year": 2021,
            },
        )
        assert resp.status_code == 409
        assert (
            db.find("quiz_question", id=target["id"])[0]["storage_path"]
            == target["storage_path"]
        )

    def test_remove_after_share_conflicts(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=6)
        assert share(client, db, quiz_id).status_code == 200
        target = db.questions(quiz_id)[0]
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}/questions/{target['id']}")
        assert resp.status_code == 409
        assert len(db.questions(quiz_id)) == 6

    def test_pre_share_edits_bump_version(self, client: TestClient) -> None:
        """Swap and remove each claim the edit by bumping quiz.version with
        the read version in the predicate -- the counter share asserts."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=6)
        assert db.quiz(quiz_id)["version"] == 0

        target = db.questions(quiz_id)[0]
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/questions/{target['id']}/swap",
            json={
                "storage_path": f"quiz/{quiz_id}/replacement.jpg",
                "country_code": "JP",
                "capture_year": 2021,
            },
        )
        assert resp.status_code == 200, resp.text
        assert db.quiz(quiz_id)["version"] == 1

        removable = next(q for q in db.questions(quiz_id) if q["position"] == 5)
        resp = call(
            client, db, "DELETE", f"/quiz/{quiz_id}/questions/{removable['id']}"
        )
        assert resp.status_code == 200, resp.text
        assert db.quiz(quiz_id)["version"] == 2

    def test_concurrent_share_wins_over_swap(self, client: TestClient) -> None:
        """The pre-share guard is a conditional write: when a concurrent share
        moves the quiz to 'shared' between read and write, the guard updates
        zero rows and the swap must 409 without touching anything."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        target = db.questions(quiz_id)[0]

        real_patch = db.patch
        calls = {"n": 0}

        async def racing_patch(table, data, params=None):
            # The first quiz-table patch swap issues is its state guard;
            # simulate the share committing just before it.
            if table == "quiz" and calls["n"] == 0:
                calls["n"] += 1
                await real_patch(
                    "quiz",
                    {"state": "shared", "slug": "f" * 32},
                    {"id": f"eq.{quiz_id}"},
                )
            return await real_patch(table, data, params)

        db.patch = racing_patch  # type: ignore[method-assign]
        resp = call(
            client,
            db,
            "POST",
            f"/quiz/{quiz_id}/questions/{target['id']}/swap",
            json={
                "storage_path": f"quiz/{quiz_id}/raced.jpg",
                "country_code": "JP",
                "capture_year": 2021,
            },
        )
        assert resp.status_code == 409
        # The share won; the question is untouched and its answers survive.
        assert (
            db.find("quiz_question", id=target["id"])[0]["storage_path"]
            == target["storage_path"]
        )
        assert db.find("quiz_answer", question_id=target["id"]) != []


# ============================================================================
# Share: slug minting, idempotency, locking (KTD8)
# ============================================================================


class TestShare:
    def test_share_mints_hex_slug_and_public_url(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        resp = share(client, db, quiz_id)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert SLUG_RE.match(data["slug"])
        assert data["share_url"] == f"https://example.com/q/{data['slug']}"
        assert data["state"] == "shared"
        assert db.quiz(quiz_id)["state"] == "shared"
        assert db.quiz(quiz_id)["slug"] == data["slug"]

    def test_sharing_twice_returns_same_slug(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        first = share(client, db, quiz_id).json()
        second = share(client, db, quiz_id)
        assert second.status_code == 200
        assert second.json()["slug"] == first["slug"]

    def test_slug_collision_retries_with_fresh_slug(self, client: TestClient) -> None:
        db = FakeDB()
        db.seed_quiz(state="shared", slug="a" * 32)  # existing quiz owns the slug
        quiz_id, _, _ = build_playable(client, db, n=5)
        with patch(
            "app.api.quiz._mint_slug", side_effect=["a" * 32, "b" * 32]
        ) as minted:
            resp = share(client, db, quiz_id)
        assert resp.status_code == 200, resp.text
        assert resp.json()["slug"] == "b" * 32
        assert minted.call_count == 2

    def test_share_before_owner_play_conflicts(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        assert finalize(client, db, quiz_id).status_code == 200
        resp = share(client, db, quiz_id)
        assert resp.status_code == 409
        assert db.quiz(quiz_id)["slug"] is None

    def test_share_after_edit_reads_bumped_version_and_succeeds(
        self, client: TestClient
    ) -> None:
        """A share issued AFTER an edit settles reads the post-bump version
        and proceeds normally -- the guard only kills stale interleavings."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=6)
        target = next(q for q in db.questions(quiz_id) if q["position"] == 5)
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}/questions/{target['id']}")
        assert resp.status_code == 200, resp.text
        assert db.quiz(quiz_id)["version"] == 1
        resp = share(client, db, quiz_id)
        assert resp.status_code == 200, resp.text
        assert db.quiz(quiz_id)["state"] == "shared"

    def test_stale_share_loses_to_concurrent_edit_version_bump(
        self, client: TestClient
    ) -> None:
        """Fix #7 (mitigation): a share that read the quiz BEFORE a
        concurrent swap/remove bumped the version must lose its conditional
        playable->shared write and 409 -- never freeze a quiz whose
        questions are mid-mutation."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)

        real_patch = db.patch
        calls = {"n": 0}

        async def racing_patch(table, data, params=None):
            # The first quiz-table patch share issues is its slug-minting
            # state write; simulate an edit's version bump landing between
            # share's owned-quiz read and that write.
            if table == "quiz" and calls["n"] == 0:
                calls["n"] += 1
                await real_patch(
                    "quiz",
                    {"version": 1},
                    {"id": f"eq.{quiz_id}", "version": "eq.0"},
                )
            return await real_patch(table, data, params)

        db.patch = racing_patch  # type: ignore[method-assign]
        resp = share(client, db, quiz_id)
        assert resp.status_code == 409
        assert resp.json()["detail"] == "The quiz changed while sharing. Please retry."
        quiz = db.quiz(quiz_id)
        assert quiz["state"] == "playable"  # the stale share never committed
        assert quiz["slug"] is None


# ============================================================================
# Revoke and draft deletion
# ============================================================================


class TestRevokeAndDelete:
    def test_revoke_shared_quiz(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        assert share(client, db, quiz_id).status_code == 200
        resp = call(client, db, "POST", f"/quiz/{quiz_id}/revoke")
        assert resp.status_code == 200
        assert resp.json()["objects_deleted"] is True
        quiz = db.quiz(quiz_id)
        assert quiz["state"] == "revoked"
        assert quiz["revoked_at"] is not None
        # U10: the (stubbed-successful) sweep verified the prefix empty.
        assert quiz["objects_deleted_at"] is not None

    def test_revoke_unshared_quiz_conflicts(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        resp = call(client, db, "POST", f"/quiz/{quiz_id}/revoke")
        assert resp.status_code == 409
        assert db.quiz(quiz_id)["state"] == "playable"

    def test_delete_draft(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert resp.status_code == 204
        assert db.find("quiz", id=quiz_id) == []

    def test_delete_playable_quiz_cascades(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, session_id, _ = build_playable(client, db, n=5)
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert resp.status_code == 204
        assert db.find("quiz", id=quiz_id) == []
        assert db.questions(quiz_id) == []
        assert db.find("quiz_session", id=session_id) == []
        assert db.find("quiz_answer", session_id=session_id) == []

    def test_delete_shared_quiz_conflicts(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        assert share(client, db, quiz_id).status_code == 200
        resp = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert resp.status_code == 409
        assert db.find("quiz", id=quiz_id) != []

    def test_delete_claims_row_revoked_before_sweeping_storage(
        self, client: TestClient
    ) -> None:
        """Fix #8: by the time the storage sweep runs, the row must already
        be claimed ('revoked'), so a concurrent share -- which needs
        state='playable' -- can no longer commit over vanishing photos."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        seen: dict[str, Any] = {}

        async def observing_sweep(qid):
            seen["state_at_sweep"] = db.quiz(quiz_id)["state"]

        with patch(
            "app.api.quiz.delete_quiz_storage_objects",
            new=AsyncMock(side_effect=observing_sweep),
        ):
            resp = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert resp.status_code == 204
        assert seen["state_at_sweep"] == "revoked"
        assert db.find("quiz", id=quiz_id) == []

    def test_concurrent_share_during_delete_conflicts_without_sweeping(
        self, client: TestClient
    ) -> None:
        """Fix #8: a share committing between delete's read and its claim
        makes the claim update zero rows -- delete must 409 with the photos
        untouched (the sweep never runs)."""
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)

        real_patch = db.patch
        calls = {"n": 0}

        async def racing_patch(table, data, params=None):
            # Delete's first quiz-table patch is its claim; simulate the
            # share going live just before it.
            if table == "quiz" and calls["n"] == 0:
                calls["n"] += 1
                await real_patch(
                    "quiz",
                    {"state": "shared", "slug": "e" * 32},
                    {"id": f"eq.{quiz_id}"},
                )
            return await real_patch(table, data, params)

        db.patch = racing_patch  # type: ignore[method-assign]
        sweep = AsyncMock()
        with patch("app.api.quiz.delete_quiz_storage_objects", new=sweep):
            resp = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert resp.status_code == 409
        assert "Revoke the share link" in resp.json()["detail"]
        sweep.assert_not_awaited()
        quiz = db.quiz(quiz_id)
        assert quiz["state"] == "shared"  # the live link survives intact
        assert quiz["slug"] == "e" * 32


# ============================================================================
# Isolation: ownership and coexisting quizzes (R17)
# ============================================================================


class TestIsolation:
    def test_second_quiz_same_owner_coexists(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_a, _, _ = build_playable(client, db, n=5)
        quiz_b = db.seed_quiz()
        assert (
            finalize(client, db, quiz_b, codes=["JP", "TH", "VN", "KR", "US"])
        ).status_code == 200
        assert share(client, db, quiz_a).status_code == 200
        # Quiz B is untouched by quiz A's lifecycle.
        assert db.quiz(quiz_b)["state"] == "awaiting_owner_play"
        assert db.quiz(quiz_b)["slug"] is None
        assert len(db.questions(quiz_b)) == 5
        assert len(db.questions(quiz_a)) == 5
        # And B can proceed independently.
        session_b = play(client, db, quiz_b).json()["session_id"]
        answer_all(client, db, quiz_b, session_b)
        assert complete(client, db, quiz_b, session_b).status_code == 200
        assert db.quiz(quiz_a)["state"] == "shared"

    def test_other_owner_cannot_read_share_or_revoke(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id, _, _ = build_playable(client, db, n=5)
        assert share(client, db, quiz_id).status_code == 200

        for method, url in [
            ("GET", f"/quiz/{quiz_id}"),
            ("POST", f"/quiz/{quiz_id}/share"),
            ("POST", f"/quiz/{quiz_id}/revoke"),
            ("DELETE", f"/quiz/{quiz_id}"),
        ]:
            resp = call(client, db, method, url, user_id=OTHER_USER_ID)
            assert resp.status_code == 404, f"{method} {url} -> {resp.status_code}"
        # Nothing changed.
        assert db.quiz(quiz_id)["state"] == "shared"
        assert db.find("quiz", id=quiz_id) != []

    def test_other_owner_cannot_finalize_or_play(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = db.seed_quiz()
        resp = finalize(client, db, quiz_id, user_id=OTHER_USER_ID)
        assert resp.status_code == 404
        assert finalize(client, db, quiz_id).status_code == 200
        resp = play(client, db, quiz_id, user_id=OTHER_USER_ID)
        assert resp.status_code == 404


# ============================================================================
# U11: GET /quiz -- the owner's quiz list
# ============================================================================


def seed_questions(db: FakeDB, quiz_id: str, count: int) -> None:
    for position in range(count):
        db.tables["quiz_question"].append(
            {
                "id": str(uuid4()),
                "quiz_id": quiz_id,
                "position": position,
                "storage_path": f"quiz/{quiz_id}/photo-{position}.jpg",
                "options": ["France", "Italy", "Spain", "Germany"],
                "correct_index": 0,
                "capture_year": None,
                "year_options": None,
            }
        )


class TestQuizList:
    def test_lists_owner_quizzes_newest_first_with_summaries(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        draft_id = db.seed_quiz()  # oldest
        shared_id = db.seed_quiz(
            state="shared",
            slug="a" * 32,
            score_to_beat_correct=3,
            score_to_beat_total=5,
        )
        revoked_id = db.seed_quiz(  # newest
            state="revoked",
            score_to_beat_correct=2,
            score_to_beat_total=5,
            revoked_at="2026-08-10T00:00:00+00:00",
        )
        seed_questions(db, shared_id, 5)
        seed_questions(db, revoked_id, 6)

        resp = call(client, db, "GET", "/quiz")
        assert resp.status_code == 200, resp.text
        quizzes = resp.json()["quizzes"]
        assert [q["id"] for q in quizzes] == [revoked_id, shared_id, draft_id]

        revoked, shared, draft = quizzes
        assert draft["state"] == "building"
        assert draft["question_count"] == 0
        assert draft["score_to_beat"] is None
        assert draft["slug"] is None
        assert draft["revoked_at"] is None
        assert draft["created_at"]

        assert shared["state"] == "shared"
        assert shared["question_count"] == 5
        assert shared["score_to_beat"] == {"correct": 3, "total": 5}
        assert shared["slug"] == "a" * 32
        assert shared["share_url"] == f"https://example.com/q/{'a' * 32}"

        assert revoked["state"] == "revoked"
        assert revoked["question_count"] == 6
        # A revoked quiz's slug serves nothing publicly and is not returned.
        assert revoked["slug"] is None
        assert revoked["share_url"] is None
        assert revoked["revoked_at"] == "2026-08-10T00:00:00+00:00"

    def test_list_excludes_other_users_quizzes(self, client: TestClient) -> None:
        db = FakeDB()
        mine = db.seed_quiz()
        db.seed_quiz(owner_id=OTHER_USER_ID)
        resp = call(client, db, "GET", "/quiz")
        assert resp.status_code == 200, resp.text
        assert [q["id"] for q in resp.json()["quizzes"]] == [mine]

    def test_list_empty_when_no_quizzes(self, client: TestClient) -> None:
        resp = call(client, FakeDB(), "GET", "/quiz")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quizzes": []}


# ============================================================================
# U11: GET /quiz/{quiz_id}/leaderboard -- the owner's board (R14)
# ============================================================================


def seed_session(
    db: FakeDB,
    quiz_id: str,
    name: str | None,
    score: int,
    *,
    completed_at: str | None = "auto",
    hidden: bool = False,
    token: str | None = None,
) -> str:
    seq = next(db._seq)
    row = {
        "id": str(uuid4()),
        "quiz_id": quiz_id,
        "token": token or f"tok-{uuid4().hex}",
        "display_name": name,
        "score": score,
        "completed_at": (
            f"2026-08-02T00:00:{seq:02d}+00:00"
            if completed_at == "auto"
            else completed_at
        ),
        "hidden": hidden,
        "created_at": f"2026-08-02T00:00:{seq:02d}+00:00",
    }
    db.tables["quiz_session"].append(row)
    return row["id"]


class TestOwnerLeaderboard:
    def seed_shared(self, db: FakeDB) -> str:
        return db.seed_quiz(
            state="shared",
            slug="b" * 32,
            score_to_beat_correct=3,
            score_to_beat_total=5,
        )

    def test_owner_board_aggregates_best_score_and_attempts(
        self, client: TestClient
    ) -> None:
        # AE4: one row per canonicalized name -- best score, attempt count.
        db = FakeDB()
        quiz_id = self.seed_shared(db)
        seed_session(db, quiz_id, "Maya", 2)
        seed_session(db, quiz_id, " maya ", 4)  # same identity after NFKC/trim/fold
        seed_session(db, quiz_id, "Sam", 3)

        resp = call(client, db, "GET", f"/quiz/{quiz_id}/leaderboard")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["score_to_beat"] == {"correct": 3, "total": 5}
        rows = body["leaderboard"]
        assert [(r["display_name"], r["best_score"], r["attempts"]) for r in rows] == [
            ("maya", 4, 2),
            ("Sam", 3, 1),
        ]
        assert all(r["hidden"] is False for r in rows)

    def test_owner_board_includes_hidden_entries_marked(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id = self.seed_shared(db)
        visible_id = seed_session(db, quiz_id, "Sam", 3)
        hidden_a = seed_session(db, quiz_id, "Troll", 5, hidden=True)
        hidden_b = seed_session(db, quiz_id, "Troll", 4, hidden=True)

        resp = call(client, db, "GET", f"/quiz/{quiz_id}/leaderboard")
        assert resp.status_code == 200, resp.text
        rows = {r["display_name"]: r for r in resp.json()["leaderboard"]}
        assert rows["Troll"]["hidden"] is True
        assert rows["Troll"]["best_score"] == 5
        assert rows["Troll"]["attempts"] == 2
        assert sorted(rows["Troll"]["session_ids"]) == sorted([hidden_a, hidden_b])
        assert rows["Sam"]["hidden"] is False
        assert rows["Sam"]["session_ids"] == [visible_id]

    def test_owner_board_excludes_owner_and_incomplete_sessions(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        quiz_id = self.seed_shared(db)
        seed_session(db, quiz_id, "Owner", 5, token=f"owner-{uuid4().hex}")
        seed_session(db, quiz_id, "MidGame", 2, completed_at=None)
        seed_session(db, quiz_id, None, 2)  # unnamed (e.g. post-revoke nulling)
        seed_session(db, quiz_id, "Sam", 3)

        resp = call(client, db, "GET", f"/quiz/{quiz_id}/leaderboard")
        assert resp.status_code == 200, resp.text
        assert [r["display_name"] for r in resp.json()["leaderboard"]] == ["Sam"]

    def test_hidden_session_stays_off_public_board_but_marked_for_owner(
        self, client: TestClient
    ) -> None:
        # Hiding through the owner endpoint removes the entry from the public
        # aggregation while the owner still sees it, marked.
        db = FakeDB()
        quiz_id = self.seed_shared(db)
        session_id = seed_session(db, quiz_id, "Troll", 5)
        resp = call(client, db, "POST", f"/quiz/{quiz_id}/sessions/{session_id}/hide")
        assert resp.status_code == 200, resp.text

        resp = call(client, db, "GET", f"/quiz/{quiz_id}/leaderboard")
        assert resp.status_code == 200, resp.text
        rows = resp.json()["leaderboard"]
        assert [(r["display_name"], r["hidden"]) for r in rows] == [("Troll", True)]

    def test_owner_board_404s_for_non_owner(self, client: TestClient) -> None:
        db = FakeDB()
        quiz_id = self.seed_shared(db)
        resp = call(
            client, db, "GET", f"/quiz/{quiz_id}/leaderboard", user_id=OTHER_USER_ID
        )
        assert resp.status_code == 404
