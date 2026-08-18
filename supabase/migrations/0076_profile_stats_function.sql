-- Migration: 0052_profile_stats_function
-- Description: Add RPC function for efficient profile stats calculation
--
-- This function calculates country/continent/subregion counts using SQL aggregation
-- instead of fetching all rows and iterating in Python.
--
-- Performance improvement: O(1) SQL query with COUNT DISTINCT vs O(n) Python iteration

CREATE OR REPLACE FUNCTION get_public_profile_stats(p_user_id UUID)
RETURNS TABLE (
  country_count BIGINT,
  continent_count BIGINT,
  subregion_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    COUNT(*) as country_count,
    COUNT(DISTINCT c.region) as continent_count,
    COUNT(DISTINCT c.subregion) as subregion_count
  FROM user_countries uc
  JOIN country c ON c.id = uc.country_id
  WHERE uc.user_id = p_user_id
    AND uc.status = 'visited';
$$;

-- Grant execute to public since this is used for public profile pages
GRANT EXECUTE ON FUNCTION get_public_profile_stats(UUID) TO anon, authenticated;
