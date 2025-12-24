-- Migration: Add flag to identify countries added during onboarding
-- These countries should be excluded from milestone tag calculations
-- since their order doesn't represent actual travel chronology

ALTER TABLE user_countries
ADD COLUMN added_during_onboarding BOOLEAN NOT NULL DEFAULT false;

-- Add index for efficient filtering when calculating milestones
CREATE INDEX idx_user_countries_onboarding ON user_countries(user_id, added_during_onboarding);
