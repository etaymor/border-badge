-- Add composite index for user_id + canonical_url queries on saved_source
-- This optimizes the common lookup pattern when checking for duplicate shares

CREATE INDEX IF NOT EXISTS idx_saved_source_user_url
  ON saved_source(user_id, canonical_url);

-- Drop the individual canonical_url index since the composite index covers it
-- (queries filtering only by canonical_url can still use the composite index)
DROP INDEX IF EXISTS idx_saved_source_canonical_url;
