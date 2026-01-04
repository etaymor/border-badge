-- Migration: Fix SECURITY DEFINER functions missing SET search_path
-- This addresses a security vulnerability where functions with SECURITY DEFINER
-- lack the SET search_path = public clause, which could allow search_path hijacking.
--
-- Functions fixed:
-- 1. is_blocked_bidirectional() from 0033_social_tables.sql
-- 2. get_friends_ranking() from 0035_ranking_function.sql
-- 3. soft_delete_trip() from 0011_atomic_soft_delete.sql

--------------------------------------------------------------------------------
-- FIX is_blocked_bidirectional()
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_blocked_bidirectional(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_block
    WHERE (blocker_id = auth.uid() AND blocked_id = p_user_id)
       OR (blocker_id = p_user_id AND blocked_id = auth.uid())
  );
END;
$$;

--------------------------------------------------------------------------------
-- FIX get_friends_ranking()
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
SET search_path = public
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

  -- Count friends, compute rank, and get leader in one query
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
      COUNT(DISTINCT uc.country_id) as total_countries,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT uc.country_id) DESC) as rank_by_countries
    FROM user_profile up
    JOIN limited_follows lf ON lf.following_id = up.user_id
    LEFT JOIN user_countries uc ON uc.user_id = up.user_id AND uc.status = 'visited'
    GROUP BY up.user_id, up.username
  )
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE fs.total_countries > v_my_countries)::INT + 1,
    MAX(CASE WHEN fs.rank_by_countries = 1 THEN fs.username END),
    MAX(CASE WHEN fs.rank_by_countries = 1 THEN fs.total_countries END)
  INTO v_total_friends, v_rank, v_leader_username, v_leader_countries
  FROM friend_stats fs;

  RETURN QUERY SELECT
    COALESCE(v_rank, 1),
    COALESCE(v_total_friends, 0),
    COALESCE(v_my_countries, 0),
    v_leader_username,
    v_leader_countries;
END;
$$;

--------------------------------------------------------------------------------
-- FIX soft_delete_trip()
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION soft_delete_trip(p_trip_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE trip
  SET deleted_at = now()
  WHERE id = p_trip_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
