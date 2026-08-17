-- Migration: Add RLS policies for social feed tables
-- Fix for 0055_social_feed_inbox.sql which enabled RLS but defined no policies

-- Users can view their own activities (where they are the actor)
CREATE POLICY "Users can view own activities"
  ON social_activity_event FOR SELECT
  USING (actor_id = auth.uid());

-- Users can view their own inbox (where they are the recipient)
CREATE POLICY "Users can view own inbox"
  ON social_feed_inbox FOR SELECT
  USING (recipient_id = auth.uid());
