-- Migration: 0039_user_activity_feed
-- Description: Create function to get a specific user's activity feed
--
-- This function returns a user's own activities (not their followed users)
-- Used for displaying activity on user profile pages

CREATE OR REPLACE FUNCTION get_user_activity_feed(
  p_viewer_id UUID,        -- The user viewing the profile
  p_target_user_id UUID,   -- The user whose activities we want
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

  -- Entries added by target user
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
  JOIN user_profile up ON up.user_id = t.user_id
  WHERE t.user_id = p_target_user_id
    AND t.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND (p_before IS NULL OR e.created_at < p_before)

  ORDER BY created_at DESC
  LIMIT p_limit + 1;
END;
$$;
