"""SQL-layer tests for migration 0088: feed schema + compound keyset cursors.

Scenarios (from the social merge hardening plan, U4):
- 30 events sharing one timestamp paginate losslessly at page size 20.
- The cursor tuple from page N returns page N+1 exactly.
- Existing enum values survive the social_activity_type enum -> TEXT conversion.
- An insert with an unknown activity_type string fails the CHECK constraint.
- The widened source CHECK admits the trip arm (trip_updated + trip_id).

Requires SUPABASE_DB_URL (a superuser/service connection string to a database
with all migrations applied) and the ``psycopg`` package; auto-skips otherwise.
All writes happen inside a single transaction that is rolled back, so the
target database is left untouched.
"""

import os
import uuid
from datetime import UTC, datetime

import pytest

pytestmark = [
    pytest.mark.sql,
    pytest.mark.skipif(
        not os.environ.get("SUPABASE_DB_URL"),
        reason="SUPABASE_DB_URL not set; SQL-layer tests need a migrated database",
    ),
]

SHARED_TS = datetime(2024, 3, 1, 12, 0, 0, tzinfo=UTC)
EVENT_COUNT = 30
PAGE_SIZE = 20


@pytest.fixture()
def db():
    """Yield a psycopg connection whose transaction is rolled back afterwards."""
    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=False)
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture()
def seeded_feed(db) -> tuple[str, str]:
    """Create an actor with 30 same-timestamp events and one follower.

    Returns (actor_id, follower_id). Events are created through the real
    user_countries triggers, then all event/inbox timestamps are normalized to
    a single shared timestamp so pagination must rely on the id tiebreaker.
    """
    actor_id = str(uuid.uuid4())
    follower_id = str(uuid.uuid4())
    with db.cursor() as cur:
        for user_id, username in (
            (actor_id, f"sqltest_actor_{actor_id[:8]}"),
            (follower_id, f"sqltest_follower_{follower_id[:8]}"),
        ):
            cur.execute(
                """
                INSERT INTO auth.users (id, email, raw_user_meta_data)
                VALUES (%s, %s, jsonb_build_object('username', %s))
                """,
                (user_id, f"{username}@example.com", username),
            )
            # handle_new_user normally creates the profile; upsert defensively
            # in case the local stack lacks the auth trigger.
            cur.execute(
                """
                INSERT INTO user_profile (user_id, display_name, username, is_test)
                VALUES (%s, %s, %s, true)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id, username, username),
            )

        # Follower follows actor BEFORE events exist, so fan-out (not the
        # follow backfill and its LIMIT 50) populates the inbox.
        cur.execute(
            "INSERT INTO user_follow (follower_id, following_id) VALUES (%s, %s)",
            (follower_id, actor_id),
        )

        # 30 visited countries at one shared timestamp -> 30 events + inbox rows
        cur.execute("SELECT id FROM country ORDER BY code LIMIT %s", (EVENT_COUNT,))
        country_ids = [row[0] for row in cur.fetchall()]
        assert len(country_ids) == EVENT_COUNT, "reference data must be seeded"
        for country_id in country_ids:
            cur.execute(
                """
                INSERT INTO user_countries (user_id, country_id, status, created_at)
                VALUES (%s, %s, 'visited', %s)
                """,
                (actor_id, country_id, SHARED_TS),
            )

        # Triggers copy NEW.created_at, but normalize explicitly so the test
        # cannot silently degrade into distinct-timestamp pagination.
        cur.execute(
            "UPDATE social_activity_event SET created_at = %s WHERE actor_id = %s",
            (SHARED_TS, actor_id),
        )
        cur.execute(
            "UPDATE social_feed_inbox SET created_at = %s WHERE recipient_id = %s",
            (SHARED_TS, follower_id),
        )
    return actor_id, follower_id


def _fetch_page(db, rpc_sql: str, params: tuple) -> list[dict]:
    with db.cursor() as cur:
        cur.execute(rpc_sql, params)
        columns = [desc.name for desc in cur.description]
        return [dict(zip(columns, row, strict=True)) for row in cur.fetchall()]


def _assert_lossless_two_pages(db, rpc_sql: str, base_params: tuple) -> None:
    """Shared assertion: 30 tied-timestamp events paginate 20 + 10 exactly."""
    everything = _fetch_page(db, rpc_sql, (*base_params, None, 100, None))
    assert len(everything) == EVENT_COUNT
    all_ids = [row["activity_id"] for row in everything]
    assert len(set(all_ids)) == EVENT_COUNT

    page1_plus = _fetch_page(db, rpc_sql, (*base_params, None, PAGE_SIZE, None))
    assert len(page1_plus) == PAGE_SIZE + 1  # RPC returns limit + 1 for has_more
    page1 = page1_plus[:PAGE_SIZE]
    cursor_ts = page1[-1]["created_at"]
    cursor_id = page1[-1]["activity_id"]

    page2 = _fetch_page(db, rpc_sql, (*base_params, cursor_ts, PAGE_SIZE, cursor_id))
    assert len(page2) == EVENT_COUNT - PAGE_SIZE

    # Page 2 is exactly the remainder of the full ordering: no loss, no dupes.
    assert [row["activity_id"] for row in page1] == all_ids[:PAGE_SIZE]
    assert [row["activity_id"] for row in page2] == all_ids[PAGE_SIZE:]


def test_home_feed_paginates_losslessly_at_timestamp_ties(db, seeded_feed) -> None:
    _actor_id, follower_id = seeded_feed
    _assert_lossless_two_pages(
        db,
        "SELECT * FROM get_activity_feed(%s, %s, %s, %s)",
        (follower_id,),
    )


def test_user_feed_paginates_losslessly_at_timestamp_ties(db, seeded_feed) -> None:
    actor_id, follower_id = seeded_feed
    _assert_lossless_two_pages(
        db,
        "SELECT * FROM get_user_activity_feed(%s, %s, %s, %s, %s)",
        (follower_id, actor_id),
    )


def test_legacy_timestamp_only_cursor_still_filters(db, seeded_feed) -> None:
    """A NULL p_before_id falls back to created_at-only comparison."""
    _actor_id, follower_id = seeded_feed
    rows = _fetch_page(
        db,
        "SELECT * FROM get_activity_feed(%s, %s, %s, %s)",
        (follower_id, SHARED_TS, PAGE_SIZE, None),
    )
    # All events share SHARED_TS, so a strict created_at < filter excludes all.
    assert rows == []


def test_activity_type_is_text_and_existing_values_survive(db, seeded_feed) -> None:
    actor_id, _follower_id = seeded_feed
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'social_activity_event'
              AND column_name = 'activity_type'
            """
        )
        assert cur.fetchone()[0] == "text"

        cur.execute("SELECT to_regtype('social_activity_type')")
        assert cur.fetchone()[0] is None, "enum type should be dropped"

        cur.execute(
            """
            SELECT count(*) FROM social_activity_event
            WHERE actor_id = %s AND activity_type = 'country_visited'
            """,
            (actor_id,),
        )
        assert cur.fetchone()[0] == EVENT_COUNT


def test_unknown_activity_type_fails_check(db, seeded_feed) -> None:
    psycopg = pytest.importorskip("psycopg")
    actor_id, _follower_id = seeded_feed
    with db.cursor() as cur:
        cur.execute(
            "SELECT id FROM user_countries WHERE user_id = %s LIMIT 1", (actor_id,)
        )
        user_country_id = cur.fetchone()[0]
        cur.execute("SAVEPOINT unknown_type")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                """
                INSERT INTO social_activity_event
                  (actor_id, activity_type, user_country_id)
                VALUES (%s, 'bogus_type', %s)
                """,
                (actor_id, user_country_id),
            )
        cur.execute("ROLLBACK TO SAVEPOINT unknown_type")


def test_trip_arm_admits_trip_updated_events(db, seeded_feed) -> None:
    """The widened source CHECK accepts trip_updated + trip_id + payload."""
    actor_id, _follower_id = seeded_feed
    with db.cursor() as cur:
        cur.execute("SELECT id FROM country ORDER BY code LIMIT 1")
        country_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO trip (user_id, country_id, name)
            VALUES (%s, %s, 'SQL test trip') RETURNING id
            """,
            (actor_id, country_id),
        )
        trip_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO social_activity_event
              (actor_id, activity_type, trip_id, payload)
            VALUES (%s, 'trip_updated', %s, '{"entry_count": 3}'::jsonb)
            RETURNING id
            """,
            (actor_id, trip_id),
        )
        assert cur.fetchone()[0] is not None
