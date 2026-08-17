-- Migration: 0036_check_email_function
-- Description: Add function to check if email exists (for invite deduplication)
-- This function is called with service role to check auth.users

-- Function to check if an email already exists in auth.users
-- This is SECURITY DEFINER to allow checking auth.users without exposing the table
CREATE OR REPLACE FUNCTION check_email_exists(email_to_check TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    user_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM auth.users
        WHERE LOWER(email) = LOWER(email_to_check)
    ) INTO user_exists;

    RETURN jsonb_build_object('exists', user_exists);
END;
$$;

-- Grant execute to service role only (not anon or authenticated)
REVOKE ALL ON FUNCTION check_email_exists(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_email_exists(TEXT) FROM anon;
REVOKE ALL ON FUNCTION check_email_exists(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION check_email_exists(TEXT) TO service_role;

-- Add invite_code column to pending_invite if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pending_invite' AND column_name = 'invite_code'
    ) THEN
        ALTER TABLE pending_invite ADD COLUMN invite_code TEXT;
    END IF;
END $$;

-- Add index on invite_code for efficient lookups
CREATE INDEX IF NOT EXISTS idx_pending_invite_code ON pending_invite(invite_code);
