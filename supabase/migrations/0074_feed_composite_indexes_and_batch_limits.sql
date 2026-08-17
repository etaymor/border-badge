-- Migration: 0047_feed_composite_indexes_and_batch_limits
-- Description: Add composite indexes for feed cursor pagination and batch query limits
--
-- Changes:
-- 1. Add composite indexes (created_at DESC, id DESC) for efficient cursor pagination
-- 2. Add array size validation to get_user_country_counts to prevent unbounded queries

--------------------------------------------------------------------------------
-- 1. COMPOSITE INDEXES FOR FEED CURSOR PAGINATION
--------------------------------------------------------------------------------

-- Drop existing single-column indexes if they exist (we'll replace with composite)
DROP INDEX IF EXISTS idx_user_countries_user_created;
DROP INDEX IF EXISTS idx_entry_created;

-- Composite index for user_countries: supports (created_at, id) cursor pagination
-- Used by get_activity_feed and get_user_activity_feed for country_visited items
CREATE INDEX IF NOT EXISTS idx_user_countries_feed_cursor
  ON user_countries(user_id, created_at DESC, id DESC)
  WHERE status = 'visited';

-- Composite index for entry: supports (created_at, id) cursor pagination
-- Used by get_activity_feed and get_user_activity_feed for entry_added items
CREATE INDEX IF NOT EXISTS idx_entry_feed_cursor
  ON entry(created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Additional index for entry lookups by trip (used in feed JOIN)
CREATE INDEX IF NOT EXISTS idx_entry_trip_id_created
  ON entry(trip_id, created_at DESC)
  WHERE deleted_at IS NULL;

--------------------------------------------------------------------------------
-- 2. BATCH SIZE VALIDATION FOR get_user_country_counts
--------------------------------------------------------------------------------

-- Replace function with array size limit to prevent unbounded queries
CREATE OR REPLACE FUNCTION get_user_country_counts(user_ids UUID[])
RETURNS TABLE (
  user_id UUID,
  count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Limit array size to prevent performance issues with large batches
  -- Callers should paginate if they need more than 100 users
  IF array_length(user_ids, 1) > 100 THEN
    RAISE EXCEPTION 'user_ids array exceeds maximum size of 100'
      USING HINT = 'Paginate requests to fetch user counts in batches';
  END IF;

  RETURN QUERY
  SELECT uc.user_id, COUNT(DISTINCT uc.country_id)::BIGINT as count
  FROM user_countries uc
  WHERE uc.user_id = ANY(user_ids)
    AND uc.status = 'visited'
  GROUP BY uc.user_id;
END;
$$;

-- Add comment documenting the limit
COMMENT ON FUNCTION get_user_country_counts(UUID[]) IS
  'Returns visited country counts for up to 100 users. Raises exception if array exceeds limit.';
