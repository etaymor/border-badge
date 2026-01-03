-- Migration: Precompute social feed events and inboxes for fast queries
-- 1. Introduce social activity tables
-- 2. Add trigger functions to generate events and fan-out to followers
-- 3. Rewrite feed functions to read from the inbox
-- 4. Provide backfill helper

--------------------------------------------------------------------------------
-- ENUMS
--------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'social_activity_type') THEN
    CREATE TYPE social_activity_type AS ENUM ('country_visited', 'entry_added');
  END IF;
END
$$;

--------------------------------------------------------------------------------
-- TABLES
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS social_activity_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type social_activity_type NOT NULL,
  user_country_id UUID REFERENCES user_countries(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES entry(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE social_activity_event
  ADD CONSTRAINT social_activity_event_source_check
  CHECK (
    (activity_type = 'country_visited' AND user_country_id IS NOT NULL AND entry_id IS NULL)
    OR
    (activity_type = 'entry_added' AND entry_id IS NOT NULL AND user_country_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_activity_event_country_unique
  ON social_activity_event(user_country_id)
  WHERE user_country_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_activity_event_entry_unique
  ON social_activity_event(entry_id)
  WHERE entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_activity_event_actor_created
  ON social_activity_event(actor_id, created_at DESC);

ALTER TABLE social_activity_event ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS social_feed_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES social_activity_event(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_feed_inbox_recipient_activity
  ON social_feed_inbox(recipient_id, activity_id);

CREATE INDEX IF NOT EXISTS idx_social_feed_inbox_recipient_created
  ON social_feed_inbox(recipient_id, created_at DESC);

ALTER TABLE social_feed_inbox ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- FAN-OUT AND TRIGGER HELPERS
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fanout_activity_to_followers(
  p_activity_id UUID,
  p_actor_id UUID,
  p_created_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO social_feed_inbox (recipient_id, activity_id, actor_id, created_at)
  SELECT follower_id, p_activity_id, p_actor_id, p_created_at
  FROM user_follow
  WHERE following_id = p_actor_id
  ON CONFLICT (recipient_id, activity_id) DO NOTHING;
END;
$$;

-- Country visit events --------------------------------------------------------

CREATE OR REPLACE FUNCTION create_country_visit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity_id UUID;
BEGIN
  IF NEW.status = 'visited' THEN
    INSERT INTO social_activity_event(actor_id, activity_type, user_country_id, created_at)
    VALUES (NEW.user_id, 'country_visited', NEW.id, NEW.created_at)
    RETURNING id INTO v_activity_id;

    PERFORM fanout_activity_to_followers(v_activity_id, NEW.user_id, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_countries_create_event
AFTER INSERT ON user_countries
FOR EACH ROW
EXECUTE FUNCTION create_country_visit_event();

CREATE OR REPLACE FUNCTION remove_country_visit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'visited' AND COALESCE(NEW.status, 'wishlist') <> 'visited' THEN
    DELETE FROM social_activity_event WHERE user_country_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_countries_remove_event
AFTER UPDATE ON user_countries
FOR EACH ROW
EXECUTE FUNCTION remove_country_visit_event();

-- Entry events ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_entry_added_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_activity_id UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_owner_id FROM trip WHERE id = NEW.trip_id;
  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO social_activity_event(actor_id, activity_type, entry_id, created_at)
  VALUES (v_owner_id, 'entry_added', NEW.id, NEW.created_at)
  RETURNING id INTO v_activity_id;

  PERFORM fanout_activity_to_followers(v_activity_id, v_owner_id, NEW.created_at);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entry_create_event
AFTER INSERT ON entry
FOR EACH ROW
EXECUTE FUNCTION create_entry_added_event();

CREATE OR REPLACE FUNCTION remove_entry_event_on_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    DELETE FROM social_activity_event WHERE entry_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entry_soft_delete_event
AFTER UPDATE ON entry
FOR EACH ROW
EXECUTE FUNCTION remove_entry_event_on_soft_delete();

-- Follow fan-out --------------------------------------------------------------

CREATE OR REPLACE FUNCTION fanout_existing_events_on_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NOTE: We limit backfill to the 50 most recent events to avoid slow inserts
  -- when following users with extensive history. This means if a new follower
  -- scrolls past the 50 most recent posts, they won't see older content from
  -- before the follow. This is an acceptable trade-off for most use cases.
  INSERT INTO social_feed_inbox(recipient_id, activity_id, actor_id, created_at)
  SELECT NEW.follower_id, sae.id, sae.actor_id, sae.created_at
  FROM social_activity_event sae
  WHERE sae.actor_id = NEW.following_id
  ORDER BY sae.created_at DESC
  LIMIT 50
  ON CONFLICT (recipient_id, activity_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_follow_backfill_inbox
AFTER INSERT ON user_follow
FOR EACH ROW
EXECUTE FUNCTION fanout_existing_events_on_follow();

--------------------------------------------------------------------------------
-- REWRITE FEED FUNCTIONS TO USE THE PRECOMPUTED INBOX
--------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_activity_feed(UUID, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS get_user_activity_feed(UUID, UUID, TIMESTAMPTZ, INT);

CREATE OR REPLACE FUNCTION get_activity_feed(
  p_user_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
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
  entry_image_url TEXT
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
    sae.activity_type::TEXT,
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
    mf.file_path AS entry_image_url
  FROM social_feed_inbox sfi
  JOIN social_activity_event sae ON sae.id = sfi.activity_id
  JOIN user_profile up ON up.user_id = sae.actor_id
  LEFT JOIN user_countries uc ON uc.id = sae.user_country_id
  LEFT JOIN country c ON c.id = uc.country_id
  LEFT JOIN entry e ON e.id = sae.entry_id
  LEFT JOIN trip t ON t.id = e.trip_id
  LEFT JOIN place pl ON pl.entry_id = e.id
  LEFT JOIN LATERAL (
    SELECT m.file_path
    FROM media_files m
    WHERE m.entry_id = e.id AND m.status = 'uploaded'
    ORDER BY m.created_at
    LIMIT 1
  ) mf ON TRUE
  WHERE sfi.recipient_id = p_user_id
    AND (p_before IS NULL OR sfi.created_at < p_before)
    AND (sae.actor_id NOT IN (SELECT uid FROM blocked_user_ids))
    AND (sae.activity_type <> 'entry_added' OR (e.deleted_at IS NULL AND t.deleted_at IS NULL))
    AND (sae.activity_type <> 'country_visited' OR uc.status = 'visited')
  ORDER BY sfi.created_at DESC
  LIMIT p_limit + 1;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_activity_feed(
  p_viewer_id UUID,
  p_target_user_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
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
  entry_image_url TEXT
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
    sae.activity_type::TEXT,
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
    mf.file_path AS entry_image_url
  FROM social_activity_event sae
  JOIN user_profile up ON up.user_id = sae.actor_id
  LEFT JOIN user_countries uc ON uc.id = sae.user_country_id
  LEFT JOIN country c ON c.id = uc.country_id
  LEFT JOIN entry e ON e.id = sae.entry_id
  LEFT JOIN trip t ON t.id = e.trip_id
  LEFT JOIN place pl ON pl.entry_id = e.id
  LEFT JOIN LATERAL (
    SELECT m.file_path
    FROM media_files m
    WHERE m.entry_id = e.id AND m.status = 'uploaded'
    ORDER BY m.created_at
    LIMIT 1
  ) mf ON TRUE
  WHERE sae.actor_id = p_target_user_id
    AND (p_before IS NULL OR sae.created_at < p_before)
    AND (sae.activity_type <> 'entry_added' OR (e.deleted_at IS NULL AND t.deleted_at IS NULL))
    AND (sae.activity_type <> 'country_visited' OR uc.status = 'visited')
  ORDER BY sae.created_at DESC
  LIMIT p_limit + 1;
END;
$$;

--------------------------------------------------------------------------------
-- BACKFILL FUNCTION
--------------------------------------------------------------------------------

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

  INSERT INTO social_activity_event(actor_id, activity_type, entry_id, created_at)
  SELECT t.user_id, 'entry_added', e.id, e.created_at
  FROM entry e
  JOIN trip t ON t.id = e.trip_id
  WHERE e.deleted_at IS NULL AND t.deleted_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO social_feed_inbox(recipient_id, activity_id, actor_id, created_at)
  SELECT uf.follower_id, sae.id, sae.actor_id, sae.created_at
  FROM user_follow uf
  JOIN social_activity_event sae ON sae.actor_id = uf.following_id
  ON CONFLICT (recipient_id, activity_id) DO NOTHING;
END;
$$;

SELECT backfill_social_feed();
