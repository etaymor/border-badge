-- Migration: 0053_profile_stats_with_follows
-- Description: Add follower/following counts to profile stats RPC
--
-- Performance optimization: Reduces 3 queries to 1 for public profile pages
-- by including follower_count and following_count in the existing RPC function.
--
-- Note: Must DROP first because PostgreSQL doesn't allow changing return type
-- with CREATE OR REPLACE.
--
-- RETURNS TABLE Note: Although this function uses scalar subqueries that always
-- return exactly one row, RETURNS TABLE is intentional for PostgREST compatibility.
-- Callers should use get_rpc_first_row() to extract the single result row.

DROP FUNCTION IF EXISTS get_public_profile_stats(UUID);

CREATE FUNCTION get_public_profile_stats(p_user_id UUID)
RETURNS TABLE (
  country_count BIGINT,
  continent_count BIGINT,
  subregion_count BIGINT,
  follower_count BIGINT,
  following_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    (SELECT COUNT(*) FROM user_countries uc
     JOIN country c ON c.id = uc.country_id
     WHERE uc.user_id = p_user_id AND uc.status = 'visited') as country_count,
    (SELECT COUNT(DISTINCT c.region) FROM user_countries uc
     JOIN country c ON c.id = uc.country_id
     WHERE uc.user_id = p_user_id AND uc.status = 'visited') as continent_count,
    (SELECT COUNT(DISTINCT c.subregion) FROM user_countries uc
     JOIN country c ON c.id = uc.country_id
     WHERE uc.user_id = p_user_id AND uc.status = 'visited') as subregion_count,
    (SELECT COUNT(*) FROM user_follow WHERE following_id = p_user_id) as follower_count,
    (SELECT COUNT(*) FROM user_follow WHERE follower_id = p_user_id) as following_count;
$$;

-- Grant execute to public since this is used for public profile pages
GRANT EXECUTE ON FUNCTION get_public_profile_stats(UUID) TO anon, authenticated;
