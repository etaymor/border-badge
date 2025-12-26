-- Migration: Create friends ranking function
-- Part of Phase 1.7: Friends Ranking Stats
--
-- This migration creates:
-- 1. get_friends_ranking function that computes user's rank among followed users
-- 2. On-demand computation, no pre-computed stats table

--------------------------------------------------------------------------------
-- FRIENDS RANKING FUNCTION
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_friends_ranking(p_user_id UUID)
RETURNS TABLE (
  rank INT,
  total_friends INT,
  my_countries BIGINT,
  leader_username TEXT,
  leader_countries BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_my_countries BIGINT;
  v_total_friends INT;
  v_rank INT;
  v_leader_username TEXT;
  v_leader_countries BIGINT;
BEGIN
  -- Get my country count
  SELECT COUNT(DISTINCT country_id) INTO v_my_countries
  FROM user_countries
  WHERE user_id = p_user_id AND status = 'visited';

  -- Count friends and compute rank in one query
  WITH limited_follows AS (
    -- Limit to 1000 most recent follows for performance
    SELECT following_id
    FROM user_follow
    WHERE follower_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1000
  ),
  friend_stats AS (
    SELECT
      up.user_id,
      up.username,
      COUNT(DISTINCT uc.country_id) as total_countries
    FROM user_profile up
    JOIN limited_follows lf ON lf.following_id = up.user_id
    LEFT JOIN user_countries uc ON uc.user_id = up.user_id AND uc.status = 'visited'
    GROUP BY up.user_id, up.username
  )
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE fs.total_countries > v_my_countries)::INT + 1
  INTO v_total_friends, v_rank
  FROM friend_stats fs;

  -- Get the leader (friend with most countries)
  WITH limited_follows AS (
    SELECT following_id
    FROM user_follow
    WHERE follower_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1000
  ),
  friend_stats AS (
    SELECT
      up.username,
      COUNT(DISTINCT uc.country_id) as total_countries
    FROM user_profile up
    JOIN limited_follows lf ON lf.following_id = up.user_id
    LEFT JOIN user_countries uc ON uc.user_id = up.user_id AND uc.status = 'visited'
    GROUP BY up.user_id, up.username
    ORDER BY total_countries DESC
    LIMIT 1
  )
  SELECT fs.username, fs.total_countries
  INTO v_leader_username, v_leader_countries
  FROM friend_stats fs;

  RETURN QUERY SELECT
    COALESCE(v_rank, 1),
    COALESCE(v_total_friends, 0),
    COALESCE(v_my_countries, 0),
    v_leader_username,
    v_leader_countries;
END;
$$;
