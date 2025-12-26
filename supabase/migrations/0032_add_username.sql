-- Migration: Add username column to user_profile
-- Part of Phase 1.1: Username System for Friends & Social feature
--
-- This migration:
-- 1. Adds username column with case-insensitive unique index
-- 2. Adds validation constraint (3-30 chars, letters/numbers/underscores only)
-- 3. Updates the handle_new_user trigger to generate default username
-- 4. Creates helper function for username availability check

--------------------------------------------------------------------------------
-- ADD USERNAME COLUMN
--------------------------------------------------------------------------------

-- Add username column (nullable initially for existing users)
ALTER TABLE user_profile ADD COLUMN username TEXT;

-- Create case-insensitive unique index
CREATE UNIQUE INDEX idx_user_profile_username_lower
ON user_profile(LOWER(username))
WHERE username IS NOT NULL;

-- Add validation constraint: 3-30 chars, letters/numbers/underscores only
ALTER TABLE user_profile ADD CONSTRAINT chk_username_format
CHECK (
  username IS NULL OR (
    LENGTH(username) >= 3 AND
    LENGTH(username) <= 30 AND
    username ~ '^[a-zA-Z0-9_]+$'
  )
);

--------------------------------------------------------------------------------
-- HELPER FUNCTIONS
--------------------------------------------------------------------------------

-- Function to generate a unique username from display_name
-- Used for migrating existing users and as default for new signups
CREATE OR REPLACE FUNCTION generate_username_from_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_base_username TEXT;
  v_username TEXT;
  v_counter INTEGER := 0;
BEGIN
  -- Sanitize: lowercase, replace spaces/special chars with underscore
  v_base_username := LOWER(REGEXP_REPLACE(p_name, '[^a-zA-Z0-9_]', '_', 'g'));

  -- Remove consecutive underscores
  v_base_username := REGEXP_REPLACE(v_base_username, '_+', '_', 'g');

  -- Remove leading/trailing underscores
  v_base_username := TRIM(BOTH '_' FROM v_base_username);

  -- Ensure minimum length (pad with 'user' if needed)
  IF LENGTH(v_base_username) < 3 THEN
    v_base_username := 'user_' || v_base_username;
  END IF;

  -- Truncate to leave room for counter (max 26 chars to allow 4 digit suffix)
  v_base_username := LEFT(v_base_username, 26);

  -- Try base username first
  v_username := v_base_username;

  -- If taken, append incrementing numbers
  WHILE EXISTS (SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(v_username)) LOOP
    v_counter := v_counter + 1;
    v_username := v_base_username || '_' || v_counter::TEXT;
  END LOOP;

  RETURN v_username;
END;
$$;

-- Function to check username availability
CREATE OR REPLACE FUNCTION check_username_availability(p_username TEXT)
RETURNS TABLE (
  available BOOLEAN,
  reason TEXT,
  suggestions TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_suggestions TEXT[] := ARRAY[]::TEXT[];
  v_base TEXT;
  v_i INTEGER;
BEGIN
  -- Validate format first
  IF p_username IS NULL OR LENGTH(p_username) < 3 THEN
    RETURN QUERY SELECT false, 'Username must be at least 3 characters'::TEXT, v_suggestions;
    RETURN;
  END IF;

  IF LENGTH(p_username) > 30 THEN
    RETURN QUERY SELECT false, 'Username must be 30 characters or less'::TEXT, v_suggestions;
    RETURN;
  END IF;

  IF NOT (p_username ~ '^[a-zA-Z0-9_]+$') THEN
    RETURN QUERY SELECT false, 'Username can only contain letters, numbers, and underscores'::TEXT, v_suggestions;
    RETURN;
  END IF;

  -- Check availability
  IF NOT EXISTS (SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(p_username)) THEN
    RETURN QUERY SELECT true, NULL::TEXT, v_suggestions;
    RETURN;
  END IF;

  -- Username is taken - generate suggestions
  v_base := LOWER(p_username);
  FOR v_i IN 1..5 LOOP
    DECLARE
      v_suggestion TEXT;
    BEGIN
      v_suggestion := v_base || '_' || v_i::TEXT;
      IF NOT EXISTS (SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(v_suggestion)) THEN
        v_suggestions := v_suggestions || v_suggestion;
      END IF;
    END;
  END LOOP;

  -- Also try with random suffix
  FOR v_i IN 1..3 LOOP
    DECLARE
      v_suggestion TEXT;
      v_rand INTEGER;
    BEGIN
      v_rand := floor(random() * 9000 + 1000)::INTEGER; -- 4-digit number
      v_suggestion := v_base || v_rand::TEXT;
      IF NOT EXISTS (SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(v_suggestion)) THEN
        v_suggestions := v_suggestions || v_suggestion;
      END IF;
    END;
  END LOOP;

  -- Return first 3 suggestions
  RETURN QUERY SELECT false, 'Username is already taken'::TEXT, v_suggestions[1:3];
END;
$$;

--------------------------------------------------------------------------------
-- UPDATE TRIGGER FOR NEW USERS
--------------------------------------------------------------------------------

-- Update handle_new_user to also generate username
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
    split_part(NEW.email, '@', 1)
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
    -- Generate unique username from display name
    v_username := generate_username_from_name(v_display_name);
  END IF;

  INSERT INTO public.user_profile (user_id, display_name, username, is_test)
  VALUES (
    NEW.id,
    v_display_name,
    v_username,
    NEW.email LIKE '%+test@%'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

--------------------------------------------------------------------------------
-- MIGRATE EXISTING USERS
--------------------------------------------------------------------------------

-- Generate usernames for existing users who don't have one
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, display_name FROM user_profile WHERE username IS NULL
  LOOP
    UPDATE user_profile
    SET username = generate_username_from_name(r.display_name)
    WHERE id = r.id;
  END LOOP;
END $$;

-- After migration, make username NOT NULL
ALTER TABLE user_profile ALTER COLUMN username SET NOT NULL;
