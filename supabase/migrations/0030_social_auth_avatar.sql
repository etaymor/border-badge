-- Migration: Extract avatar_url from social auth providers (Google, Apple)
-- Google provides 'picture' or 'avatar_url' in raw_user_meta_data
-- Apple does not provide avatar URLs

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profile (user_id, display_name, avatar_url, is_test)
  VALUES (
    NEW.id,
    COALESCE(
      -- First priority: display_name from user metadata (set during signup)
      NEW.raw_user_meta_data->>'display_name',
      -- Second priority: full_name from Apple Sign In
      NEW.raw_user_meta_data->>'full_name',
      -- Third priority: name from Apple/Google Sign In
      NEW.raw_user_meta_data->>'name',
      -- Fourth priority: derive from email
      CASE
        WHEN NEW.email IS NOT NULL AND NEW.email NOT LIKE '%privaterelay.appleid.com'
          THEN split_part(NEW.email, '@', 1)
        ELSE 'User'
      END
    ),
    -- Avatar URL from social providers
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',  -- Standard Supabase key
      NEW.raw_user_meta_data->>'picture'      -- Google uses 'picture'
    ),
    -- Test user detection for email patterns
    NEW.email LIKE '%+test@%'
  )
  ON CONFLICT (user_id) DO NOTHING;  -- Handle duplicate triggers gracefully
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;  -- Explicit search_path for security

COMMENT ON FUNCTION handle_new_user() IS
  'Creates user_profile on signup. Supports email, Apple, and Google auth.
   Priority for display_name: display_name metadata > full_name/name (Apple) > email prefix.
   Avatar URL extracted from avatar_url or picture (Google) in raw_user_meta_data.
   Apple private relay emails (*@privaterelay.appleid.com) are ignored for display name derivation.
   Test users detected by +test pattern in email.';
