"""Tests for U10: physical quiz storage deletion on revoke, draft deletion,
and account deletion (R15, AE5, KTD7).

The two-phase contract under test:

- Phase one (already shipped): `revoked_at`/state gate ALL public serving --
  page, JSON API, card image -- the moment the conditional write commits.
- Phase two (U10): player display names are nulled (AE5), the ACTUAL
  quiz/{id}/ storage prefix is listed (not just DB-remembered paths), every
  object deleted, and the prefix RE-LISTED to verify emptiness before
  `objects_deleted_at` is set. Storage 404s are tolerated; real failures are
  never swallowed into success -- the quiz stays revoked-but-pending
  (objects_deleted_at null), the loud reconciliation surface.
- Reconciliation retry triggers: re-calling POST /quiz/{id}/revoke on an
  already-revoked quiz, and any owner GET /quiz/{id} detail read.
- Draft deletion and account deletion run the same sweep, failing loudly
  (rows/account kept) when the prefix cannot be verifiably emptied.

Mid-run anonymous players getting 404 on their next grade call after revoke
is covered by tests/test_public_quiz_api.py::
TestSlugGating::test_revocation_cuts_off_a_running_session -- not duplicated
here.

Storage is a stateful in-memory stand-in for the Supabase Storage HTTP API
(list + per-object delete on the `media` bucket); the DB is the FakeDB from
tests/api/test_quiz_api.py.
"""

import io
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user
from app.main import app, limiter
from tests.api.test_quiz_api import FakeDB, build_playable, call, share
from tests.conftest import OTHER_USER_ID, TEST_USER_ID, mock_auth_dependency

HEADERS = {"Authorization": "Bearer mock-jwt-token"}


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


# ============================================================================
# In-memory Supabase Storage stand-in (media bucket)
# ============================================================================


def _resp(status_code: int, body: Any = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = body if body is not None else {}
    return resp


class FakeStorage:
    """Stateful stand-in for the Supabase Storage HTTP API.

    Honors the two calls the sweep makes: POST .../object/list/media (folder
    listing by prefix, returning basenames) and DELETE .../object/media/{path}
    (200 on delete, 404 when absent). Paths in `fail_deletes` return 500,
    simulating a real (non-404) storage failure.
    """

    def __init__(self) -> None:
        self.objects: set[str] = set()
        self.deleted: list[str] = []
        self.fail_deletes: set[str] = set()
        self.list_calls: list[str] = []

    def under(self, prefix: str) -> set[str]:
        return {p for p in self.objects if p.startswith(prefix.rstrip("/") + "/")}

    async def post(self, url: str, headers=None, json=None):
        assert url.endswith("/storage/v1/object/list/media"), url
        assert headers["Authorization"] == "Bearer service-role-key"
        prefix = str(json["prefix"]).rstrip("/")
        self.list_calls.append(prefix)
        names = sorted(
            p[len(prefix) + 1 :] for p in self.objects if p.startswith(prefix + "/")
        )
        return _resp(200, [{"name": n} for n in names])

    async def delete(self, url: str, headers=None):
        assert headers["Authorization"] == "Bearer service-role-key"
        path = url.split("/storage/v1/object/media/", 1)[1]
        if path in self.fail_deletes:
            return _resp(500, {"message": "storage backend error"})
        if path in self.objects:
            self.objects.discard(path)
            self.deleted.append(path)
            return _resp(200, {"message": "deleted"})
        return _resp(404, {"message": "not found"})


def seed_storage(db: FakeDB, storage: FakeStorage, quiz_id: str) -> set[str]:
    """Put the quiz's question photos in storage, PLUS a stray object under
    the prefix that no question references (an uploaded-but-swapped-away
    photo): the sweep must clear the actual prefix, not just stored paths."""
    paths = {q["storage_path"] for q in db.questions(quiz_id)}
    paths.add(f"quiz/{quiz_id}/{'d' * 32}.jpg")
    storage.objects |= paths
    return paths


@contextmanager
def storage_backend(storage: FakeStorage):
    with patch("app.services.quiz_storage.get_http_client", return_value=storage):
        yield


def revoke(client, db, storage, quiz_id, user_id=TEST_USER_ID):
    with storage_backend(storage):
        return call(client, db, "POST", f"/quiz/{quiz_id}/revoke", user_id=user_id)


def public(client: TestClient, db: FakeDB, method: str, url: str, json=None):
    with patch("app.api.public_quiz.get_supabase_client", return_value=db):
        return client.request(method, url, json=json)


def get_page(client: TestClient, db: FakeDB, slug: str, headers=None):
    with patch("app.api.public.get_supabase_client", return_value=db):
        return client.get(f"/q/{slug}", headers=headers or {})


def get_card(client: TestClient, db: FakeDB, slug: str, headers=None):
    # The card's photo fetch must succeed here: a failed fetch ships the
    # DEGRADED fallback, which deliberately carries no ETag and no freshness
    # (so caches can never pin it) -- these tests prime a validator off a
    # healthy live card instead.
    photo = io.BytesIO()
    Image.new("RGB", (8, 8), (20, 160, 90)).save(photo, format="PNG")
    http = AsyncMock()
    http.get = AsyncMock(return_value=httpx.Response(200, content=photo.getvalue()))
    with (
        patch("app.api.public.get_supabase_client", return_value=db),
        patch("app.api.public.get_http_client", return_value=http),
    ):
        return client.get(f"/q/{slug}/card.png", headers=headers or {})


def shared_quiz_with_objects(client, db, storage):
    quiz_id, _, _ = build_playable(client, db, n=5)
    resp = share(client, db, quiz_id)
    assert resp.status_code == 200, resp.text
    paths = seed_storage(db, storage, quiz_id)
    return quiz_id, resp.json()["slug"], paths


# ============================================================================
# Revoke: full sweep (AE5 / R15)
# ============================================================================


class TestRevokeSweep:
    def test_revoke_deletes_every_object_under_the_prefix(
        self, client: TestClient
    ) -> None:
        """AE5: every photo at the origin is deleted -- including objects
        under the prefix that no question row remembers -- and
        objects_deleted_at is set only after the verified sweep."""
        db = FakeDB()
        storage = FakeStorage()
        quiz_id, _, paths = shared_quiz_with_objects(client, db, storage)

        resp = revoke(client, db, storage, quiz_id)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["state"] == "revoked"
        assert body["objects_deleted"] is True

        # The storage delete calls covered the full listed prefix contents.
        assert set(storage.deleted) == paths
        assert storage.under(f"quiz/{quiz_id}") == set()
        # Verified: the sweep re-listed the prefix after deleting.
        assert storage.list_calls.count(f"quiz/{quiz_id}") >= 2

        quiz = db.quiz(quiz_id)
        assert quiz["state"] == "revoked"
        assert quiz["revoked_at"] is not None
        assert quiz["objects_deleted_at"] is not None

    def test_revoked_quiz_serves_nothing_publicly(self, client: TestClient) -> None:
        """AE5: page, public API, and card image all 404 after revoke."""
        db = FakeDB()
        storage = FakeStorage()
        quiz_id, slug, _ = shared_quiz_with_objects(client, db, storage)
        assert revoke(client, db, storage, quiz_id).status_code == 200

        assert get_page(client, db, slug).status_code == 404
        assert get_card(client, db, slug).status_code == 404
        assert (
            public(client, db, "POST", f"/q/{slug}/session", json={}).status_code == 404
        )
        assert public(client, db, "GET", f"/q/{slug}/leaderboard").status_code == 404

    def test_primed_validator_cannot_resurrect_after_revoke(
        self, client: TestClient
    ) -> None:
        """A page/card fetched (and its ETag primed) pre-revoke must 404 on
        the next request: slug resolution is uncached and state-gated."""
        db = FakeDB()
        storage = FakeStorage()
        quiz_id, slug, _ = shared_quiz_with_objects(client, db, storage)

        live_page = get_page(client, db, slug)
        assert live_page.status_code == 200
        live_card = get_card(client, db, slug)
        assert live_card.status_code == 200
        etag = live_card.headers["ETag"]

        assert revoke(client, db, storage, quiz_id).status_code == 200

        assert get_page(client, db, slug).status_code == 404
        primed = get_card(client, db, slug, headers={"If-None-Match": etag})
        assert primed.status_code == 404  # never a 304 resurrection

    def test_revoke_nulls_player_display_names_keeps_scores(
        self, client: TestClient
    ) -> None:
        """AE5 server-side completion: no third-party identity outlives the
        quiz, while score/attempt counters survive for the funnel."""
        db = FakeDB()
        storage = FakeStorage()
        quiz_id, _, _ = shared_quiz_with_objects(client, db, storage)
        for name, score in (("Priya", 4), ("Marco", 2)):
            db.tables["quiz_session"].append(
                {
                    "id": str(uuid4()),
                    "quiz_id": quiz_id,
                    "token": f"tok-{name}",
                    "display_name": name,
                    "score": score,
                    "completed_at": "2026-08-02T00:00:00+00:00",
                    "hidden": False,
                    "created_at": "2026-08-02T00:00:00+00:00",
                }
            )

        assert revoke(client, db, storage, quiz_id).status_code == 200

        sessions = db.find("quiz_session", quiz_id=quiz_id)
        assert sessions  # aggregate rows survive ...
        assert all(s["display_name"] is None for s in sessions)  # ... nameless
        scores = sorted(s["score"] for s in sessions if s["completed_at"] is not None)
        assert scores[-2:] == [2, 4] or set(scores) >= {2, 4}
        assert all(
            s["completed_at"] is not None
            for s in sessions
            if str(s["token"]).startswith("tok-")
        )


# ============================================================================
# Partial failure and reconciliation retries (KTD7)
# ============================================================================


class TestReconciliation:
    def test_partial_storage_failure_keeps_quiz_unserved_and_reconcilable(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        storage = FakeStorage()
        quiz_id, slug, paths = shared_quiz_with_objects(client, db, storage)
        stuck = sorted(paths)[0]
        storage.fail_deletes.add(stuck)

        resp = revoke(client, db, storage, quiz_id)
        assert resp.status_code == 200, resp.text
        # Never claims fully revoked while objects remain.
        assert resp.json()["objects_deleted"] is False

        quiz = db.quiz(quiz_id)
        assert quiz["state"] == "revoked"  # unserved ...
        assert quiz["revoked_at"] is not None
        assert quiz["objects_deleted_at"] is None  # ... and discoverable
        assert get_page(client, db, slug).status_code == 404
        assert public(client, db, "GET", f"/q/{slug}/leaderboard").status_code == 404

        # Explicit retry trigger: re-calling revoke completes the sweep.
        storage.fail_deletes.clear()
        retry = revoke(client, db, storage, quiz_id)
        assert retry.status_code == 200, retry.text
        assert retry.json()["objects_deleted"] is True
        assert storage.under(f"quiz/{quiz_id}") == set()
        assert db.quiz(quiz_id)["objects_deleted_at"] is not None

    def test_owner_detail_read_retries_pending_sweep(self, client: TestClient) -> None:
        """Passive retry trigger: any owner GET /quiz/{id} of a
        revoked-but-pending quiz re-runs the sweep."""
        db = FakeDB()
        storage = FakeStorage()
        quiz_id, _, paths = shared_quiz_with_objects(client, db, storage)
        storage.fail_deletes.add(sorted(paths)[0])
        assert revoke(client, db, storage, quiz_id).json()["objects_deleted"] is False
        assert db.quiz(quiz_id)["objects_deleted_at"] is None

        storage.fail_deletes.clear()
        with storage_backend(storage):
            resp = call(client, db, "GET", f"/quiz/{quiz_id}")
        assert resp.status_code == 200, resp.text
        assert storage.under(f"quiz/{quiz_id}") == set()
        assert db.quiz(quiz_id)["objects_deleted_at"] is not None


# ============================================================================
# Draft deletion
# ============================================================================


class TestDraftDeletion:
    def test_draft_delete_empties_prefix_and_removes_rows(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        storage = FakeStorage()
        quiz_id = db.seed_quiz()  # building draft, photos uploaded
        uploaded = {
            f"quiz/{quiz_id}/{'a' * 32}.jpg",
            f"quiz/{quiz_id}/{'b' * 32}.jpg",
        }
        storage.objects |= uploaded

        with storage_backend(storage):
            resp = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert resp.status_code == 204
        assert db.find("quiz", id=quiz_id) == []
        assert storage.under(f"quiz/{quiz_id}") == set()
        assert set(storage.deleted) == uploaded

    def test_draft_delete_storage_failure_keeps_rows_for_retry(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        storage = FakeStorage()
        quiz_id = db.seed_quiz()
        path = f"quiz/{quiz_id}/{'a' * 32}.jpg"
        storage.objects.add(path)
        storage.fail_deletes.add(path)

        with storage_backend(storage):
            resp = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert resp.status_code == 502
        # Rows kept: the quiz itself is the retry surface.
        assert db.find("quiz", id=quiz_id) != []

        storage.fail_deletes.clear()
        with storage_backend(storage):
            retry = call(client, db, "DELETE", f"/quiz/{quiz_id}")
        assert retry.status_code == 204
        assert db.find("quiz", id=quiz_id) == []
        assert storage.under(f"quiz/{quiz_id}") == set()


# ============================================================================
# Account deletion (at least as strong as revoke)
# ============================================================================


def delete_account(client: TestClient, db: FakeDB, storage: FakeStorage, auth_http):
    app.dependency_overrides[get_current_user] = mock_auth_dependency(
        AuthUser(user_id=TEST_USER_ID)
    )
    try:
        with (
            patch("app.api.profile.get_supabase_client", return_value=db),
            patch("app.api.profile.get_http_client", return_value=auth_http),
            storage_backend(storage),
        ):
            return client.delete("/profile", headers=HEADERS)
    finally:
        app.dependency_overrides.clear()


class TestAccountDeletion:
    def test_account_deletion_sweeps_every_owned_quiz_before_auth_delete(
        self, client: TestClient
    ) -> None:
        """Every owned quiz -- shared AND never-shared drafts -- has its
        prefix emptied BEFORE the auth-admin delete; other users' objects
        are untouched."""
        db = FakeDB()
        storage = FakeStorage()
        shared_id, _, _ = shared_quiz_with_objects(client, db, storage)
        draft_id = db.seed_quiz()  # building draft with uploaded photos
        storage.objects.add(f"quiz/{draft_id}/{'a' * 32}.jpg")
        other_id = db.seed_quiz(owner_id=OTHER_USER_ID)
        other_path = f"quiz/{other_id}/{'e' * 32}.jpg"
        storage.objects.add(other_path)

        snapshot: dict[str, Any] = {}

        async def auth_delete(url, headers=None):
            snapshot["url"] = url
            snapshot["objects_at_auth_delete"] = set(storage.objects)
            resp = MagicMock()
            resp.status_code = 200
            resp.raise_for_status = MagicMock()
            return resp

        auth_http = AsyncMock()
        auth_http.delete = AsyncMock(side_effect=auth_delete)

        resp = delete_account(client, db, storage, auth_http)
        assert resp.status_code == 200, resp.text
        auth_http.delete.assert_called_once()
        assert f"/auth/v1/admin/users/{TEST_USER_ID}" in snapshot["url"]

        # At auth-delete time, both owned prefixes were already empty.
        at_delete = snapshot["objects_at_auth_delete"]
        assert not {p for p in at_delete if p.startswith(f"quiz/{shared_id}/")}
        assert not {p for p in at_delete if p.startswith(f"quiz/{draft_id}/")}
        # The other user's object survives.
        assert other_path in storage.objects

    def test_account_deletion_aborts_loudly_on_storage_failure(
        self, client: TestClient
    ) -> None:
        db = FakeDB()
        storage = FakeStorage()
        quiz_id, _, paths = shared_quiz_with_objects(client, db, storage)
        storage.fail_deletes.add(sorted(paths)[0])

        auth_http = AsyncMock()
        resp = delete_account(client, db, storage, auth_http)
        assert resp.status_code == 500
        assert "Failed to delete account" in resp.json()["detail"]
        # No auth delete happened: the account (and its retry surface) lives.
        auth_http.delete.assert_not_called()
        assert db.find("quiz", id=quiz_id) != []
