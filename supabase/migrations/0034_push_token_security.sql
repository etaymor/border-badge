-- Migration: Add push_token column with column-level security
-- Ensures push tokens are only visible to the owner, never exposed in public API

-- Add push_token column to user_profile
ALTER TABLE user_profile ADD COLUMN push_token TEXT;

-- Revoke SELECT on push_token from public roles
-- This prevents push_token from appearing in SELECT * queries
REVOKE SELECT (push_token) ON user_profile FROM anon, authenticated;

-- Grant SELECT on all OTHER columns to maintain existing access
GRANT SELECT (id, user_id, username, display_name, avatar_url, is_test, created_at, updated_at)
    ON user_profile TO anon, authenticated;

-- Create RLS policy for users to view their own push_token
-- This allows authenticated users to see their own token via explicit SELECT
CREATE POLICY "Users can view own push token"
    ON user_profile FOR SELECT
    USING (auth.uid() = user_id);

-- Create RLS policy for users to update their own push_token
CREATE POLICY "Users can update own push token"
    ON user_profile FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

COMMENT ON COLUMN user_profile.push_token IS
    'Expo push notification token.
     Column-level security ensures tokens are never exposed in public API.
     Only owner can SELECT/UPDATE their own token via RLS policies.
     Backend uses service role to read tokens for sending notifications.';
