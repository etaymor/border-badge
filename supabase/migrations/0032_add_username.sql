-- Migration: Add username system to user_profile
-- Unique usernames for social features (asymmetric follow model)
-- Replaces display_name as primary user identifier

-- Add username column with case-insensitive unique constraint
ALTER TABLE user_profile ADD COLUMN username TEXT;

-- Create case-insensitive unique index on username
-- Uses LOWER() to ensure uniqueness regardless of case
CREATE UNIQUE INDEX idx_user_profile_username_lower ON user_profile(LOWER(username));

-- Add validation constraint: 3-30 chars, letters/numbers/underscores only
ALTER TABLE user_profile ADD CONSTRAINT username_format
  CHECK (username IS NULL OR (
    LENGTH(username) >= 3 AND
    LENGTH(username) <= 30 AND
    username ~ '^[a-zA-Z0-9_]+$'
  ));

-- Add updated_at column for tracking profile changes
ALTER TABLE user_profile ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Create function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on user_profile changes
CREATE TRIGGER update_user_profile_updated_at
  BEFORE UPDATE ON user_profile
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Helper function to generate username suggestions
-- Used when username is taken due to race condition
CREATE OR REPLACE FUNCTION generate_username_suggestions(base_username TEXT, count INT DEFAULT 3)
RETURNS TEXT[] AS $$
DECLARE
  suggestions TEXT[] := '{}';
  candidate TEXT;
  i INT := 1;
BEGIN
  -- Strategy 1: Append numbers (alice2, alice3, alice4)
  WHILE array_length(suggestions, 1) < count AND i <= 100 LOOP
    candidate := base_username || i::TEXT;
    IF NOT EXISTS (
      SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(candidate)
    ) THEN
      suggestions := array_append(suggestions, candidate);
    END IF;
    i := i + 1;
  END LOOP;

  -- Strategy 2: Append _travels suffix
  candidate := base_username || '_travels';
  IF NOT EXISTS (
    SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(candidate)
  ) AND array_length(suggestions, 1) < count THEN
    suggestions := array_append(suggestions, candidate);
  END IF;

  -- Strategy 3: Append random 3-digit number
  WHILE array_length(suggestions, 1) < count LOOP
    candidate := base_username || (100 + floor(random() * 900))::INT::TEXT;
    IF NOT EXISTS (
      SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(candidate)
    ) THEN
      suggestions := array_append(suggestions, candidate);
    END IF;
  END LOOP;

  RETURN suggestions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION generate_username_suggestions(TEXT, INT) IS
  'Generates available username suggestions when original is taken.
   Uses strategies: numbered suffix, _travels suffix, random 3-digit suffix.
   Called when username claim fails due to race condition.';

-- Note: Username is nullable to support gradual rollout
-- Existing users will be prompted to set username on next login
-- New users will set username during onboarding
