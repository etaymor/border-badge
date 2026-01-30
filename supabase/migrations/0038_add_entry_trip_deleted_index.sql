-- Add partial index for active entries sorted by created_at (descending)
-- This optimizes the Saved Places "created_at_desc" sort pattern:
--   WHERE trip_id = X AND deleted_at IS NULL ORDER BY created_at DESC
-- The partial index excludes soft-deleted entries for better performance.

CREATE INDEX IF NOT EXISTS idx_entry_trip_created_active
  ON entry(trip_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Note: The existing idx_entry_trip_date covers date-based sorting.
-- This new index specifically optimizes the created_at DESC sort used by Saved Places.
