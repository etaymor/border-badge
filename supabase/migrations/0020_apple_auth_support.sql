-- Migration: Update handle_new_user trigger to support Apple authentication
-- Apple users may have email or may hide it (private relay)
-- Apple provides full_name in raw_user_meta_data on first sign-in only

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profile (user_id, display_name, is_test)
  VALUES (
    NEW.id,
    COALESCE(
      -- First priority: display_name from user metadata (set during signup)
      NEW.raw_user_meta_data->>'display_name',
      -- Second priority: full_name from Apple Sign In
      NEW.raw_user_meta_data->>'full_name',
      -- Third priority: name from Apple Sign In
      NEW.raw_user_meta_data->>'name',
      -- Fourth priority: derive from phone or email
      CASE
        -- Phone auth: use "User" + last 4 digits
        WHEN NEW.phone IS NOT NULL THEN 'User ' || RIGHT(NEW.phone, 4)
        -- Email auth: use email prefix (skip Apple private relay emails)
        WHEN NEW.email IS NOT NULL AND NEW.email NOT LIKE '%privaterelay.appleid.com'
          THEN split_part(NEW.email, '@', 1)
        -- Fallback
        ELSE 'User'
      END
    ),
    -- Test user detection for email and phone patterns
    CASE
      WHEN NEW.email LIKE '%+test@%' THEN true
      WHEN NEW.phone LIKE '%555%' THEN true
      ELSE false
    END
  )
  ON CONFLICT (user_id) DO NOTHING;  -- Handle duplicate triggers gracefully
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;  -- Explicit search_path for security

-- Update comment to reflect Apple auth support
COMMENT ON FUNCTION handle_new_user() IS
  'Creates user_profile on signup. Supports phone, email, and Apple auth.
   Priority: display_name metadata > full_name/name (Apple) > phone digits > email prefix.
   Apple private relay emails (*@privaterelay.appleid.com) are ignored for display name derivation.
   Test users detected by +test pattern in email or 555 pattern in phone.';
