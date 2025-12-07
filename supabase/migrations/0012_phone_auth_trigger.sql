-- Migration: Update handle_new_user trigger to support phone authentication
-- Phone users have NEW.phone set instead of NEW.email
-- This change maintains backward compatibility with email auth

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profile (user_id, display_name, is_test)
  VALUES (
    NEW.id,
    COALESCE(
      -- First priority: display_name from user metadata (set during signup)
      NEW.raw_user_meta_data->>'display_name',
      -- Second priority: derive from phone or email
      CASE
        -- Phone auth: use "User" + last 4 digits
        WHEN NEW.phone IS NOT NULL THEN 'User ' || RIGHT(NEW.phone, 4)
        -- Email auth: use email prefix (existing behavior)
        WHEN NEW.email IS NOT NULL THEN split_part(NEW.email, '@', 1)
        -- Fallback
        ELSE 'User'
      END
    ),
    -- Test user detection for both email and phone patterns
    CASE
      WHEN NEW.email LIKE '%+test@%' THEN true
      WHEN NEW.phone LIKE '%555%' THEN true  -- Common test phone pattern
      ELSE false
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment explaining the function
COMMENT ON FUNCTION handle_new_user() IS
  'Creates user_profile on signup. Supports both email and phone auth.
   For phone users without display_name metadata, defaults to "User XXXX" (last 4 digits).
   For email users without display_name metadata, defaults to email prefix.
   Test users detected by +test pattern in email or 555 pattern in phone.';
