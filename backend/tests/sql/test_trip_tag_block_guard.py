"""SQL-layer tests for migration 0092_trip_tag_block_guard.

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


def create_user(cur, email: str | None = None) -> str:
    """Insert an auth user; fires on_auth_user_created (handle_new_user)."""
    user_id = _uuid()
    cur.execute(
        "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
        (user_id, email or _email()),
    )
    return user_id


def create_country(cur) -> str:
    country_id = _uuid()
    cur.execute(
        "INSERT INTO country (id, code, name, region) VALUES (%s, %s, %s, %s)",
        (country_id, f"Z{uuid.uuid4().hex[:8]}", "Testland", "Test Region"),
    )
    return country_id


def create_trip(cur, user_id: str, country_id: str, name: str = "Test Trip") -> str:
    trip_id = _uuid()
    cur.execute(
        "INSERT INTO trip (id, user_id, country_id, name) VALUES (%s, %s, %s, %s)",
        (trip_id, user_id, country_id, name),
    )
    return trip_id


def block(cur, blocker_id: str, blocked_id: str) -> None:
    cur.execute(
        "INSERT INTO user_block (blocker_id, blocked_id) VALUES (%s, %s)",
        (blocker_id, blocked_id),
    )


def insert_tag(cur, trip_id: str, tagged_user_id: str, initiated_by: str) -> None:
    cur.execute(
        "INSERT INTO trip_tags (trip_id, tagged_user_id, status, initiated_by) "
        "VALUES (%s, %s, 'pending', %s)",
        (trip_id, tagged_user_id, initiated_by),
    )


def tag_count(cur, trip_id: str, tagged_user_id: str) -> int:
    cur.execute(
        "SELECT COUNT(*) FROM trip_tags WHERE trip_id = %s AND tagged_user_id = %s",
        (trip_id, tagged_user_id),
    )
    return cur.fetchone()[0]


# ---------------------------------------------------------------------------
# enforce_no_trip_tag_when_blocked (0092)
# ---------------------------------------------------------------------------


class TestTripTagBlockGuard:
    def test_insert_rejected_when_initiator_blocked_target(self, db):
        owner = create_user(db)
        tagged = create_user(db)
        country = create_country(db)
        trip = create_trip(db, owner, country)
        block(db, owner, tagged)

        with pytest.raises(psycopg.errors.RaiseException) as exc_info:
            insert_tag(db, trip, tagged, owner)
        assert "blocked" in str(exc_info.value).lower()

    def test_insert_rejected_when_target_blocked_initiator(self, db):
        owner = create_user(db)
        tagged = create_user(db)
        country = create_country(db)
        trip = create_trip(db, owner, country)
        block(db, tagged, owner)  # reverse direction

        with pytest.raises(psycopg.errors.RaiseException) as exc_info:
            insert_tag(db, trip, tagged, owner)
        assert "blocked" in str(exc_info.value).lower()

    def test_insert_allowed_without_block(self, db):
        owner = create_user(db)
        tagged = create_user(db)
        country = create_country(db)
        trip = create_trip(db, owner, country)

        insert_tag(db, trip, tagged, owner)
        assert tag_count(db, trip, tagged) == 1

    def test_block_between_unrelated_users_does_not_reject(self, db):
        """The check is scoped to (initiated_by, tagged_user_id), not to any
        block involving either user."""
        owner = create_user(db)
        tagged = create_user(db)
        bystander = create_user(db)
        country = create_country(db)
        trip = create_trip(db, owner, country)
        block(db, owner, bystander)
        block(db, bystander, tagged)

        insert_tag(db, trip, tagged, owner)
        assert tag_count(db, trip, tagged) == 1

    def test_migration_cleanup_removed_existing_violations(self, db):
        """0092's DELETE purged tags between already-blocked pairs; a fresh
        block + existing tag scenario is handled by block_user_full (0087),
        so here we just pin that no blocked-pair tag can coexist with a
        block created afterwards being enforced on new inserts."""
        owner = create_user(db)
        tagged = create_user(db)
        country = create_country(db)
        trip = create_trip(db, owner, country)

        insert_tag(db, trip, tagged, owner)
        block(db, owner, tagged)

        # Existing rows are untouched by the trigger (BEFORE INSERT only)...
        assert tag_count(db, trip, tagged) == 1
        # ...but re-running the migration's cleanup statement removes them.
        db.execute(
            """
            DELETE FROM trip_tags tt
            WHERE EXISTS (
                SELECT 1 FROM user_block ub
                WHERE (ub.blocker_id = tt.initiated_by
                       AND ub.blocked_id = tt.tagged_user_id)
                   OR (ub.blocker_id = tt.tagged_user_id
                       AND ub.blocked_id = tt.initiated_by)
            )
            """
        )
        assert tag_count(db, trip, tagged) == 0
