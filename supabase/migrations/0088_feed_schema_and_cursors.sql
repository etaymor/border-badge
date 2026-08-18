-- Migration: Feed schema hardening + compound keyset cursors (KTD13)
--
-- Owns ALL feed DDL churn in one migration:
--   1. Convert social_activity_type from a Postgres enum to TEXT + CHECK
--      (sidesteps ALTER TYPE ... ADD VALUE transaction restrictions and
--      future enum churn; existing values survive, unknown strings fail).
--   2. Add trip_id (FK to trip, cascade) and payload JSONB to
--      social_activity_event; widen the type-vs-source CHECK to admit a trip
--      arm for the future 'trip_updated' type (emitted by a later migration).
--   3. Rewrite both feed RPCs exactly once: add p_before_id with tuple
--      comparison (created_at, id) < (p_before, p_before_id) and return the
--      event id as activity_id, so pagination is lossless at timestamp ties
--      and every feed item has a stable id.
--
-- The RPCs' prior (final) definitions live in 0079_social_feed_inbox.sql.
-- Trigger functions (0079, 0082) insert activity_type as string literals and
-- compare with string literals, so they work unchanged against TEXT.

--------------------------------------------------------------------------------
-- 1. ENUM -> TEXT + CHECK
--------------------------------------------------------------------------------

-- The source CHECK references activity_type; drop it before retyping the
-- column, then re-add the widened version below.
ALTER TABLE social_activity_event
  DROP CONSTRAINT IF EXISTS social_activity_event_source_check;

ALTER TABLE social_activity_event
  ALTER COLUMN activity_type TYPE TEXT USING activity_type::TEXT;

-- Nothing depends on the enum type once the column is TEXT.
DROP TYPE IF EXISTS social_activity_type;

--------------------------------------------------------------------------------
-- 2. NEW COLUMNS + WIDENED CHECKS
--------------------------------------------------------------------------------

ALTER TABLE social_activity_event
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trip(id) ON DELETE CASCADE;

ALTER TABLE social_activity_event
  ADD COLUMN IF NOT EXISTS payload JSONB;

-- Known activity types. Unknown strings must fail this CHECK; adding a type
-- later is a constraint swap inside a normal transaction.
ALTER TABLE social_activity_event
  ADD CONSTRAINT social_activity_event_type_check
  CHECK (activity_type IN ('country_visited', 'entry_added', 'trip_updated'));

-- Type-vs-source consistency, widened with the trip arm ('trip_updated' is
-- sourced from trips; emission arrives with the fan-out coalescing migration).
ALTER TABLE social_activity_event
  ADD CONSTRAINT social_activity_event_source_check
  CHECK (
    (activity_type = 'country_visited'
      AND user_country_id IS NOT NULL AND entry_id IS NULL AND trip_id IS NULL)
    OR
    (activity_type = 'entry_added'
      AND entry_id IS NOT NULL AND user_country_id IS NULL AND trip_id IS NULL)
    OR
    (activity_type = 'trip_updated'
      AND trip_id IS NOT NULL AND user_country_id IS NULL AND entry_id IS NULL)
  );

--------------------------------------------------------------------------------
-- 3. INDEXES FOR COMPOUND KEYSET PAGINATION
--------------------------------------------------------------------------------

-- Feed queries now order by (created_at DESC, id DESC); extend the covering
-- indexes with the tiebreaker column.
DROP INDEX IF EXISTS idx_social_feed_inbox_recipient_created;
CREATE INDEX IF NOT EXISTS idx_social_feed_inbox_recipient_created_id
  ON social_feed_inbox(recipient_id, created_at DESC, activity_id DESC);

DROP INDEX IF EXISTS idx_social_activity_event_actor_created;
CREATE INDEX IF NOT EXISTS idx_social_activity_event_actor_created_id
  ON social_activity_event(actor_id, created_at DESC, id DESC);

-- Supports FK cascade lookups and future trip-event coalescing.
CREATE INDEX IF NOT EXISTS idx_social_activity_event_trip
  ON social_activity_event(trip_id)
  WHERE trip_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 4. FEED RPCS: p_before_id TUPLE PAGINATION + STABLE activity_id
--------------------------------------------------------------------------------

-- Signatures change (new parameter + new output columns), so drop the old
-- versions to avoid leaving ambiguous overloads behind.
DROP FUNCTION IF EXISTS get_activity_feed(UUID, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS get_user_activity_feed(UUID, UUID, TIMESTAMPTZ, INT);

-- Home feed: reads the precomputed inbox. Pagination tuple is
-- (sfi.created_at, sfi.activity_id) -- unique per recipient via
-- idx_social_feed_inbox_recipient_activity -- and activity_id is the stable
-- social_activity_event id.
CREATE OR REPLACE FUNCTION get_activity_feed(
  p_user_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_before_id UUID DEFAULT NULL
)
RETURNS TABLE (
  activity_id UUID,
  activity_type TEXT,
  created_at TIMESTAMPTZ,
  user_id UUID,
  username TEXT,
  avatar_url TEXT,
  country_id UUID,
  country_name TEXT,
  country_code TEXT,
  entry_id UUID,
  entry_name TEXT,
  entry_type TEXT,
  location_name TEXT,
  entry_image_url TEXT,
  trip_id UUID,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH blocked_user_ids AS (
    SELECT blocked_id AS uid FROM user_block WHERE blocker_id = p_user_id
    UNION
    SELECT blocker_id AS uid FROM user_block WHERE blocked_id = p_user_id
  )
  SELECT
    sae.id AS activity_id,
    sae.activity_type,
    sfi.created_at,
    sae.actor_id AS user_id,
    up.username,
    up.avatar_url,
    c.id AS country_id,
    c.name AS country_name,
    c.code AS country_code,
    e.id AS entry_id,
    e.title AS entry_name,
    e.type::TEXT AS entry_type,
    pl.place_name AS location_name,
    mf.file_path AS entry_image_url,
    sae.trip_id,
    sae.payload
  FROM social_feed_inbox sfi
  JOIN social_activity_event sae ON sae.id = sfi.activity_id
  JOIN user_profile up ON up.user_id = sae.actor_id
  LEFT JOIN user_countries uc ON uc.id = sae.user_country_id
  LEFT JOIN country c ON c.id = uc.country_id
  LEFT JOIN entry e ON e.id = sae.entry_id
  LEFT JOIN trip t ON t.id = e.trip_id
  LEFT JOIN trip te ON te.id = sae.trip_id
  LEFT JOIN place pl ON pl.entry_id = e.id
  LEFT JOIN LATERAL (
    SELECT m.file_path
    FROM media_files m
    WHERE m.entry_id = e.id AND m.status = 'uploaded'
    ORDER BY m.created_at
    LIMIT 1
  ) mf ON TRUE
  WHERE sfi.recipient_id = p_user_id
    AND (
      p_before IS NULL
      OR (p_before_id IS NULL AND sfi.created_at < p_before)
      OR (
        p_before_id IS NOT NULL
        AND (sfi.created_at, sfi.activity_id) < (p_before, p_before_id)
      )
    )
    AND (sae.actor_id NOT IN (SELECT uid FROM blocked_user_ids))
    AND (sae.activity_type <> 'entry_added' OR (e.deleted_at IS NULL AND t.deleted_at IS NULL))
    AND (sae.activity_type <> 'country_visited' OR uc.status = 'visited')
    AND (sae.activity_type <> 'trip_updated' OR te.deleted_at IS NULL)
  ORDER BY sfi.created_at DESC, sfi.activity_id DESC
  LIMIT p_limit + 1;
END;
$$;

-- Profile feed: reads events directly. Pagination tuple is
-- (sae.created_at, sae.id); identical cursor semantics to the home feed.
CREATE OR REPLACE FUNCTION get_user_activity_feed(
  p_viewer_id UUID,
  p_target_user_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_before_id UUID DEFAULT NULL
)
RETURNS TABLE (
  activity_id UUID,
  activity_type TEXT,
  created_at TIMESTAMPTZ,
  user_id UUID,
  username TEXT,
  avatar_url TEXT,
  country_id UUID,
  country_name TEXT,
  country_code TEXT,
  entry_id UUID,
  entry_name TEXT,
  entry_type TEXT,
  location_name TEXT,
  entry_image_url TEXT,
  trip_id UUID,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_blocked BOOLEAN;
  is_following BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_block
    WHERE (blocker_id = p_target_user_id AND blocked_id = p_viewer_id)
       OR (blocker_id = p_viewer_id AND blocked_id = p_target_user_id)
  ) INTO is_blocked;

  IF is_blocked THEN
    RETURN;
  END IF;

  SELECT (
    p_viewer_id = p_target_user_id
    OR EXISTS (
      SELECT 1 FROM user_follow
      WHERE follower_id = p_viewer_id AND following_id = p_target_user_id
    )
  ) INTO is_following;

  IF NOT is_following THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sae.id AS activity_id,
    sae.activity_type,
    sae.created_at,
    sae.actor_id AS user_id,
    up.username,
    up.avatar_url,
    c.id AS country_id,
    c.name AS country_name,
    c.code AS country_code,
    e.id AS entry_id,
    e.title AS entry_name,
    e.type::TEXT AS entry_type,
    pl.place_name AS location_name,
    mf.file_path AS entry_image_url,
    sae.trip_id,
    sae.payload
  FROM social_activity_event sae
  JOIN user_profile up ON up.user_id = sae.actor_id
  LEFT JOIN user_countries uc ON uc.id = sae.user_country_id
  LEFT JOIN country c ON c.id = uc.country_id
  LEFT JOIN entry e ON e.id = sae.entry_id
  LEFT JOIN trip t ON t.id = e.trip_id
  LEFT JOIN trip te ON te.id = sae.trip_id
  LEFT JOIN place pl ON pl.entry_id = e.id
  LEFT JOIN LATERAL (
    SELECT m.file_path
    FROM media_files m
    WHERE m.entry_id = e.id AND m.status = 'uploaded'
    ORDER BY m.created_at
    LIMIT 1
  ) mf ON TRUE
  WHERE sae.actor_id = p_target_user_id
    AND (
      p_before IS NULL
      OR (p_before_id IS NULL AND sae.created_at < p_before)
      OR (
        p_before_id IS NOT NULL
        AND (sae.created_at, sae.id) < (p_before, p_before_id)
      )
    )
    AND (sae.activity_type <> 'entry_added' OR (e.deleted_at IS NULL AND t.deleted_at IS NULL))
    AND (sae.activity_type <> 'country_visited' OR uc.status = 'visited')
    AND (sae.activity_type <> 'trip_updated' OR te.deleted_at IS NULL)
  ORDER BY sae.created_at DESC, sae.id DESC
  LIMIT p_limit + 1;
END;
$$;

--------------------------------------------------------------------------------
-- 5. GRANTS
--------------------------------------------------------------------------------

-- Both RPCs are SECURITY DEFINER and take caller-supplied user ids; recreating
-- them restores the default EXECUTE TO PUBLIC, which would let anon read any
-- user's feed via PostgREST rpc. Lock execution down to authenticated +
-- service_role (mirrors block_user_full in 0087 and the 0089 search RPCs).
REVOKE ALL ON FUNCTION get_activity_feed(UUID, TIMESTAMPTZ, INT, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION get_activity_feed(UUID, TIMESTAMPTZ, INT, UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION get_activity_feed(UUID, TIMESTAMPTZ, INT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION get_activity_feed(UUID, TIMESTAMPTZ, INT, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION get_user_activity_feed(UUID, UUID, TIMESTAMPTZ, INT, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION get_user_activity_feed(UUID, UUID, TIMESTAMPTZ, INT, UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION get_user_activity_feed(UUID, UUID, TIMESTAMPTZ, INT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_activity_feed(UUID, UUID, TIMESTAMPTZ, INT, UUID)
  TO service_role;
