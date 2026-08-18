"""SQL-layer tests for migration 0091_push_token_rekey (plan U10, KTD11).

These run against a REAL Postgres with the full migration set applied
(e.g. a Supabase local stack or a disposable database). They are skipped
unless the SUPABASE_DB_URL environment variable is set, and every test runs
inside a transaction that is rolled back, so the target database is left
untouched.

Run with:
    SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
        pytest -m sql backend/tests/sql/
"""

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


def create_user(cur) -> str:
    user_id = _uuid()
    cur.execute(
        "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
        (user_id, _email()),
    )
    return user_id


def register_token(cur, user_id: str, token: str) -> None:
    """The backend's registration upsert: ON CONFLICT (token) DO UPDATE."""
    cur.execute(
        """
        INSERT INTO push_token (user_id, token, platform, updated_at)
        VALUES (%s, %s, 'ios', now())
        ON CONFLICT (token) DO UPDATE SET
            user_id = excluded.user_id,
            platform = excluded.platform,
            updated_at = excluded.updated_at
        """,
        (user_id, token),
    )


def token_owners(cur, token: str) -> list[str]:
    cur.execute("SELECT user_id::text FROM push_token WHERE token = %s", (token,))
    return [row[0] for row in cur.fetchall()]


def user_tokens(cur, user_id: str) -> set[str]:
    cur.execute("SELECT token FROM push_token WHERE user_id = %s", (user_id,))
    return {row[0] for row in cur.fetchall()}


# ---------------------------------------------------------------------------
# Multi-device: one user, many tokens
# ---------------------------------------------------------------------------


def test_one_user_can_hold_multiple_device_tokens(db) -> None:
    """The old UNIQUE (user_id) is gone: a second device registers alongside
    the first instead of replacing it."""
    user = create_user(db)
    register_token(db, user, "ExponentPushToken[sql-a]")
    register_token(db, user, "ExponentPushToken[sql-b]")

    assert user_tokens(db, user) == {
        "ExponentPushToken[sql-a]",
        "ExponentPushToken[sql-b]",
    }


# ---------------------------------------------------------------------------
# Ownership: a token belongs to at most one user
# ---------------------------------------------------------------------------


def test_reregistration_transfers_token_ownership(db) -> None:
    """User B re-registering user A's device token takes it over in one
    statement; A stops holding the token and only B's claim remains."""
    user_a = create_user(db)
    user_b = create_user(db)
    token = "ExponentPushToken[sql-shared]"

    register_token(db, user_a, token)
    register_token(db, user_b, token)

    assert token_owners(db, token) == [user_b]
    assert user_tokens(db, user_a) == set()


def test_duplicate_token_insert_without_arbiter_rejected(db) -> None:
    """UNIQUE (token) enforces single ownership for plain inserts too."""
    user_a = create_user(db)
    user_b = create_user(db)
    token = "ExponentPushToken[sql-dup]"
    register_token(db, user_a, token)

    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute(
            "INSERT INTO push_token (user_id, token, platform) "
            "VALUES (%s, %s, 'ios')",
            (user_b, token),
        )


def test_transfer_keeps_other_devices_of_previous_owner(db) -> None:
    """Ownership transfer is per token: user A's other device keeps
    delivering after B takes over the shared device."""
    user_a = create_user(db)
    user_b = create_user(db)

    register_token(db, user_a, "ExponentPushToken[sql-a-own]")
    register_token(db, user_a, "ExponentPushToken[sql-handoff]")
    register_token(db, user_b, "ExponentPushToken[sql-handoff]")

    assert user_tokens(db, user_a) == {"ExponentPushToken[sql-a-own]"}
    assert token_owners(db, "ExponentPushToken[sql-handoff]") == [user_b]
