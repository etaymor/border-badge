-- Migration: Add flag to track welcome email scheduling
-- This flag provides idempotency for the welcome email endpoint,
-- preventing duplicate email sequences if the endpoint is called multiple times.

ALTER TABLE user_profile
ADD COLUMN welcome_emails_scheduled BOOLEAN NOT NULL DEFAULT false;

-- Add index for efficient idempotency lookups
CREATE INDEX idx_user_profile_welcome_emails ON user_profile(user_id) WHERE welcome_emails_scheduled = true;
