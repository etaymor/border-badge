-- Migration: 0054_optimize_profile_stats
-- Description: Optimize get_public_profile_stats to reduce table scans
--
-- Performance improvement: Uses CTE to compute travel stats in a single scan
-- of user_countries instead of 3 separate subqueries.

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
  WITH travel_stats AS (
    SELECT
      COUNT(*) AS country_count,
      COUNT(DISTINCT c.region) AS continent_count,
      COUNT(DISTINCT c.subregion) AS subregion_count
    FROM user_countries uc
    JOIN country c ON c.id = uc.country_id
    WHERE uc.user_id = p_user_id AND uc.status = 'visited'
  )
  SELECT
    ts.country_count,
    ts.continent_count,
    ts.subregion_count,
    (SELECT COUNT(*) FROM user_follow WHERE following_id = p_user_id) AS follower_count,
    (SELECT COUNT(*) FROM user_follow WHERE follower_id = p_user_id) AS following_count
  FROM travel_stats ts;
$$;

-- Grant execute to public since this is used for public profile pages
GRANT EXECUTE ON FUNCTION get_public_profile_stats(UUID) TO anon, authenticated;
