-- Migration: Add function to update user display name
-- Combines auth metadata and profile table updates into a single atomic operation

CREATE OR REPLACE FUNCTION update_display_name(new_display_name TEXT)
RETURNS VOID AS $$
BEGIN
  -- Update the user_profile table
  UPDATE public.user_profile
  SET display_name = new_display_name
  WHERE user_id = auth.uid();

  -- Verify the update succeeded (user_profile must exist)
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found for user %', auth.uid();
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_display_name(TEXT) TO authenticated;

COMMENT ON FUNCTION update_display_name(TEXT) IS
  'Updates the display name for the authenticated user in the user_profile table.
   Called from mobile app after OTP verification as a fallback when the trigger
   did not receive the display name via signInWithOtp metadata.';
