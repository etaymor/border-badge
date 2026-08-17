-- Migration: 0037_push_token_column
-- Description: Add push_token column to user_profile for push notifications

-- Add push_token column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_profile' AND column_name = 'push_token'
    ) THEN
        ALTER TABLE user_profile ADD COLUMN push_token TEXT;
    END IF;
END $$;

-- Add platform column for token type (ios/android)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_profile' AND column_name = 'push_platform'
    ) THEN
        ALTER TABLE user_profile ADD COLUMN push_platform TEXT;
    END IF;
END $$;

-- Column-level security: push_token should never be exposed in queries
-- except when explicitly selecting by the user themselves
-- We'll handle this in the API layer by never selecting push_token in public queries

-- Create an index on push_token for efficient lookups when sending notifications
CREATE INDEX IF NOT EXISTS idx_user_profile_push_token ON user_profile(push_token) WHERE push_token IS NOT NULL;
