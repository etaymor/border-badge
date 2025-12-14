-- Add tracking_preference column to user_profile table
-- This controls which countries are displayed and counted in the user's passport
-- Valid values: 'classic', 'un_complete', 'explorer_plus', 'full_atlas'

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS tracking_preference TEXT NOT NULL DEFAULT 'full_atlas';

-- Add check constraint to ensure valid values
ALTER TABLE user_profile
  ADD CONSTRAINT valid_tracking_preference
  CHECK (tracking_preference IN ('classic', 'un_complete', 'explorer_plus', 'full_atlas'));
