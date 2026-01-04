-- Migration: Move push tokens to dedicated table with strict RLS
--
-- Security fix: Push tokens stored in user_profile were readable by any
-- authenticated user due to the permissive SELECT policy. This migration
-- moves tokens to a separate table with owner-only access.

--------------------------------------------------------------------------------
-- CREATE PUSH TOKENS TABLE
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS push_token (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT, -- 'ios' or 'android'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_push_token_user ON push_token(user_id);

-- Index for token lookups (used when sending notifications)
CREATE INDEX IF NOT EXISTS idx_push_token_token ON push_token(token) WHERE token IS NOT NULL;

--------------------------------------------------------------------------------
-- ROW LEVEL SECURITY (STRICT - OWNER ONLY)
--------------------------------------------------------------------------------

ALTER TABLE push_token ENABLE ROW LEVEL SECURITY;

-- Users can only read their own push token
CREATE POLICY "Users can read own push token"
    ON push_token FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Users can only insert their own push token
CREATE POLICY "Users can insert own push token"
    ON push_token FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Users can only update their own push token
CREATE POLICY "Users can update own push token"
    ON push_token FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Users can only delete their own push token
CREATE POLICY "Users can delete own push token"
    ON push_token FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

--------------------------------------------------------------------------------
-- MIGRATE EXISTING DATA
--------------------------------------------------------------------------------

-- Copy existing push tokens from user_profile to new table
INSERT INTO push_token (user_id, token, platform, created_at, updated_at)
SELECT
    user_id,
    push_token,
    push_platform,
    now(),
    now()
FROM user_profile
WHERE push_token IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET
    token = EXCLUDED.token,
    platform = EXCLUDED.platform,
    updated_at = now();

--------------------------------------------------------------------------------
-- CLEANUP OLD COLUMNS (optional - keep for rollback safety)
--------------------------------------------------------------------------------

-- Note: We intentionally keep push_token and push_platform columns in user_profile
-- for rollback safety. They can be dropped in a future migration after confirming
-- the new table works correctly.

-- Add comment to indicate these columns are deprecated
COMMENT ON COLUMN user_profile.push_token IS 'DEPRECATED: Use push_token table instead. Will be removed in future migration.';
COMMENT ON COLUMN user_profile.push_platform IS 'DEPRECATED: Use push_token table instead. Will be removed in future migration.';
