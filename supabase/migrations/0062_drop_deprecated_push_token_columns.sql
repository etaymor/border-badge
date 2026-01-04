-- Migration: Remove deprecated push_token columns from user_profile
--
-- These columns were migrated to the push_token table in 0060_push_tokens_table.sql.
-- The new table has strict RLS (owner-only access) while user_profile has
-- permissive SELECT policies that could expose tokens.
--
-- This migration removes the deprecated columns entirely to eliminate
-- the security risk of having push tokens in a table with broad read access.

--------------------------------------------------------------------------------
-- DROP INDEX FIRST (must be done before dropping the column)
--------------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_user_profile_push_token;

--------------------------------------------------------------------------------
-- DROP DEPRECATED COLUMNS
--------------------------------------------------------------------------------

-- Remove push_token column
ALTER TABLE user_profile DROP COLUMN IF EXISTS push_token;

-- Remove push_platform column
ALTER TABLE user_profile DROP COLUMN IF EXISTS push_platform;

--------------------------------------------------------------------------------
-- COMMENTS
--------------------------------------------------------------------------------

-- Note: Push tokens are now stored exclusively in the push_token table
-- with strict RLS policies (owner-only access). See migration 0060.
