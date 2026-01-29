-- Fix subscription_plan constraint to use 'annual' instead of 'yearly'
-- The constraint was created with 'yearly' but the entire system uses 'annual':
--   - RevenueCat product IDs use 'annual'
--   - Backend schemas define SubscriptionPlan = Literal["weekly", "monthly", "annual"]
--   - Mobile stores use 'weekly' | 'monthly' | 'annual'
--   - Webhook handler sets subscription_plan = "annual"
-- This mismatch causes webhook updates to fail silently.

ALTER TABLE user_profile DROP CONSTRAINT IF EXISTS chk_subscription_plan;

ALTER TABLE user_profile
  ADD CONSTRAINT chk_subscription_plan
  CHECK (subscription_plan IN ('weekly', 'monthly', 'annual') OR subscription_plan IS NULL);
