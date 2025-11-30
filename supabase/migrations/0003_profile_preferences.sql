-- Migration: Add profile preferences for onboarding data
-- Adds home country, travel motives, and persona tags to user_profile

-- Add new columns to user_profile table
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS home_country_code TEXT,
  ADD COLUMN IF NOT EXISTS travel_motives TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS persona_tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create or replace function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for user_profile (drop first if exists to avoid conflicts)
DROP TRIGGER IF EXISTS update_user_profile_updated_at ON user_profile;
CREATE TRIGGER update_user_profile_updated_at
  BEFORE UPDATE ON user_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add index for home_country_code for potential future queries
CREATE INDEX IF NOT EXISTS idx_user_profile_home_country ON user_profile(home_country_code);

-- Comment on columns for documentation
COMMENT ON COLUMN user_profile.home_country_code IS 'ISO 2-letter country code where user currently lives';
COMMENT ON COLUMN user_profile.travel_motives IS 'Array of travel motivation tags (e.g., Adventure, Food, Culture)';
COMMENT ON COLUMN user_profile.persona_tags IS 'Array of traveler persona tags (e.g., Explorer, Foodie)';
COMMENT ON COLUMN user_profile.updated_at IS 'Timestamp of last profile update';
