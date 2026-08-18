"""SQL-layer tests for migration 0090_fanout_coalescing_and_pruning (plan U5).

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


def create_user(cur) -> str:
    user_id = _uuid()
    cur.execute(
        "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
        (user_id, _email()),
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


def create_entries(cur, trip_id: str, n: int) -> list[str]:
    """Insert n entries in ONE statement (one statement-trigger firing)."""
    ids = [_uuid() for _ in range(n)]
    args = []
    for entry_id in ids:
        args.extend([entry_id, trip_id])
    values = ", ".join(["(%s, %s, 'place', 'Test Entry')"] * n)
    cur.execute(
        f"INSERT INTO entry (id, trip_id, type, title) VALUES {values}",
        args,
    )
    return ids


def follow(cur, follower_id: str, following_id: str) -> None:
    cur.execute(
        "INSERT INTO user_follow (follower_id, following_id) VALUES (%s, %s)",
        (follower_id, following_id),
    )


def event_rows(cur, trip_id: str) -> list[tuple]:
    cur.execute(
        "SELECT id, activity_type, event_day, created_at, payload "
        "FROM social_activity_event WHERE trip_id = %s",
        (trip_id,),
    )
    return cur.fetchall()


def inbox_count(cur, recipient_id: str, actor_id: str | None = None) -> int:
    if actor_id is None:
        cur.execute(
            "SELECT COUNT(*) FROM social_feed_inbox WHERE recipient_id = %s",
            (recipient_id,),
        )
    else:
        cur.execute(
            "SELECT COUNT(*) FROM social_feed_inbox "
            "WHERE recipient_id = %s AND actor_id = %s",
            (recipient_id, actor_id),
        )
    return cur.fetchone()[0]


# ---------------------------------------------------------------------------
# Coalescing: bounded write amplification
# ---------------------------------------------------------------------------


class TestEntryCoalescing:
    def test_100_entries_10_followers_bounded_events_and_inbox(self, db):
        """The R12 scenario: 100 entries on one trip with 10 followers must
        produce a handful of events (here: exactly 1 coalesced trip_updated)
        and bounded inbox writes (1 per follower), not 1000 rows."""
        author = create_user(db)
        followers = [create_user(db) for _ in range(10)]
        for f in followers:
            follow(db, f, author)
        trip = create_trip(db, author, create_country(db))

        # 50 in one bulk statement + 50 single-row inserts: both shapes must
        # coalesce into the same (trip, day) event.
        create_entries(db, trip, 50)
        for _ in range(50):
            create_entries(db, trip, 1)

        rows = event_rows(db, trip)
        assert len(rows) == 1
        assert rows[0][1] == "trip_updated"
        assert rows[0][4]["entry_count"] == 100

        # No per-entry events were emitted.
        db.execute(
            "SELECT COUNT(*) FROM social_activity_event sae "
            "JOIN entry e ON e.id = sae.entry_id WHERE e.trip_id = %s",
            (trip,),
        )
        assert db.fetchone()[0] == 0

        # Each follower holds exactly ONE inbox row for the author.
        for f in followers:
            assert inbox_count(db, f, author) == 1

    def test_one_card_per_trip_per_day(self, db):
        """A second day of activity gets its own coalesced event."""
        author = create_user(db)
        trip = create_trip(db, author, create_country(db))

        create_entries(db, trip, 3)
        rows = event_rows(db, trip)
        assert len(rows) == 1

        # Simulate the existing event belonging to yesterday's window.
        db.execute(
            "UPDATE social_activity_event "
            "SET event_day = event_day - 1, "
            "    created_at = created_at - interval '1 day' "
            "WHERE trip_id = %s",
            (trip,),
        )

        create_entries(db, trip, 2)
        rows = event_rows(db, trip)
        assert len(rows) == 2
        days = sorted(r[2] for r in rows)
        assert days[0] < days[1]

    def test_two_trips_same_day_get_separate_events(self, db):
        author = create_user(db)
        country = create_country(db)
        trip_a = create_trip(db, author, country, name="A")
        trip_b = create_trip(db, author, country, name="B")

        create_entries(db, trip_a, 5)
        create_entries(db, trip_b, 5)

        assert len(event_rows(db, trip_a)) == 1
        assert len(event_rows(db, trip_b)) == 1

    def test_midwindow_follower_receives_coalesced_event_on_next_touch(self, db):
        """A follower gained mid-window gets the daily event when the trip is
        touched again (the upsert's fan-out arm inserts missing inbox rows)."""
        author = create_user(db)
        trip = create_trip(db, author, create_country(db))
        create_entries(db, trip, 3)

        late_follower = create_user(db)
        follow(db, late_follower, author)
        # The on-follow backfill would also deliver the event; wipe it to
        # isolate the mid-window fan-out path of the coalescing upsert.
        db.execute(
            "DELETE FROM social_feed_inbox WHERE recipient_id = %s",
            (late_follower,),
        )
        assert inbox_count(db, late_follower, author) == 0

        create_entries(db, trip, 1)

        assert inbox_count(db, late_follower, author) == 1
        # Still one coalesced event, now counting 4 entries.
        rows = event_rows(db, trip)
        assert len(rows) == 1
        assert rows[0][4]["entry_count"] == 4

    def test_retouch_refreshes_inbox_created_at(self, db):
        """Feed ordering reads INBOX timestamps: a re-touch must bump the
        follower's inbox row so the coalesced card resurfaces."""
        author = create_user(db)
        reader = create_user(db)
        follow(db, reader, author)
        trip = create_trip(db, author, create_country(db))
        create_entries(db, trip, 1)

        # Backdate the inbox row (simulating an earlier touch).
        db.execute(
            "UPDATE social_feed_inbox "
            "SET created_at = created_at - interval '6 hours' "
            "WHERE recipient_id = %s",
            (reader,),
        )
        db.execute(
            "SELECT created_at FROM social_feed_inbox WHERE recipient_id = %s",
            (reader,),
        )
        backdated = db.fetchone()[0]

        create_entries(db, trip, 1)

        db.execute(
            "SELECT COUNT(*), MAX(created_at) FROM social_feed_inbox "
            "WHERE recipient_id = %s",
            (reader,),
        )
        n, refreshed = db.fetchone()
        assert n == 1  # still one row, not a duplicate
        assert refreshed > backdated

    def test_entry_restore_touches_the_daily_event(self, db):
        """Restoring a soft-deleted entry re-touches the coalesced event
        (statement-level replacement for 0082's per-row restore trigger)."""
        author = create_user(db)
        trip = create_trip(db, author, create_country(db))
        (entry_id,) = create_entries(db, trip, 1)

        db.execute("UPDATE entry SET deleted_at = now() WHERE id = %s", (entry_id,))
        db.execute("UPDATE entry SET deleted_at = NULL WHERE id = %s", (entry_id,))

        rows = event_rows(db, trip)
        assert len(rows) == 1
        assert rows[0][4]["entry_count"] == 2  # initial insert + restore touch

    def test_trip_updated_requires_event_day(self, db):
        """The stored-day CHECK rejects trip_updated rows without event_day."""
        author = create_user(db)
        trip = create_trip(db, author, create_country(db))
        db.execute("SAVEPOINT missing_day")
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO social_activity_event (actor_id, activity_type, trip_id) "
                "VALUES (%s, 'trip_updated', %s)",
                (author, trip),
            )
        db.execute("ROLLBACK TO SAVEPOINT missing_day")

    def test_on_follow_backfill_delivers_visible_trip_updated_only(self, db):
        """New followers receive coalesced events for live trips but not for
        soft-deleted ones (0090's addition to the filter-before-budget fix)."""
        author = create_user(db)
        country = create_country(db)
        live_trip = create_trip(db, author, country, name="Live")
        doomed_trip = create_trip(db, author, country, name="Doomed")
        create_entries(db, live_trip, 2)
        create_entries(db, doomed_trip, 2)
        db.execute("UPDATE trip SET deleted_at = now() WHERE id = %s", (doomed_trip,))

        reader = create_user(db)
        follow(db, reader, author)

        db.execute(
            "SELECT sae.trip_id FROM social_feed_inbox sfi "
            "JOIN social_activity_event sae ON sae.id = sfi.activity_id "
            "WHERE sfi.recipient_id = %s",
            (reader,),
        )
        trip_ids = {row[0] for row in db.fetchall()}
        assert uuid.UUID(live_trip) in {uuid.UUID(str(t)) for t in trip_ids}
        assert uuid.UUID(doomed_trip) not in {uuid.UUID(str(t)) for t in trip_ids}


# ---------------------------------------------------------------------------
# Pruning
# ---------------------------------------------------------------------------


def seed_synthetic_feed(cur, author: str, reader: str, n: int) -> str:
    """One trip, n trip_updated events on distinct days, all mirrored into
    the reader's inbox. created_at is spread hourly (newest first at i=0)."""
    trip = create_trip(cur, author, create_country(cur), name="Prune trip")
    for i in range(n):
        event_id = _uuid()
        cur.execute(
            "INSERT INTO social_activity_event "
            "  (id, actor_id, activity_type, trip_id, event_day, created_at, payload) "
            "VALUES (%s, %s, 'trip_updated', %s, "
            "        (now() AT TIME ZONE 'utc')::date - %s, "
            "        now() - (%s * interval '1 hour'), "
            "        '{\"entry_count\": 1}'::jsonb)",
            (event_id, author, trip, i, i),
        )
        cur.execute(
            "INSERT INTO social_feed_inbox "
            "  (recipient_id, activity_id, actor_id, created_at) "
            "VALUES (%s, %s, %s, now() - (%s * interval '1 hour'))",
            (reader, event_id, author, i),
        )
    return trip


class TestPruning:
    def test_prune_caps_inbox_at_500_per_recipient(self, db):
        author = create_user(db)
        reader = create_user(db)
        follow(db, reader, author)
        trip = seed_synthetic_feed(db, author, reader, 520)

        # Small batch size forces the batched loop to take multiple passes.
        db.execute(
            "SELECT * FROM prune_social_feed("
            "  p_keep_per_recipient := 500,"
            "  p_max_age := interval '10 years',"
            "  p_batch_size := 7,"
            "  p_max_batches := 50)"
        )
        inbox_deleted, events_deleted = db.fetchone()

        assert inbox_deleted == 20
        assert inbox_count(db, reader) == 500
        # Zero-ref events are age-guarded: nothing is younger than 10 years,
        # so the 20 now-unreferenced events survive this run.
        assert events_deleted == 0
        db.execute(
            "SELECT COUNT(*) FROM social_activity_event WHERE trip_id = %s",
            (trip,),
        )
        assert db.fetchone()[0] == 520

        # The 500 survivors are the NEWEST 500.
        db.execute(
            "SELECT MIN(created_at) >= now() - interval '500 hours' "
            "FROM social_feed_inbox WHERE recipient_id = %s",
            (reader,),
        )
        assert db.fetchone()[0] is True

    def test_prune_age_decay_and_zero_ref_event_deletion(self, db):
        author = create_user(db)
        reader = create_user(db)
        follow(db, reader, author)
        trip = seed_synthetic_feed(db, author, reader, 30)

        # Everything older than 5 hours decays; events with zero remaining
        # inbox references AND older than the window are deleted too.
        db.execute(
            "SELECT * FROM prune_social_feed("
            "  p_keep_per_recipient := 500,"
            "  p_max_age := interval '5 hours',"
            "  p_batch_size := 4,"
            "  p_max_batches := 50)"
        )
        inbox_deleted, events_deleted = db.fetchone()

        # i in 0..5 survive (created_at = now() - i hours; the i=5 row equals
        # the cutoff exactly and the comparison is strict): 6 rows.
        assert inbox_count(db, reader) == 6
        assert inbox_deleted == 24
        assert events_deleted == 24
        db.execute(
            "SELECT COUNT(*) FROM social_activity_event WHERE trip_id = %s",
            (trip,),
        )
        assert db.fetchone()[0] == 6

    def test_prune_keeps_recent_events_of_followerless_users(self, db):
        """The age guard: a follower-less user's fresh events have zero inbox
        references but must survive pruning (profile feed reads events)."""
        loner = create_user(db)
        trip = create_trip(db, loner, create_country(db))
        create_entries(db, trip, 3)
        assert len(event_rows(db, trip)) == 1

        db.execute("SELECT * FROM prune_social_feed()")
        db.fetchone()

        assert len(event_rows(db, trip)) == 1
