-- Migration: Add email unsubscribe functionality
-- Adds unsubscribe tracking to user_profile and scheduled email tracking table

-- Add unsubscribe columns to user_profile
ALTER TABLE user_profile
ADD COLUMN email_unsubscribed_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN unsubscribe_token UUID DEFAULT gen_random_uuid() NOT NULL;

-- Create unique index for unsubscribe token lookups
CREATE UNIQUE INDEX idx_user_profile_unsubscribe_token ON user_profile(unsubscribe_token);

-- Create table to track scheduled email IDs for cancellation
CREATE TABLE scheduled_email (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resend_email_id TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient lookups by user and status
CREATE INDEX idx_scheduled_email_user_status ON scheduled_email(user_id, status);

-- Enable RLS on scheduled_email (service role only access)
ALTER TABLE scheduled_email ENABLE ROW LEVEL SECURITY;

-- RLS policy: Only service role can access scheduled_email table
-- No user-facing queries are needed for this table
CREATE POLICY "Service role can manage scheduled_email"
  ON scheduled_email FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comments for documentation
COMMENT ON COLUMN user_profile.email_unsubscribed_at IS 'Timestamp when user unsubscribed from emails, NULL if still subscribed';
COMMENT ON COLUMN user_profile.unsubscribe_token IS 'Unique token for secure unsubscribe links';
COMMENT ON TABLE scheduled_email IS 'Tracks Resend scheduled email IDs for cancellation when user unsubscribes';
