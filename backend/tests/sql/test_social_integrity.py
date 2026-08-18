"""SQL-layer tests for migration 0087_social_integrity (plan U2).

These run against a REAL Postgres with the full migration set applied
(e.g. a Supabase local stack or a disposable database). They are skipped
unless the SUPABASE_DB_URL environment variable is set, and every test runs
inside a transaction that is rolled back, so the target database is left
untouched.

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


def create_entry(cur, trip_id: str, created_at_sql: str = "now()") -> str:
    """Insert an entry; fires the statement-level coalescing trigger (0090),
    which upserts one trip_updated event per trip per day."""
    entry_id = _uuid()
    cur.execute(
        "INSERT INTO entry (id, trip_id, type, title, created_at) "
        f"VALUES (%s, %s, 'place', 'Test Entry', {created_at_sql})",
        (entry_id, trip_id),
    )
    return entry_id


def follow(cur, follower_id: str, following_id: str) -> None:
    cur.execute(
        "INSERT INTO user_follow (follower_id, following_id) VALUES (%s, %s)",
        (follower_id, following_id),
    )


def set_jwt(cur, user_id: str) -> None:
    """Simulate a PostgREST-authenticated caller so auth.uid() resolves."""
    claims = json.dumps({"sub": user_id, "role": "authenticated"})
    cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims,))


def count(cur, sql: str, params: tuple = ()) -> int:
    cur.execute(f"SELECT COUNT(*) FROM ({sql}) _q", params)
    return cur.fetchone()[0]


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


# Same statement as the one-time repair in 0087 (the migration ran it once;
# tests re-run it against fixture data to pin the predicate's behavior).
ORPHAN_PURGE_SQL = """
DELETE FROM social_feed_inbox sfi
WHERE NOT EXISTS (
    SELECT 1 FROM user_follow uf
    WHERE uf.follower_id = sfi.recipient_id
      AND uf.following_id = sfi.actor_id
  )
  OR EXISTS (
    SELECT 1 FROM user_block ub
    WHERE (ub.blocker_id = sfi.recipient_id AND ub.blocked_id = sfi.actor_id)
       OR (ub.blocker_id = sfi.actor_id AND ub.blocked_id = sfi.recipient_id)
  )
"""


# ---------------------------------------------------------------------------
# Signup / invite processing
# ---------------------------------------------------------------------------


class TestSignupInviteProcessing:
    def test_signup_with_pending_trip_tag_invite_creates_pending_tag(self, db):
        """Regression for the enum bug: 'PENDING' aborted every invited signup."""
        inviter = create_user(db)
        country = create_country(db)
        trip = create_trip(db, inviter, country)
        invitee_email = _email()
        db.execute(
            "INSERT INTO pending_invite (inviter_id, email, invite_type, trip_id) "
            "VALUES (%s, %s, 'trip_tag', %s)",
            (inviter, invitee_email, trip),
        )

        new_user = create_user(db, invitee_email)

        # Signup completed: profile exists
        assert (
            count(db, "SELECT 1 FROM user_profile WHERE user_id = %s", (new_user,)) == 1
        )
        # Tag created with lowercase 'pending', initiated by the trip owner
        db.execute(
            "SELECT status::text, initiated_by FROM trip_tags "
            "WHERE trip_id = %s AND tagged_user_id = %s",
            (trip, new_user),
        )
        row = db.fetchone()
        assert row is not None
        assert row[0] == "pending"
        assert row[1] == uuid.UUID(inviter)
        # Inviter follows the new user; invite marked accepted
        assert (
            count(
                db,
                "SELECT 1 FROM user_follow WHERE follower_id = %s AND following_id = %s",
                (inviter, new_user),
            )
            == 1
        )
        db.execute(
            "SELECT status::text, accepted_at FROM pending_invite "
            "WHERE inviter_id = %s AND LOWER(email) = LOWER(%s)",
            (inviter, invitee_email),
        )
        status, accepted_at = db.fetchone()
        assert status == "accepted"
        assert accepted_at is not None

    def test_signup_succeeds_when_invite_processing_raises(self, db):
        """The un-abortable guarantee: a poisoned invite path cannot fail signup."""
        db.execute(
            """
            CREATE OR REPLACE FUNCTION process_pending_invites_for_user(
              p_user_id UUID, p_email TEXT
            ) RETURNS INTEGER
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
            AS $poison$
            BEGIN
              RAISE EXCEPTION 'poisoned invite processing';
            END;
            $poison$
            """
        )

        new_user = create_user(db)

        assert (
            count(db, "SELECT 1 FROM user_profile WHERE user_id = %s", (new_user,)) == 1
        )

    def test_deleted_trip_invite_is_not_marked_accepted(self, db):
        """A trip_tag invite whose trip is gone stays pending (no-op != accepted)."""
        inviter = create_user(db)
        country = create_country(db)
        trip = create_trip(db, inviter, country)
        invitee_email = _email()
        db.execute(
            "INSERT INTO pending_invite (inviter_id, email, invite_type, trip_id) "
            "VALUES (%s, %s, 'trip_tag', %s)",
            (inviter, invitee_email, trip),
        )
        db.execute("UPDATE trip SET deleted_at = now() WHERE id = %s", (trip,))

        new_user = create_user(db, invitee_email)

        assert (
            count(db, "SELECT 1 FROM user_profile WHERE user_id = %s", (new_user,)) == 1
        )
        assert (
            count(db, "SELECT 1 FROM trip_tags WHERE tagged_user_id = %s", (new_user,))
            == 0
        )
        db.execute(
            "SELECT status::text FROM pending_invite WHERE inviter_id = %s",
            (inviter,),
        )
        assert db.fetchone()[0] == "pending"

    def test_one_bad_invite_does_not_drop_the_rest(self, db):
        """Per-invite exception handling inside the loop.

        A follow invite from an inviter who is in a blocked pair with the
        invitee raises via enforce_no_follow_when_blocked; the healthy invite
        from another inviter must still be processed.
        """
        good_inviter = create_user(db)
        bad_inviter = create_user(db)
        target = create_user(db)
        target_email = _email()
        db.execute(
            "INSERT INTO user_block (blocker_id, blocked_id) VALUES (%s, %s)",
            (bad_inviter, target),
        )
        for inviter in (good_inviter, bad_inviter):
            db.execute(
                "INSERT INTO pending_invite (inviter_id, email, invite_type) "
                "VALUES (%s, %s, 'follow')",
                (inviter, target_email),
            )

        db.execute(
            "SELECT process_pending_invites_for_user(%s, %s)",
            (target, target_email),
        )
        processed = db.fetchone()[0]

        assert processed == 1
        assert (
            count(
                db,
                "SELECT 1 FROM user_follow WHERE follower_id = %s AND following_id = %s",
                (good_inviter, target),
            )
            == 1
        )
        db.execute(
            "SELECT status::text FROM pending_invite WHERE inviter_id = %s",
            (good_inviter,),
        )
        assert db.fetchone()[0] == "accepted"
        # The poisoned invite is neither accepted nor did it create a follow
        db.execute(
            "SELECT status::text FROM pending_invite WHERE inviter_id = %s",
            (bad_inviter,),
        )
        assert db.fetchone()[0] == "pending"
        assert (
            count(
                db,
                "SELECT 1 FROM user_follow WHERE follower_id = %s AND following_id = %s",
                (bad_inviter, target),
            )
            == 0
        )

    def test_invites_older_than_expiry_window_are_skipped(self, db):
        """Age cutoff mirrors invite_expiration_days (30 days)."""
        inviter = create_user(db)
        target = create_user(db)
        target_email = _email()
        db.execute(
            "INSERT INTO pending_invite (inviter_id, email, invite_type, created_at) "
            "VALUES (%s, %s, 'follow', now() - interval '31 days')",
            (inviter, target_email),
        )

        db.execute(
            "SELECT process_pending_invites_for_user(%s, %s)",
            (target, target_email),
        )
        assert db.fetchone()[0] == 0
        db.execute(
            "SELECT status::text FROM pending_invite WHERE inviter_id = %s",
            (inviter,),
        )
        assert db.fetchone()[0] == "pending"
        assert (
            count(
                db,
                "SELECT 1 FROM user_follow WHERE follower_id = %s AND following_id = %s",
                (inviter, target),
            )
            == 0
        )


# ---------------------------------------------------------------------------
# Unfollow inbox cleanup
# ---------------------------------------------------------------------------


class TestUnfollowCleanup:
    def test_unfollow_removes_exactly_that_authors_rows(self, db):
        reader = create_user(db)
        author_b = create_user(db)
        author_c = create_user(db)
        follow(db, reader, author_b)
        follow(db, reader, author_c)

        country_b = create_country(db)
        country_c = create_country(db)
        db.execute(
            "INSERT INTO user_countries (user_id, country_id, status) "
            "VALUES (%s, %s, 'visited')",
            (author_b, country_b),
        )
        db.execute(
            "INSERT INTO user_countries (user_id, country_id, status) "
            "VALUES (%s, %s, 'visited')",
            (author_c, country_c),
        )
        assert inbox_count(db, reader, author_b) == 1
        assert inbox_count(db, reader, author_c) == 1

        db.execute(
            "DELETE FROM user_follow WHERE follower_id = %s AND following_id = %s",
            (reader, author_b),
        )

        assert inbox_count(db, reader, author_b) == 0
        assert inbox_count(db, reader, author_c) == 1

        # Re-follow backfills again
        follow(db, reader, author_b)
        assert inbox_count(db, reader, author_b) == 1

    def test_one_time_purge_deletes_orphans_and_keeps_valid_rows(self, db):
        reader = create_user(db)
        followed_author = create_user(db)
        unfollowed_author = create_user(db)
        blocked_author = create_user(db)

        follow(db, reader, followed_author)

        # Give each author one event
        for author in (followed_author, unfollowed_author, blocked_author):
            db.execute(
                "INSERT INTO user_countries (user_id, country_id, status) "
                "VALUES (%s, %s, 'visited')",
                (author, create_country(db)),
            )
        # Valid inbox row arrived via fan-out
        assert inbox_count(db, reader, followed_author) == 1

        # Orphan: no follow between reader and unfollowed_author
        db.execute(
            "INSERT INTO social_feed_inbox (recipient_id, activity_id, actor_id) "
            "SELECT %s, id, actor_id FROM social_activity_event WHERE actor_id = %s",
            (reader, unfollowed_author),
        )
        # Blocked pair (no follow either - 0085 forbids follow+block coexistence)
        db.execute(
            "INSERT INTO user_block (blocker_id, blocked_id) VALUES (%s, %s)",
            (blocked_author, reader),
        )
        db.execute(
            "INSERT INTO social_feed_inbox (recipient_id, activity_id, actor_id) "
            "SELECT %s, id, actor_id FROM social_activity_event WHERE actor_id = %s",
            (reader, blocked_author),
        )

        db.execute(ORPHAN_PURGE_SQL)

        assert inbox_count(db, reader, followed_author) == 1
        assert inbox_count(db, reader, unfollowed_author) == 0
        assert inbox_count(db, reader, blocked_author) == 0


# ---------------------------------------------------------------------------
# block_user_full RPC
# ---------------------------------------------------------------------------


class TestBlockUserFull:
    def _pair_with_history(self, db):
        """Two users who follow each other, have events in each other's
        inboxes, and pending tags both ways plus one approved tag."""
        blocker = create_user(db)
        blocked = create_user(db)
        follow(db, blocker, blocked)
        follow(db, blocked, blocker)
        for user in (blocker, blocked):
            db.execute(
                "INSERT INTO user_countries (user_id, country_id, status) "
                "VALUES (%s, %s, 'visited')",
                (user, create_country(db)),
            )
        country = create_country(db)
        blocker_trip = create_trip(db, blocker, country)
        blocked_trip = create_trip(db, blocked, country)
        db.execute(
            "INSERT INTO trip_tags (trip_id, tagged_user_id, initiated_by, status) "
            "VALUES (%s, %s, %s, 'pending')",
            (blocker_trip, blocked, blocker),
        )
        db.execute(
            "INSERT INTO trip_tags (trip_id, tagged_user_id, initiated_by, status) "
            "VALUES (%s, %s, %s, 'pending')",
            (blocked_trip, blocker, blocked),
        )
        # Approved consent is left alone by blocking
        approved_trip = create_trip(db, blocker, country, name="Approved Trip")
        db.execute(
            "INSERT INTO trip_tags (trip_id, tagged_user_id, initiated_by, status) "
            "VALUES (%s, %s, %s, 'approved')",
            (approved_trip, blocked, blocker),
        )
        return blocker, blocked, approved_trip

    def test_block_severs_both_directions(self, db):
        blocker, blocked, approved_trip = self._pair_with_history(db)
        assert inbox_count(db, blocker, blocked) == 1
        assert inbox_count(db, blocked, blocker) == 1

        set_jwt(db, blocker)
        db.execute("SELECT block_user_full(%s)", (blocked,))
        assert db.fetchone()[0] is True

        # Follows removed both ways
        assert (
            count(
                db,
                "SELECT 1 FROM user_follow WHERE (follower_id = %s AND following_id = %s)"
                " OR (follower_id = %s AND following_id = %s)",
                (blocker, blocked, blocked, blocker),
            )
            == 0
        )
        # Inbox purged both ways
        assert inbox_count(db, blocker, blocked) == 0
        assert inbox_count(db, blocked, blocker) == 0
        # Pending tags between the pair cleared; approved tag untouched
        assert (
            count(
                db,
                "SELECT 1 FROM trip_tags WHERE status = 'pending' "
                "AND tagged_user_id IN (%s, %s)",
                (blocker, blocked),
            )
            == 0
        )
        assert (
            count(
                db,
                "SELECT 1 FROM trip_tags WHERE trip_id = %s AND status = 'approved'",
                (approved_trip,),
            )
            == 1
        )
        # Block row exists
        assert (
            count(
                db,
                "SELECT 1 FROM user_block WHERE blocker_id = %s AND blocked_id = %s",
                (blocker, blocked),
            )
            == 1
        )

        # Idempotent: second call reports the pair was already blocked
        db.execute("SELECT block_user_full(%s)", (blocked,))
        assert db.fetchone()[0] is False

    def test_blocked_side_jwt_cannot_bypass(self, db):
        blocker, blocked, _ = self._pair_with_history(db)
        set_jwt(db, blocker)
        db.execute("SELECT block_user_full(%s)", (blocked,))

        # The blocked side, under its own JWT and RLS, cannot delete the
        # block row (RLS: only the blocker may) ...
        set_jwt(db, blocked)
        db.execute("SET LOCAL ROLE authenticated")
        db.execute(
            "DELETE FROM user_block WHERE blocker_id = %s AND blocked_id = %s",
            (blocker, blocked),
        )
        assert db.rowcount == 0
        # ... and cannot re-follow (enforce_no_follow_when_blocked raises)
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO user_follow (follower_id, following_id) "
                "VALUES (%s, %s)",
                (blocked, blocker),
            )

    def test_unblock_restores_nothing(self, db):
        blocker, blocked, _ = self._pair_with_history(db)
        set_jwt(db, blocker)
        db.execute("SELECT block_user_full(%s)", (blocked,))

        # Unblock = plain delete of the block row (plan Q2)
        db.execute(
            "DELETE FROM user_block WHERE blocker_id = %s AND blocked_id = %s",
            (blocker, blocked),
        )
        assert db.rowcount == 1

        # Nothing comes back
        assert (
            count(
                db,
                "SELECT 1 FROM user_follow WHERE (follower_id = %s AND following_id = %s)"
                " OR (follower_id = %s AND following_id = %s)",
                (blocker, blocked, blocked, blocker),
            )
            == 0
        )
        assert inbox_count(db, blocker, blocked) == 0
        assert inbox_count(db, blocked, blocker) == 0

    def test_requires_authenticated_caller(self, db):
        target = create_user(db)
        with pytest.raises(psycopg.errors.RaiseException):
            db.execute("SELECT block_user_full(%s)", (target,))


# ---------------------------------------------------------------------------
# country_visited on wishlist -> visited transitions
# ---------------------------------------------------------------------------


class TestWishlistToVisitedEvents:
    def _event_count(self, db, uc_id: str) -> int:
        db.execute(
            "SELECT COUNT(*) FROM social_activity_event WHERE user_country_id = %s",
            (uc_id,),
        )
        return db.fetchone()[0]

    def test_update_transition_creates_one_event(self, db):
        traveler = create_user(db)
        follower = create_user(db)
        follow(db, follower, traveler)
        country = create_country(db)
        uc_id = _uuid()
        db.execute(
            "INSERT INTO user_countries (id, user_id, country_id, status) "
            "VALUES (%s, %s, %s, 'wishlist')",
            (uc_id, traveler, country),
        )
        assert self._event_count(db, uc_id) == 0

        db.execute(
            "UPDATE user_countries SET status = 'visited' WHERE id = %s", (uc_id,)
        )
        assert self._event_count(db, uc_id) == 1
        assert inbox_count(db, follower, traveler) == 1

        # A no-op visited -> visited update does not duplicate
        db.execute(
            "UPDATE user_countries SET status = 'visited' WHERE id = %s", (uc_id,)
        )
        assert self._event_count(db, uc_id) == 1

    def test_batch_upsert_transition_creates_one_event(self, db):
        traveler = create_user(db)
        country = create_country(db)
        uc_id = _uuid()
        db.execute(
            "INSERT INTO user_countries (id, user_id, country_id, status) "
            "VALUES (%s, %s, %s, 'wishlist')",
            (uc_id, traveler, country),
        )

        # Batch-upsert path: INSERT ... ON CONFLICT DO UPDATE flips the status
        db.execute(
            "INSERT INTO user_countries (user_id, country_id, status) "
            "VALUES (%s, %s, 'visited') "
            "ON CONFLICT (user_id, country_id) "
            "DO UPDATE SET status = EXCLUDED.status",
            (traveler, country),
        )
        assert self._event_count(db, uc_id) == 1

    def test_revisit_does_not_duplicate(self, db):
        traveler = create_user(db)
        country = create_country(db)
        uc_id = _uuid()
        db.execute(
            "INSERT INTO user_countries (id, user_id, country_id, status) "
            "VALUES (%s, %s, %s, 'visited')",
            (uc_id, traveler, country),
        )
        assert self._event_count(db, uc_id) == 1

        # visited -> wishlist removes the event (0079 remove trigger)
        db.execute(
            "UPDATE user_countries SET status = 'wishlist' WHERE id = %s", (uc_id,)
        )
        assert self._event_count(db, uc_id) == 0

        # wishlist -> visited recreates exactly one
        db.execute(
            "UPDATE user_countries SET status = 'visited' WHERE id = %s", (uc_id,)
        )
        assert self._event_count(db, uc_id) == 1


# ---------------------------------------------------------------------------
# Follow backfill: visibility filters before the 50-row budget
# ---------------------------------------------------------------------------


class TestFollowBackfillBudget:
    def test_deleted_trip_events_do_not_eat_the_budget(self, db):
        """55 older live legacy entry events + 20 newer ones in a soft-deleted
        trip: a new follower gets exactly 50 rows, all of them visible.

        Per-entry emission is retired by 0090, so the legacy entry_added
        events this test exercises are inserted directly - they remain valid
        retained data that the on-follow backfill must still filter correctly.
        The coalescing trigger also emits one trip_updated event per trip
        here; the soft-deleted trip's coalesced event must be filtered too.
        """
        author = create_user(db)
        reader = create_user(db)
        country = create_country(db)
        live_trip = create_trip(db, author, country, name="Live")
        doomed_trip = create_trip(db, author, country, name="Doomed")

        def legacy_entry_event(trip_id: str, created_at_sql: str) -> None:
            entry_id = create_entry(db, trip_id, created_at_sql=created_at_sql)
            db.execute(
                "INSERT INTO social_activity_event "
                "  (actor_id, activity_type, entry_id, created_at) "
                f"VALUES (%s, 'entry_added', %s, {created_at_sql})",
                (author, entry_id),
            )

        # Older, live legacy events
        for i in range(55):
            legacy_entry_event(
                live_trip,
                f"now() - interval '1 hour' + ({i} * interval '1 second')",
            )
        # Newer legacy events that will become invisible
        for i in range(20):
            legacy_entry_event(
                doomed_trip,
                f"now() + ({i} * interval '1 second')",
            )
        db.execute("UPDATE trip SET deleted_at = now() WHERE id = %s", (doomed_trip,))

        follow(db, reader, author)

        # Budget fully spent, nothing invisible: no entry events from the
        # deleted trip, and not the deleted trip's coalesced event either.
        assert inbox_count(db, reader) == 50
        db.execute(
            "SELECT COUNT(*) "
            "FROM social_feed_inbox sfi "
            "JOIN social_activity_event sae ON sae.id = sfi.activity_id "
            "LEFT JOIN entry e ON e.id = sae.entry_id "
            "LEFT JOIN trip et ON et.id = e.trip_id "
            "LEFT JOIN trip tt ON tt.id = sae.trip_id "
            "WHERE sfi.recipient_id = %s "
            "  AND (et.deleted_at IS NOT NULL OR tt.deleted_at IS NOT NULL)",
            (reader,),
        )
        assert db.fetchone()[0] == 0

    def test_backfill_social_feed_is_idempotent_and_filters(self, db):
        """backfill_social_feed() creates no events for deleted entries or
        non-visited countries, and re-running it adds nothing."""
        author = create_user(db)
        reader = create_user(db)
        follow(db, reader, author)
        country = create_country(db)
        trip = create_trip(db, author, country)
        live_entry = create_entry(db, trip)
        deleted_entry = create_entry(db, trip)
        db.execute(
            "UPDATE entry SET deleted_at = now() WHERE id = %s", (deleted_entry,)
        )
        wishlist_country = create_country(db)
        db.execute(
            "INSERT INTO user_countries (user_id, country_id, status) "
            "VALUES (%s, %s, 'wishlist')",
            (author, wishlist_country),
        )

        db.execute("SELECT backfill_social_feed()")
        first = inbox_count(db, reader, author)
        db.execute("SELECT backfill_social_feed()")
        second = inbox_count(db, reader, author)

        assert first == second  # idempotent
        # Per-entry emission is retired (0090): neither entry has an
        # entry_added event, and backfill must not create any.
        assert (
            count(
                db,
                "SELECT 1 FROM social_activity_event WHERE entry_id = %s",
                (live_entry,),
            )
            == 0
        )
        assert (
            count(
                db,
                "SELECT 1 FROM social_activity_event WHERE entry_id = %s",
                (deleted_entry,),
            )
            == 0
        )
        # The entries coalesced into exactly one trip_updated event instead.
        assert (
            count(
                db,
                "SELECT 1 FROM social_activity_event "
                "WHERE trip_id = %s AND activity_type = 'trip_updated'",
                (trip,),
            )
            == 1
        )
        # No event for the wishlist-only country
        assert (
            count(
                db,
                "SELECT 1 FROM social_activity_event sae "
                "JOIN user_countries uc ON uc.id = sae.user_country_id "
                "WHERE uc.country_id = %s",
                (wishlist_country,),
            )
            == 0
        )
