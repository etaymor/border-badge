-- Migration: Fan-out coalescing + inbox/event pruning (plan U5, KTD3, R12)
--
-- 1. Retire per-entry 'entry_added' emission (0079's trg_entry_create_event
--    and 0082's trg_entry_restore_event) and replace it with ONE coalesced
--    'trip_updated' event per trip per UTC day, emitted from statement-level
--    triggers with transition tables. Creating 100 entries on one trip with
--    10 followers now produces 1 event and <= 10 inbox writes per statement,
--    not 1000.
--    * The day is stored in a new event_day DATE column with a partial
--      unique index -- date_trunc()/timezone-cast expressions are not
--      IMMUTABLE, so an expression index would fail; storing the day at
--      insert time sidesteps that.
--    * Each touch of the daily event refreshes the matching inbox rows'
--      created_at (feed ordering reads INBOX timestamps, not event
--      timestamps) and fans out to followers gained mid-window (the insert
--      arm of the same ON CONFLICT statement).
--    * Existing 'entry_added' rows are kept: the mobile renderer tolerates
--      both types (plan U9), and old rows age out via pruning below.
-- 2. Pruning with pg_cron in batched loops:
--    * social_feed_inbox capped at the newest 500 rows per recipient AND a
--      90-day max age.
--    * social_activity_event rows with ZERO inbox references AND older than
--      the max age are deleted (the age guard keeps a follower-less user's
--      recent profile feed intact -- get_user_activity_feed reads events
--      directly).
--    * Batched DELETE ... WHERE id IN (SELECT ... LIMIT n) loops on a
--      frequent schedule; a single unbatched sweep is the failure path
--      (long locks, WAL bloat).
--    * Scheduling is guarded: if pg_cron is absent (local/CI stacks), a
--      NOTICE is raised and nothing is scheduled. OPERATIONAL NOTE: confirm
--      the pg_cron extension is enabled on the Supabase project, then
--      re-run the DO block at the bottom (or schedule
--      "SELECT public.prune_social_feed()" manually, e.g. every 10 min).
--    Boundary vs 0087 (U2): unfollow/block cleanup owns TARGETED deletion;
--    pruning owns age/volume decay only.
-- 3. check_username_candidates RPC: base + suggestion candidates checked in
--    a single query (replaces up to 6 serial queries in /users/check-username).
-- 4. fanout_existing_events_on_follow and backfill_social_feed updated to
--    start from their final definitions (0087) and understand the new world:
--    the on-follow backfill filters soft-deleted trips' trip_updated events
--    before spending its 50-row budget, and backfill_social_feed no longer
--    (re)creates per-entry events.

--------------------------------------------------------------------------------
-- 1a. SCHEMA: stored event_day + partial unique index for daily coalescing
--------------------------------------------------------------------------------

ALTER TABLE social_activity_event
  ADD COLUMN IF NOT EXISTS event_day DATE;

-- Defensive backfill: no production 'trip_updated' rows exist before this
-- migration (0088 only widened the CHECK; emission starts here), but any
-- manually inserted rows get a day so the constraint below can be added.
UPDATE social_activity_event
SET event_day = (created_at AT TIME ZONE 'utc')::date
WHERE activity_type = 'trip_updated' AND event_day IS NULL;

-- Every trip_updated event must carry its day (the coalescing key).
ALTER TABLE social_activity_event
  DROP CONSTRAINT IF EXISTS social_activity_event_trip_updated_day_check;
ALTER TABLE social_activity_event
  ADD CONSTRAINT social_activity_event_trip_updated_day_check
  CHECK (activity_type <> 'trip_updated' OR event_day IS NOT NULL);

-- One coalesced event per trip per day. Partial: other activity types keep
-- event_day NULL and never collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_activity_event_trip_day_unique
  ON social_activity_event(trip_id, event_day)
  WHERE activity_type = 'trip_updated';

--------------------------------------------------------------------------------
-- 1b. RETIRE per-entry event emission
--------------------------------------------------------------------------------
-- Final definitions being retired: create_entry_added_event (0079) and
-- create_entry_event_on_restore (0082). trg_entry_soft_delete_event (0079)
-- stays: it only deletes legacy entry_added events on soft delete (no
-- fan-out), which remains correct for the retained historical rows.

DROP TRIGGER IF EXISTS trg_entry_create_event ON entry;
DROP FUNCTION IF EXISTS create_entry_added_event();

DROP TRIGGER IF EXISTS trg_entry_restore_event ON entry;
DROP FUNCTION IF EXISTS create_entry_event_on_restore();

--------------------------------------------------------------------------------
-- 1c. COALESCING UPSERT
--------------------------------------------------------------------------------
-- Shared helper: upsert the (trip, day) event and touch follower inboxes.
-- Called once per distinct trip per statement, NOT per entry row.

CREATE OR REPLACE FUNCTION upsert_trip_updated_event(
  p_trip_id UUID,
  p_entry_delta INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_activity_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT user_id INTO v_actor_id
  FROM trip
  WHERE id = p_trip_id AND deleted_at IS NULL;

  IF v_actor_id IS NULL THEN
    RETURN;
  END IF;

  -- One event per trip per UTC day. Re-touches within the window bump
  -- created_at (so the coalesced card surfaces as fresh) and accumulate the
  -- entry count in the payload.
  INSERT INTO social_activity_event
    (actor_id, activity_type, trip_id, event_day, created_at, payload)
  VALUES (
    v_actor_id,
    'trip_updated',
    p_trip_id,
    (v_now AT TIME ZONE 'utc')::date,
    v_now,
    jsonb_build_object('entry_count', p_entry_delta)
  )
  ON CONFLICT (trip_id, event_day) WHERE activity_type = 'trip_updated'
  DO UPDATE SET
    created_at = EXCLUDED.created_at,
    payload = jsonb_build_object(
      'entry_count',
      COALESCE((social_activity_event.payload->>'entry_count')::int, 0)
        + COALESCE((EXCLUDED.payload->>'entry_count')::int, 0)
    )
  RETURNING id INTO v_activity_id;

  -- Fan out AND refresh in one statement:
  --   * insert arm: followers gained mid-window get the coalesced event;
  --   * update arm: existing inbox rows get created_at refreshed -- feed
  --     ordering reads inbox timestamps, so without this the coalesced card
  --     would stay buried at its first-touch position.
  INSERT INTO social_feed_inbox (recipient_id, activity_id, actor_id, created_at)
  SELECT uf.follower_id, v_activity_id, v_actor_id, v_now
  FROM user_follow uf
  WHERE uf.following_id = v_actor_id
  ON CONFLICT (recipient_id, activity_id)
  DO UPDATE SET created_at = EXCLUDED.created_at;
END;
$$;

-- Trigger-internal helper only: without these revokes any authenticated user
-- could call it through PostgREST and forge trip activity for arbitrary trips.
REVOKE ALL ON FUNCTION upsert_trip_updated_event(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_trip_updated_event(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION upsert_trip_updated_event(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION upsert_trip_updated_event(UUID, INTEGER) TO service_role;

-- Statement-level trigger: entry INSERTs (bulk-safe via transition table).
CREATE OR REPLACE FUNCTION emit_trip_updated_on_entry_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT ne.trip_id, COUNT(*) AS entry_count
    FROM new_entries ne
    WHERE ne.deleted_at IS NULL
    GROUP BY ne.trip_id
  LOOP
    PERFORM upsert_trip_updated_event(r.trip_id, r.entry_count::int);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_entry_insert_trip_updated ON entry;
CREATE TRIGGER trg_entry_insert_trip_updated
AFTER INSERT ON entry
REFERENCING NEW TABLE AS new_entries
FOR EACH STATEMENT
EXECUTE FUNCTION emit_trip_updated_on_entry_insert();

-- Statement-level trigger: entry restores (deleted_at cleared) re-touch the
-- trip's daily event, replacing 0082's per-row recreate-and-fanout.
CREATE OR REPLACE FUNCTION emit_trip_updated_on_entry_restore()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT ne.trip_id, COUNT(*) AS entry_count
    FROM new_entries ne
    JOIN old_entries oe ON oe.id = ne.id
    WHERE oe.deleted_at IS NOT NULL
      AND ne.deleted_at IS NULL
    GROUP BY ne.trip_id
  LOOP
    PERFORM upsert_trip_updated_event(r.trip_id, r.entry_count::int);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_entry_restore_trip_updated ON entry;
CREATE TRIGGER trg_entry_restore_trip_updated
AFTER UPDATE ON entry
REFERENCING OLD TABLE AS old_entries NEW TABLE AS new_entries
FOR EACH STATEMENT
EXECUTE FUNCTION emit_trip_updated_on_entry_restore();

--------------------------------------------------------------------------------
-- 1d. ON-FOLLOW BACKFILL: filter soft-deleted trips' trip_updated events
--------------------------------------------------------------------------------
-- Starts from the FINAL definition in 0087 (filter-before-budget). Adds the
-- trip_updated visibility arm so a soft-deleted trip's coalesced events
-- cannot eat the 50-row budget.

CREATE OR REPLACE FUNCTION fanout_existing_events_on_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NOTE: backfill is limited to the 50 most recent VISIBLE events to avoid
  -- slow inserts when following users with extensive history.
  INSERT INTO social_feed_inbox(recipient_id, activity_id, actor_id, created_at)
  SELECT NEW.follower_id, sae.id, sae.actor_id, sae.created_at
  FROM social_activity_event sae
  LEFT JOIN entry e ON e.id = sae.entry_id
  LEFT JOIN trip t ON t.id = e.trip_id
  LEFT JOIN trip tu ON tu.id = sae.trip_id
  LEFT JOIN user_countries uc ON uc.id = sae.user_country_id
  WHERE sae.actor_id = NEW.following_id
    AND (sae.entry_id IS NULL OR (e.deleted_at IS NULL AND t.deleted_at IS NULL))
    AND (sae.trip_id IS NULL OR tu.deleted_at IS NULL)
    AND (sae.user_country_id IS NULL OR uc.status = 'visited')
  ORDER BY sae.created_at DESC
  LIMIT 50
  ON CONFLICT (recipient_id, activity_id) DO NOTHING;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 1e. BACKFILL FUNCTION: stop (re)creating per-entry events
--------------------------------------------------------------------------------
-- Starts from the final definition in 0079 (invoked again by 0087). The
-- entry_added arm is removed: per-entry emission is retired and re-running
-- the repair function must not resurrect feed spam. Existing entry_added
-- events still get inbox rows via the fan-out arm (renderers tolerate them).

CREATE OR REPLACE FUNCTION backfill_social_feed()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO social_activity_event(actor_id, activity_type, user_country_id, created_at)
  SELECT uc.user_id, 'country_visited', uc.id, uc.created_at
  FROM user_countries uc
  WHERE uc.status = 'visited'
  ON CONFLICT DO NOTHING;

  INSERT INTO social_feed_inbox(recipient_id, activity_id, actor_id, created_at)
  SELECT uf.follower_id, sae.id, sae.actor_id, sae.created_at
  FROM user_follow uf
  JOIN social_activity_event sae ON sae.actor_id = uf.following_id
  ON CONFLICT (recipient_id, activity_id) DO NOTHING;
END;
$$;

--------------------------------------------------------------------------------
-- 2a. PRUNING INDEXES
--------------------------------------------------------------------------------

-- Global age scans (the per-recipient composite index cannot serve them).
CREATE INDEX IF NOT EXISTS idx_social_feed_inbox_created
  ON social_feed_inbox(created_at);

CREATE INDEX IF NOT EXISTS idx_social_activity_event_created
  ON social_activity_event(created_at);

-- Zero-reference anti-join for event pruning; the existing unique index
-- (recipient_id, activity_id) does not lead on activity_id.
CREATE INDEX IF NOT EXISTS idx_social_feed_inbox_activity
  ON social_feed_inbox(activity_id);

--------------------------------------------------------------------------------
-- 2b. PRUNE FUNCTION (batched loops)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prune_social_feed(
  p_keep_per_recipient INTEGER DEFAULT 500,
  p_max_age INTERVAL DEFAULT INTERVAL '90 days',
  p_batch_size INTEGER DEFAULT 5000,
  p_max_batches INTEGER DEFAULT 20
) RETURNS TABLE (inbox_deleted BIGINT, events_deleted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
  v_batches INTEGER;
  v_inbox_deleted BIGINT := 0;
  v_events_deleted BIGINT := 0;
BEGIN
  -- Pass 1: inbox max age. Batched: each DELETE touches at most
  -- p_batch_size rows, keeping locks short and WAL bounded; the frequent
  -- cron schedule absorbs any leftover backlog on the next run.
  v_batches := 0;
  LOOP
    DELETE FROM social_feed_inbox
    WHERE id IN (
      SELECT id FROM social_feed_inbox
      WHERE created_at < now() - p_max_age
      LIMIT p_batch_size
    );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_inbox_deleted := v_inbox_deleted + v_deleted;
    v_batches := v_batches + 1;
    EXIT WHEN v_deleted < p_batch_size OR v_batches >= p_max_batches;
  END LOOP;

  -- Pass 2: per-recipient cap (newest p_keep_per_recipient survive; the
  -- ordering tuple matches the feed's (created_at, activity_id) keyset).
  v_batches := 0;
  LOOP
    DELETE FROM social_feed_inbox
    WHERE id IN (
      SELECT ranked.id
      FROM (
        SELECT sfi.id,
               row_number() OVER (
                 PARTITION BY sfi.recipient_id
                 ORDER BY sfi.created_at DESC, sfi.activity_id DESC
               ) AS rn
        FROM social_feed_inbox sfi
      ) ranked
      WHERE ranked.rn > p_keep_per_recipient
      LIMIT p_batch_size
    );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_inbox_deleted := v_inbox_deleted + v_deleted;
    v_batches := v_batches + 1;
    EXIT WHEN v_deleted < p_batch_size OR v_batches >= p_max_batches;
  END LOOP;

  -- Pass 3: events with zero inbox references, age-guarded. The age guard
  -- matters: get_user_activity_feed (profile feed) reads events directly,
  -- so a follower-less user's fresh events must survive pruning; only
  -- events past the retention window decay. Legacy entry_added rows age
  -- out here once their inbox references are gone.
  v_batches := 0;
  LOOP
    DELETE FROM social_activity_event
    WHERE id IN (
      SELECT sae.id
      FROM social_activity_event sae
      WHERE sae.created_at < now() - p_max_age
        AND NOT EXISTS (
          SELECT 1 FROM social_feed_inbox sfi WHERE sfi.activity_id = sae.id
        )
      LIMIT p_batch_size
    );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_events_deleted := v_events_deleted + v_deleted;
    v_batches := v_batches + 1;
    EXIT WHEN v_deleted < p_batch_size OR v_batches >= p_max_batches;
  END LOOP;

  RETURN QUERY SELECT v_inbox_deleted, v_events_deleted;
END;
$$;

REVOKE ALL ON FUNCTION prune_social_feed(INTEGER, INTERVAL, INTEGER, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION prune_social_feed(INTEGER, INTERVAL, INTEGER, INTEGER)
  FROM anon;
REVOKE ALL ON FUNCTION prune_social_feed(INTEGER, INTERVAL, INTEGER, INTEGER)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION prune_social_feed(INTEGER, INTERVAL, INTEGER, INTEGER)
  TO service_role;

--------------------------------------------------------------------------------
-- 2c. SCHEDULE (guarded: pg_cron may be absent on local/CI stacks)
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- cron.schedule upserts by job name, so re-running this migration (or
    -- re-executing this block after enabling pg_cron) is idempotent.
    PERFORM cron.schedule(
      'social-feed-prune',
      '*/10 * * * *',
      'SELECT public.prune_social_feed()'
    );
    RAISE NOTICE 'pg_cron: scheduled social-feed-prune every 10 minutes';
  ELSE
    RAISE NOTICE
      'pg_cron extension not installed: social feed pruning is NOT scheduled. '
      'Enable pg_cron on the Supabase project (Database > Extensions), then '
      'run: SELECT cron.schedule(''social-feed-prune'', ''*/10 * * * *'', '
      '''SELECT public.prune_social_feed()'');';
  END IF;
END
$$;

--------------------------------------------------------------------------------
-- 3. check_username_candidates RPC: base + suggestions in ONE query
--------------------------------------------------------------------------------
-- Returns the subset of p_candidates that is TAKEN (case-insensitive),
-- lowercased. The backend derives availability and free suggestions from
-- the complement. Replaces up to six serial ilike queries per
-- /users/check-username request.

CREATE OR REPLACE FUNCTION check_username_candidates(p_candidates TEXT[])
RETURNS TABLE (taken_username TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LOWER(up.username)
  FROM user_profile up
  WHERE LOWER(up.username) IN (
    SELECT LOWER(c) FROM unnest(p_candidates) AS c
  );
$$;

-- The endpoint is unauthenticated but always calls through the backend's
-- service-role client; no anon/authenticated access needed.
REVOKE ALL ON FUNCTION check_username_candidates(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_username_candidates(TEXT[]) FROM anon;
REVOKE ALL ON FUNCTION check_username_candidates(TEXT[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION check_username_candidates(TEXT[]) TO service_role;
