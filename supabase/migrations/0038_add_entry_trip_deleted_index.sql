-- Add composite index for entry(trip_id, deleted_at) queries
-- This optimizes the common pattern of querying entries by trip with soft-delete filter
-- Used frequently by bulk move operations and entry listing

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entry_trip_deleted
  ON entry(trip_id, deleted_at);

-- Note: The existing idx_entry_trip_date and idx_entry_trip_type indexes
-- don't include deleted_at, so queries filtering by deleted_at IS NULL
-- benefit from this dedicated composite index.
