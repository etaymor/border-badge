-- Migration: 0059_social_home_stats_rpc
-- Description: Consolidate 3 separate count queries into a single RPC call
-- for the /social/home endpoint. Reduces HTTP round trips to Supabase from 3 to 1.

CREATE OR REPLACE FUNCTION get_social_home_stats(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'follower_count', (SELECT COUNT(*) FROM user_follow WHERE following_id = p_user_id),
    'following_count', (SELECT COUNT(*) FROM user_follow WHERE follower_id = p_user_id),
    'pending_tag_count', (SELECT COUNT(*) FROM trip_tags WHERE tagged_user_id = p_user_id AND status = 'pending')
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_social_home_stats(UUID) TO authenticated;
