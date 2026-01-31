-- Add subscription tracking to user_profile
-- Tracks subscription status, usage limits, and webhook idempotency

-- Add subscription columns
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT,
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revenuecat_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS usage_share_extension_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_photo_import_count INTEGER DEFAULT 0,
  -- Webhook ordering fields (for idempotency and out-of-order handling)
  ADD COLUMN IF NOT EXISTS last_webhook_timestamp_ms BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_webhook_event_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_last_verified_at TIMESTAMPTZ;

-- Add constraint for valid subscription statuses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_status'
  ) THEN
    ALTER TABLE user_profile
      ADD CONSTRAINT chk_subscription_status
      CHECK (subscription_status IN ('free', 'trial', 'premium', 'expired'));
  END IF;
END $$;

-- Add constraint for valid subscription plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_plan'
  ) THEN
    ALTER TABLE user_profile
      ADD CONSTRAINT chk_subscription_plan
      CHECK (subscription_plan IN ('weekly', 'monthly', 'yearly') OR subscription_plan IS NULL);
  END IF;
END $$;

-- Index for subscription queries
CREATE INDEX IF NOT EXISTS idx_user_profile_subscription
  ON user_profile(subscription_status);

-- Index for RevenueCat customer lookups
CREATE INDEX IF NOT EXISTS idx_user_profile_revenuecat
  ON user_profile(revenuecat_customer_id);

-- RLS policy update not needed - existing user_profile policy already allows
-- users to read/update their own profile
