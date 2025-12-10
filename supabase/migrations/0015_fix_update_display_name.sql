-- Migration: Fix update_display_name to handle missing profile (race condition)
-- When a user verifies OTP, the mobile app calls update_display_name immediately.
-- Due to a race condition, the profile might not exist yet if the handle_new_user
-- trigger hasn't completed. This migration changes UPDATE to UPSERT to handle this.

CREATE OR REPLACE FUNCTION update_display_name(new_display_name TEXT)
RETURNS VOID AS $$
DECLARE
  trimmed_name TEXT;
BEGIN
  -- Validate and trim input
  trimmed_name := TRIM(new_display_name);

  IF trimmed_name IS NULL OR LENGTH(trimmed_name) < 2 THEN
    RAISE EXCEPTION 'Display name must be at least 2 characters';
  END IF;

  IF LENGTH(trimmed_name) > 50 THEN
    RAISE EXCEPTION 'Display name must be 50 characters or less';
  END IF;

  -- Use INSERT ... ON CONFLICT to handle race condition with handle_new_user trigger
  -- If profile doesn't exist yet, create it; if it does, update display_name
  INSERT INTO public.user_profile (user_id, display_name, is_test)
  VALUES (
    auth.uid(),
    trimmed_name,
    false
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_display_name(TEXT) IS
  'Updates or creates the display name for the authenticated user.
   Uses UPSERT to handle race condition where profile may not exist yet.
   Validates that name is 2-50 characters after trimming.';
