-- Migration: Fix handle_new_user trigger for user creation
-- Issue: tracking_preference column is NOT NULL but wasn't being provided by trigger
-- This caused "Database error creating new user" (500) when using Admin API

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_display_name TEXT;
  v_username TEXT;
  v_provided_username TEXT;
BEGIN
  -- Get display name from metadata or email
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    CASE
      WHEN NEW.phone IS NOT NULL THEN 'User ' || RIGHT(NEW.phone, 4)
      WHEN NEW.email IS NOT NULL THEN split_part(NEW.email, '@', 1)
      ELSE 'User'
    END
  );

  -- Check if username was provided during signup
  v_provided_username := NEW.raw_user_meta_data->>'username';

  -- If username provided and valid, use it; otherwise generate one
  IF v_provided_username IS NOT NULL
     AND LENGTH(v_provided_username) >= 3
     AND LENGTH(v_provided_username) <= 30
     AND v_provided_username ~ '^[a-zA-Z0-9_]+$'
     AND NOT EXISTS (SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(v_provided_username))
  THEN
    v_username := v_provided_username;
  ELSE
    v_username := generate_username_from_name(v_display_name);
  END IF;

  INSERT INTO public.user_profile (
    user_id,
    display_name,
    username,
    is_test,
    tracking_preference
  )
  VALUES (
    NEW.id,
    v_display_name,
    v_username,
    COALESCE(NEW.email LIKE '%+test@%', false),
    'full_atlas'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
