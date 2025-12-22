-- Remove saved_source table and update oembed_cache to be permanent
-- This consolidation eliminates duplicate oEmbed data storage.
-- The oembed_cache table now serves as the single source of truth for shared metadata.

--------------------------------------------------------------------------------
-- DROP saved_source TABLE
--------------------------------------------------------------------------------

-- Drop RLS policies first
DROP POLICY IF EXISTS saved_source_select_own ON saved_source;
DROP POLICY IF EXISTS saved_source_insert_own ON saved_source;
DROP POLICY IF EXISTS saved_source_update_own ON saved_source;
DROP POLICY IF EXISTS saved_source_delete_own ON saved_source;

-- Drop trigger and function
DROP TRIGGER IF EXISTS saved_source_updated_at ON saved_source;
DROP FUNCTION IF EXISTS update_saved_source_timestamp();

-- Drop indexes
DROP INDEX IF EXISTS idx_saved_source_user;
DROP INDEX IF EXISTS idx_saved_source_canonical_url;
DROP INDEX IF EXISTS idx_saved_source_provider;
DROP INDEX IF EXISTS idx_saved_source_entry;
DROP INDEX IF EXISTS idx_saved_source_created;

-- Drop the table
DROP TABLE IF EXISTS saved_source;

--------------------------------------------------------------------------------
-- UPDATE oembed_cache TO BE PERMANENT
--------------------------------------------------------------------------------

-- Update table comment to reflect permanent storage
COMMENT ON TABLE oembed_cache IS 'Permanent cache for TikTok/Instagram oEmbed responses. Shared across all users. Data is never deleted based on expires_at.';

-- Update column comment to clarify expires_at is for optional refresh, not deletion
COMMENT ON COLUMN oembed_cache.expires_at IS 'Soft expiry for optional refresh logic. Data is NOT deleted after this time.';

-- Drop the expires_at index since we no longer query by expiration
DROP INDEX IF EXISTS idx_oembed_cache_expires;
