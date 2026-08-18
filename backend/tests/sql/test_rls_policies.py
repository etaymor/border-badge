"""RLS-policy tests via JWT-role simulation (plan U11).

Each test switches to the `authenticated` role with `SET LOCAL ROLE` and
simulates a PostgREST caller by setting `request.jwt.claims`, then asserts
what the row-level security policies actually let that caller see or touch.

Policy surfaces covered, with the migration holding each FINAL definition:
    - trip SELECT: "Trip visibility with followers and blocks"
      (0064_trip_visibility_followers.sql; block helper
      is_blocked_bidirectional last defined in
      0081_security_definer_search_path.sql)
    - entry SELECT: "Entry visibility matches trip"
      (0064_trip_visibility_followers.sql - piggybacks the trip policy)
    - social_feed_inbox SELECT: "Users can view own inbox"
      (0080_social_feed_rls_policies.sql; no INSERT policy exists)
    - user_block SELECT/INSERT/DELETE: blocker-only
      (0059_social_tables.sql)
    - push_token SELECT/INSERT/UPDATE/DELETE: owner-only
      (0084_push_tokens_table.sql; 0091_push_token_rekey.sql re-keys the
      table to one row per (user, device) token but leaves the policies)

These run against a REAL Postgres with the full migration set applied
(e.g. a Supabase local stack). They are skipped unless SUPABASE_DB_URL is
set, and every test runs inside a transaction that is rolled back.

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
    return f"rlstest-{uuid.uuid4().hex[:12]}@example.com"


def create_user(cur, email: str | None = None) -> str:
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


def create_entry(cur, trip_id: str) -> str:
    entry_id = _uuid()
    cur.execute(
        "INSERT INTO entry (id, trip_id, type, title) VALUES (%s, %s, 'place', %s)",
        (entry_id, trip_id, "Test Entry"),
    )
    return entry_id


def follow(cur, follower_id: str, following_id: str) -> None:
    cur.execute(
        "INSERT INTO user_follow (follower_id, following_id) VALUES (%s, %s)",
        (follower_id, following_id),
    )


def block(cur, blocker_id: str, blocked_id: str) -> None:
    cur.execute(
        "INSERT INTO user_block (blocker_id, blocked_id) VALUES (%s, %s)",
        (blocker_id, blocked_id),
    )


def tag(cur, trip_id: str, tagged_user_id: str, initiated_by: str, status: str) -> None:
    cur.execute(
        "INSERT INTO trip_tags (trip_id, tagged_user_id, initiated_by, status) "
        "VALUES (%s, %s, %s, %s)",
        (trip_id, tagged_user_id, initiated_by, status),
    )


def as_user(cur, user_id: str) -> None:
    """Become an RLS-constrained PostgREST caller for user_id."""
    claims = json.dumps({"sub": user_id, "role": "authenticated"})
    cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims,))
    cur.execute("SET LOCAL ROLE authenticated")


def as_admin(cur) -> None:
    """Back to the (RLS-bypassing, table-owning) connection role for setup."""
    cur.execute("RESET ROLE")


def visible_trips(cur, viewer_id: str, owner_id: str) -> int:
    as_user(cur, viewer_id)
    cur.execute("SELECT COUNT(*) FROM trip WHERE user_id = %s", (owner_id,))
    n = cur.fetchone()[0]
    as_admin(cur)
    return n


def visible_entries(cur, viewer_id: str, trip_id: str) -> int:
    as_user(cur, viewer_id)
    cur.execute("SELECT COUNT(*) FROM entry WHERE trip_id = %s", (trip_id,))
    n = cur.fetchone()[0]
    as_admin(cur)
    return n


# ---------------------------------------------------------------------------
# trip SELECT: "Trip visibility with followers and blocks" (0064)
# ---------------------------------------------------------------------------


class TestTripSelectPolicy:
    def test_owner_sees_own_trip_but_stranger_does_not(self, db):
        owner = create_user(db)
        stranger = create_user(db)
        create_trip(db, owner, create_country(db))

        assert visible_trips(db, owner, owner) == 1
        assert visible_trips(db, stranger, owner) == 0

    def test_soft_deleted_trip_is_invisible_to_everyone_including_owner(self, db):
        """0064 gates the whole policy on deleted_at IS NULL, so under RLS
        even the owner cannot SELECT a soft-deleted trip (owner flows that
        need deleted rows go through the service role, which bypasses RLS)."""
        owner = create_user(db)
        follower = create_user(db)
        follow(db, follower, owner)
        trip_id = create_trip(db, owner, create_country(db))
        db.execute("UPDATE trip SET deleted_at = now() WHERE id = %s", (trip_id,))

        assert visible_trips(db, owner, owner) == 0
        assert visible_trips(db, follower, owner) == 0

    def test_approved_tag_grants_visibility_pending_does_not(self, db):
        owner = create_user(db)
        approved_user = create_user(db)
        pending_user = create_user(db)
        trip_id = create_trip(db, owner, create_country(db))
        tag(db, trip_id, approved_user, owner, "approved")
        tag(db, trip_id, pending_user, owner, "pending")

        assert visible_trips(db, approved_user, owner) == 1
        assert visible_trips(db, pending_user, owner) == 0

    def test_block_overrides_approved_tag_in_both_directions(self, db):
        owner = create_user(db)
        trip_id = create_trip(db, owner, create_country(db))

        tagged_then_blocked = create_user(db)
        tag(db, trip_id, tagged_then_blocked, owner, "approved")
        block(db, owner, tagged_then_blocked)  # owner blocked the viewer

        tagged_who_blocked = create_user(db)
        tag(db, trip_id, tagged_who_blocked, owner, "approved")
        block(db, tagged_who_blocked, owner)  # viewer blocked the owner

        assert visible_trips(db, tagged_then_blocked, owner) == 0
        assert visible_trips(db, tagged_who_blocked, owner) == 0

    def test_follower_sees_trip_unless_blocked(self, db):
        owner = create_user(db)
        follower = create_user(db)
        blocked_follower = create_user(db)
        follow(db, follower, owner)
        follow(db, blocked_follower, owner)
        create_trip(db, owner, create_country(db))

        assert visible_trips(db, follower, owner) == 1

        # A block in either direction defeats the follow edge, even if the
        # (normally block_user_full-severed) follow row still exists.
        block(db, owner, blocked_follower)
        assert visible_trips(db, blocked_follower, owner) == 0

    def test_following_is_directional(self, db):
        """The owner following the viewer grants the viewer nothing."""
        owner = create_user(db)
        viewer = create_user(db)
        follow(db, owner, viewer)
        create_trip(db, owner, create_country(db))

        assert visible_trips(db, viewer, owner) == 0


# ---------------------------------------------------------------------------
# entry SELECT: "Entry visibility matches trip" (0064)
# ---------------------------------------------------------------------------


class TestEntryVisibilityMatchesTrip:
    def test_entries_visible_exactly_when_the_trip_is(self, db):
        owner = create_user(db)
        follower = create_user(db)
        stranger = create_user(db)
        follow(db, follower, owner)
        trip_id = create_trip(db, owner, create_country(db))
        create_entry(db, trip_id)

        assert visible_entries(db, owner, trip_id) == 1
        assert visible_entries(db, follower, trip_id) == 1
        assert visible_entries(db, stranger, trip_id) == 0

    def test_soft_deleting_the_trip_hides_its_entries(self, db):
        owner = create_user(db)
        follower = create_user(db)
        follow(db, follower, owner)
        trip_id = create_trip(db, owner, create_country(db))
        create_entry(db, trip_id)
        db.execute("UPDATE trip SET deleted_at = now() WHERE id = %s", (trip_id,))

        assert visible_entries(db, follower, trip_id) == 0


# ---------------------------------------------------------------------------
# social_feed_inbox: "Users can view own inbox" (0080)
# ---------------------------------------------------------------------------


class TestSocialFeedInboxRls:
    def _seed_inbox_row(self, db) -> tuple[str, str]:
        """Reader follows author; a country visit fans out one inbox row."""
        author = create_user(db)
        reader = create_user(db)
        follow(db, reader, author)
        db.execute(
            "INSERT INTO user_countries (user_id, country_id, status) "
            "VALUES (%s, %s, 'visited')",
            (author, create_country(db)),
        )
        return reader, author

    def test_recipient_only_reads(self, db):
        reader, author = self._seed_inbox_row(db)
        other = create_user(db)

        as_user(db, reader)
        db.execute(
            "SELECT COUNT(*) FROM social_feed_inbox WHERE recipient_id = %s",
            (reader,),
        )
        assert db.fetchone()[0] == 1
        as_admin(db)

        # Neither the actor nor a bystander can read the recipient's inbox,
        # even naming the recipient explicitly.
        for viewer in (author, other):
            as_user(db, viewer)
            db.execute(
                "SELECT COUNT(*) FROM social_feed_inbox WHERE recipient_id = %s",
                (reader,),
            )
            assert db.fetchone()[0] == 0
            as_admin(db)

    def test_authenticated_users_cannot_insert_inbox_rows(self, db):
        """0080 defines only a SELECT policy; fan-out writes are trigger /
        service-role territory, so a direct authenticated INSERT is refused."""
        reader, author = self._seed_inbox_row(db)
        db.execute(
            "SELECT id, activity_id FROM social_feed_inbox WHERE recipient_id = %s",
            (reader,),
        )
        _row_id, activity_id = db.fetchone()

        as_user(db, author)
        with pytest.raises(psycopg.Error):
            db.execute(
                "INSERT INTO social_feed_inbox (recipient_id, activity_id, actor_id) "
                "VALUES (%s, %s, %s)",
                (reader, activity_id, author),
            )


# ---------------------------------------------------------------------------
# user_block: blocker-only visibility (0059)
# ---------------------------------------------------------------------------


class TestUserBlockRls:
    def test_only_the_blocker_sees_the_block_row(self, db):
        blocker = create_user(db)
        blocked = create_user(db)
        block(db, blocker, blocked)

        as_user(db, blocker)
        db.execute("SELECT COUNT(*) FROM user_block")
        assert db.fetchone()[0] == 1
        as_admin(db)

        # The blocked user cannot see the row at all - blocks are invisible
        # to their target.
        as_user(db, blocked)
        db.execute("SELECT COUNT(*) FROM user_block")
        assert db.fetchone()[0] == 0
        as_admin(db)

    def test_only_the_blocker_can_delete_the_block_row(self, db):
        blocker = create_user(db)
        blocked = create_user(db)
        block(db, blocker, blocked)

        as_user(db, blocked)
        db.execute(
            "DELETE FROM user_block WHERE blocker_id = %s AND blocked_id = %s",
            (blocker, blocked),
        )
        assert db.rowcount == 0
        as_admin(db)

        as_user(db, blocker)
        db.execute(
            "DELETE FROM user_block WHERE blocker_id = %s AND blocked_id = %s",
            (blocker, blocked),
        )
        assert db.rowcount == 1

    def test_cannot_insert_a_block_on_someone_elses_behalf(self, db):
        actor = create_user(db)
        victim = create_user(db)
        someone = create_user(db)

        as_user(db, actor)
        with pytest.raises(psycopg.Error):
            block(db, victim, someone)  # blocker_id != auth.uid()


# ---------------------------------------------------------------------------
# push_token: owner-only rows (0084 policies; 0091 multi-device re-key)
# ---------------------------------------------------------------------------


class TestPushTokenRls:
    def _insert_token(self, db, user_id: str, token: str) -> None:
        db.execute(
            "INSERT INTO push_token (user_id, token, platform) "
            "VALUES (%s, %s, 'ios')",
            (user_id, token),
        )

    def test_owner_can_hold_multiple_devices_and_reads_only_own_rows(self, db):
        owner = create_user(db)
        other = create_user(db)

        as_user(db, owner)
        # 0091 re-keyed the table: multiple rows per user (one per device).
        self._insert_token(db, owner, f"ExponentPushToken[{uuid.uuid4().hex}]")
        self._insert_token(db, owner, f"ExponentPushToken[{uuid.uuid4().hex}]")
        db.execute("SELECT COUNT(*) FROM push_token")
        assert db.fetchone()[0] == 2
        as_admin(db)

        as_user(db, other)
        db.execute("SELECT COUNT(*) FROM push_token")
        assert db.fetchone()[0] == 0

    def test_cannot_update_or_delete_another_users_token(self, db):
        owner = create_user(db)
        attacker = create_user(db)
        token = f"ExponentPushToken[{uuid.uuid4().hex}]"
        self._insert_token(db, owner, token)

        as_user(db, attacker)
        db.execute(
            "UPDATE push_token SET token = 'stolen' WHERE user_id = %s", (owner,)
        )
        assert db.rowcount == 0
        db.execute("DELETE FROM push_token WHERE user_id = %s", (owner,))
        assert db.rowcount == 0
        as_admin(db)

        db.execute("SELECT token FROM push_token WHERE user_id = %s", (owner,))
        assert db.fetchone()[0] == token

    def test_cannot_insert_a_token_for_another_user(self, db):
        attacker = create_user(db)
        victim = create_user(db)

        as_user(db, attacker)
        with pytest.raises(psycopg.Error):
            self._insert_token(db, victim, f"ExponentPushToken[{uuid.uuid4().hex}]")
