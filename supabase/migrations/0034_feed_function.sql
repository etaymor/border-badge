-- Migration: Create feed function for activity feed
-- Part of Phase 1.5: Activity Feed Backend
--
-- This migration creates:
-- 1. get_activity_feed function that returns followed users' activities
-- 2. Uses UNION ALL for country visits and entries
-- 3. Excludes blocked users bidirectionally
-- 4. Supports cursor-based pagination
--
-- NOTE: Performance optimizations applied in migration 0045

--------------------------------------------------------------------------------
-- FEED FUNCTION
--------------------------------------------------------------------------------

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
AS $$
BEGIN
  RETURN QUERY
  WITH followed_users AS (
    SELECT following_id
    FROM user_follow
    WHERE follower_id = p_user_id
  ),
  blocked_users AS (
    SELECT blocked_id AS user_id FROM user_block WHERE blocker_id = p_user_id
    UNION
    SELECT blocker_id AS user_id FROM user_block WHERE blocked_id = p_user_id
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
    AND uc.user_id NOT IN (SELECT bu.user_id FROM blocked_users bu)
    AND (p_before IS NULL OR uc.created_at < p_before)

  UNION ALL

  -- Entries added by followed users
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
    (
      SELECT mf.file_path FROM media_files mf
      WHERE mf.entry_id = e.id
        AND mf.status = 'uploaded'
      ORDER BY mf.created_at
      LIMIT 1
    ) as entry_image_url
  FROM entry e
  JOIN trip t ON t.id = e.trip_id
  JOIN followed_users fu ON fu.following_id = t.user_id
  JOIN user_profile up ON up.user_id = t.user_id
  WHERE t.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND t.user_id NOT IN (SELECT bu.user_id FROM blocked_users bu)
    AND (p_before IS NULL OR e.created_at < p_before)

  ORDER BY created_at DESC
  LIMIT p_limit + 1;  -- Fetch one extra to check if there's more
END;
$$;
