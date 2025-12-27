-- Migration: 0041_lookup_user_by_email
-- Description: Add function to look up user profile by exact email match
-- Used for friend tagging to find existing users by email

-- Function to look up a user's profile by their email address
-- Returns the user_profile row if found, NULL if not found
-- This is SECURITY DEFINER to allow joining auth.users with user_profile
CREATE OR REPLACE FUNCTION lookup_user_by_email(email_to_lookup TEXT)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    RETURN QUERY
    SELECT
        up.id,
        up.user_id,
        up.username,
        up.display_name,
        up.avatar_url
    FROM auth.users au
    INNER JOIN public.user_profile up ON up.user_id = au.id
    WHERE LOWER(au.email) = LOWER(email_to_lookup)
    LIMIT 1;
END;
$$;

-- Grant execute to service role only (not anon or authenticated)
-- This prevents email enumeration by unauthenticated users
REVOKE ALL ON FUNCTION lookup_user_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION lookup_user_by_email(TEXT) FROM anon;
REVOKE ALL ON FUNCTION lookup_user_by_email(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION lookup_user_by_email(TEXT) TO service_role;
