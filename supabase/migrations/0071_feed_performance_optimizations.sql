-- Migration: 0045_feed_performance_optimizations
-- Description: Performance improvements for activity feed queries
--
-- Resolves PERFORMANCE TODOs from migrations 0034 and 0039:
-- 1. Adds composite index for media_files lookup
-- 2. Rewrites get_activity_feed with LATERAL JOIN (eliminates N+1)
-- 3. Rewrites get_user_activity_feed with LATERAL JOIN
-- 4. Pre-filters blocked users in CTE to avoid per-row subquery

--------------------------------------------------------------------------------
-- 1. ADD COMPOSITE INDEX FOR MEDIA LOOKUP
--------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_media_files_entry_feed
ON media_files(entry_id, status, created_at DESC)
WHERE status = 'uploaded';

--------------------------------------------------------------------------------
-- 2. OPTIMIZED get_activity_feed FUNCTION
--------------------------------------------------------------------------------
-- Changes:
-- - Uses LATERAL JOIN instead of correlated subquery for media
-- - Pre-filters followed_users to exclude blocked in CTE (avoids per-row check)
-- - Maintains same return signature and behavior

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
    -- Get all users blocked bidirectionally (computed once)
    SELECT blocked_id AS uid FROM user_block WHERE blocker_id = p_user_id
    UNION
    SELECT blocker_id AS uid FROM user_block WHERE blocked_id = p_user_id
  ),
  followed_users AS (
    -- Pre-filter to exclude blocked users from followed list
    SELECT uf.following_id
    FROM user_follow uf
    WHERE uf.follower_id = p_user_id
      AND uf.following_id NOT IN (SELECT uid FROM blocked_user_ids)
  )

  -- Countries visited by followed users
  SELECT
    'country_visited'::TEXT as activity_type,
    uc.created_at,
    uc.user_id,
    up.username,
    up.avatar_url,
    c.id as country_id,
    c.name as country_name,
    c.code as country_code,
    NULL::UUID as entry_id,
    NULL::TEXT as entry_name,
    NULL::TEXT as entry_type,
    NULL::TEXT as location_name,
    NULL::TEXT as entry_image_url
  FROM user_countries uc
  JOIN followed_users fu ON fu.following_id = uc.user_id
  JOIN user_profile up ON up.user_id = uc.user_id
  JOIN country c ON c.id = uc.country_id
  WHERE uc.status = 'visited'
    AND (p_before IS NULL OR uc.created_at < p_before)

  UNION ALL

  -- Entries added by followed users (with LATERAL JOIN for media)
  SELECT
    'entry_added'::TEXT as activity_type,
    e.created_at,
    t.user_id,
    up.username,
    up.avatar_url,
    NULL::UUID as country_id,
    NULL::TEXT as country_name,
    NULL::TEXT as country_code,
    e.id as entry_id,
    e.title as entry_name,
    e.type::TEXT as entry_type,
    NULL::TEXT as location_name,
    mf.file_path as entry_image_url
  FROM entry e
  JOIN trip t ON t.id = e.trip_id
  JOIN followed_users fu ON fu.following_id = t.user_id
  JOIN user_profile up ON up.user_id = t.user_id
  LEFT JOIN LATERAL (
    SELECT m.file_path
    FROM media_files m
    WHERE m.entry_id = e.id
      AND m.status = 'uploaded'
    ORDER BY m.created_at
    LIMIT 1
  ) mf ON true
  WHERE t.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND (p_before IS NULL OR e.created_at < p_before)

  ORDER BY created_at DESC
  LIMIT p_limit + 1;
END;
$$;

--------------------------------------------------------------------------------
-- 3. OPTIMIZED get_user_activity_feed FUNCTION
--------------------------------------------------------------------------------
-- Changes:
-- - Uses LATERAL JOIN instead of correlated subquery for media
-- - Maintains same return signature and behavior

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
  -- Check if viewer is blocked by target or vice versa
  SELECT EXISTS (
    SELECT 1 FROM user_block
    WHERE (blocker_id = p_target_user_id AND blocked_id = p_viewer_id)
       OR (blocker_id = p_viewer_id AND blocked_id = p_target_user_id)
  ) INTO is_blocked;

  -- If blocked, return empty result
  IF is_blocked THEN
    RETURN;
  END IF;

  -- Check if viewer follows the target (or is the target themselves)
  SELECT (
    p_viewer_id = p_target_user_id
    OR EXISTS (
      SELECT 1 FROM user_follow
      WHERE follower_id = p_viewer_id AND following_id = p_target_user_id
    )
  ) INTO is_following;

  -- If not following and not self, return empty (can't see their activity)
  IF NOT is_following THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Countries visited by target user
  SELECT
    'country_visited'::TEXT as activity_type,
    uc.created_at,
    uc.user_id,
    up.username,
    up.avatar_url,
    c.id as country_id,
    c.name as country_name,
    c.code as country_code,
    NULL::UUID as entry_id,
    NULL::TEXT as entry_name,
    NULL::TEXT as entry_type,
    NULL::TEXT as location_name,
    NULL::TEXT as entry_image_url
  FROM user_countries uc
  JOIN user_profile up ON up.user_id = uc.user_id
  JOIN country c ON c.id = uc.country_id
  WHERE uc.user_id = p_target_user_id
    AND uc.status = 'visited'
    AND (p_before IS NULL OR uc.created_at < p_before)

  UNION ALL

  -- Entries added by target user (with LATERAL JOIN for media)
  SELECT
    'entry_added'::TEXT as activity_type,
    e.created_at,
    t.user_id,
    up.username,
    up.avatar_url,
    NULL::UUID as country_id,
    NULL::TEXT as country_name,
    NULL::TEXT as country_code,
    e.id as entry_id,
    e.title as entry_name,
    e.type::TEXT as entry_type,
    NULL::TEXT as location_name,
    mf.file_path as entry_image_url
  FROM entry e
  JOIN trip t ON t.id = e.trip_id
  JOIN user_profile up ON up.user_id = t.user_id
  LEFT JOIN LATERAL (
    SELECT m.file_path
    FROM media_files m
    WHERE m.entry_id = e.id
      AND m.status = 'uploaded'
    ORDER BY m.created_at
    LIMIT 1
  ) mf ON true
  WHERE t.user_id = p_target_user_id
    AND t.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND (p_before IS NULL OR e.created_at < p_before)

  ORDER BY created_at DESC
  LIMIT p_limit + 1;
END;
$$;
