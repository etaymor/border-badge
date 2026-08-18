"""SQL-layer tests for migration 0089_search_block_exclusion (plan U3).

Covers the two SECURITY DEFINER RPCs that move search/lookup block
exclusion into SQL:
  - search_users_excluding_blocked
  - lookup_user_by_email_excluding_blocked

These run against a REAL Postgres with the full migration set applied
(e.g. a Supabase local stack). They are skipped unless the
SUPABASE_DB_URL environment variable is set, and every test runs inside a
transaction that is rolled back, so the target database is left untouched.

Run with:
    SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
        pytest -m sql backend/tests/sql/
"""

import json
import os
import uuid

import pytest

DB_URL = os.environ.get("SUPABASE_DB_URL")

pytestmark = [
    pytest.mark.sql,
    pytest.mark.skipif(
        not DB_URL,
        reason="SUPABASE_DB_URL not set; SQL tests need a real Postgres "
        "with migrations applied",
    ),
]

psycopg = pytest.importorskip(
    "psycopg", reason="psycopg is required for SQL-layer tests"
)


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def db():
    """One transaction per test, always rolled back."""
    conn = psycopg.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            yield cur
    finally:
        conn.rollback()
        conn.close()


def _uuid() -> str:
    return str(uuid.uuid4())


def _email() -> str:
    return f"sqltest-{uuid.uuid4().hex[:12]}@example.com"


def create_user(cur, email: str | None = None, username: str | None = None) -> str:
    """Insert an auth user (fires handle_new_user), optionally pin a username."""
    user_id = _uuid()
    cur.execute(
        "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
        (user_id, email or _email()),
    )
    if username is not None:
        cur.execute(
            "UPDATE user_profile SET username = %s WHERE user_id = %s",
            (username, user_id),
        )
    return user_id


def block(cur, blocker_id: str, blocked_id: str) -> None:
    cur.execute(
        "INSERT INTO user_block (blocker_id, blocked_id) VALUES (%s, %s)",
        (blocker_id, blocked_id),
    )


def set_jwt(cur, user_id: str) -> None:
    """Simulate a PostgREST-authenticated caller so auth.uid() resolves."""
    claims = json.dumps({"sub": user_id, "role": "authenticated"})
    cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims,))


def search(cur, query: str, limit: int = 10) -> list[str]:
    """Call search_users_excluding_blocked, return matched usernames."""
    cur.execute(
        "SELECT username FROM search_users_excluding_blocked(%s, %s)",
        (query, limit),
    )
    return [row[0] for row in cur.fetchall()]


def lookup(cur, email: str, requester_id: str) -> list[str]:
    """Call lookup_user_by_email_excluding_blocked, return matched usernames."""
    cur.execute(
        "SELECT username FROM lookup_user_by_email_excluding_blocked(%s, %s)",
        (email, requester_id),
    )
    return [row[0] for row in cur.fetchall()]


def _prefix() -> str:
    """Unique username prefix so seeded data can never collide."""
    return f"zz{uuid.uuid4().hex[:10]}"


# ---------------------------------------------------------------------------
# search_users_excluding_blocked
# ---------------------------------------------------------------------------


class TestSearchUsersExcludingBlocked:
    def test_prefix_match_case_insensitive(self, db):
        prefix = _prefix()
        caller = create_user(db)
        create_user(db, username=f"{prefix}_traveler")
        set_jwt(db, caller)

        assert search(db, prefix.upper()) == [f"{prefix}_traveler"]

    def test_excludes_caller(self, db):
        prefix = _prefix()
        caller = create_user(db, username=f"{prefix}_me")
        create_user(db, username=f"{prefix}_other")
        set_jwt(db, caller)

        assert search(db, prefix) == [f"{prefix}_other"]

    def test_excludes_user_blocked_by_caller(self, db):
        prefix = _prefix()
        caller = create_user(db)
        target = create_user(db, username=f"{prefix}_blocked")
        block(db, caller, target)
        set_jwt(db, caller)

        assert search(db, prefix) == []

    def test_excludes_user_who_blocked_caller(self, db):
        prefix = _prefix()
        caller = create_user(db)
        target = create_user(db, username=f"{prefix}_blocker")
        block(db, target, caller)
        set_jwt(db, caller)

        assert search(db, prefix) == []

    def test_underscore_is_literal_not_wildcard(self, db):
        prefix = _prefix()
        caller = create_user(db)
        create_user(db, username=f"{prefix}_a")
        create_user(db, username=f"{prefix}xa")
        set_jwt(db, caller)

        # An unescaped LIKE '_' would match both; the RPC escapes it.
        assert search(db, f"{prefix}_") == [f"{prefix}_a"]

    def test_requires_authenticated_caller(self, db):
        create_user(db, username=f"{_prefix()}_user")
        # No JWT set: auth.uid() is NULL
        with pytest.raises(psycopg.errors.RaiseException):
            search(db, "anything")

    def test_limit_is_clamped(self, db):
        prefix = _prefix()
        caller = create_user(db)
        for i in range(3):
            create_user(db, username=f"{prefix}_u{i}")
        set_jwt(db, caller)

        assert len(search(db, prefix, limit=2)) == 2
        # Absurd limits are clamped rather than honored
        assert len(search(db, prefix, limit=100000)) == 3


# ---------------------------------------------------------------------------
# lookup_user_by_email_excluding_blocked
# ---------------------------------------------------------------------------


class TestLookupUserByEmailExcludingBlocked:
    def test_finds_user_by_email(self, db):
        requester = create_user(db)
        email = _email()
        create_user(db, email=email, username=f"{_prefix()}_found")

        result = lookup(db, email.upper(), requester)
        assert len(result) == 1

    def test_excludes_requester_self(self, db):
        email = _email()
        requester = create_user(db, email=email)

        assert lookup(db, email, requester) == []

    def test_excludes_when_requester_blocked_target(self, db):
        requester = create_user(db)
        email = _email()
        target = create_user(db, email=email)
        block(db, requester, target)

        assert lookup(db, email, requester) == []

    def test_excludes_when_target_blocked_requester(self, db):
        requester = create_user(db)
        email = _email()
        target = create_user(db, email=email)
        block(db, target, requester)

        assert lookup(db, email, requester) == []

    def test_unknown_email_returns_no_rows(self, db):
        requester = create_user(db)

        assert lookup(db, _email(), requester) == []
