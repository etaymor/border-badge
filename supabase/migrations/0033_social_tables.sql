-- Migration: Create social tables for Friends & Social feature
-- Part of Phase 1.2: Database Schema & Migrations
--
-- This migration creates:
-- 1. user_follow - Follow relationships between users
-- 2. user_block - Block relationships between users
-- 3. pending_invite - Email invites for non-users
-- 4. RLS policies for all social tables
-- 5. Helper functions for block checking
-- 6. Push token column with column-level security

--------------------------------------------------------------------------------
-- ENUMS
--------------------------------------------------------------------------------

-- Invite type enum
CREATE TYPE invite_type AS ENUM ('follow', 'trip_tag');

--------------------------------------------------------------------------------
-- USER_FOLLOW TABLE
--------------------------------------------------------------------------------

CREATE TABLE user_follow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique constraint to prevent duplicate follows
  UNIQUE(follower_id, following_id),

  -- Prevent self-follow
  CHECK (follower_id != following_id)
);

-- Index for finding who a user follows (ordered by most recent)
CREATE INDEX idx_user_follow_follower ON user_follow(follower_id, created_at DESC);

-- Index for finding who follows a user (ordered by most recent)
CREATE INDEX idx_user_follow_following ON user_follow(following_id, created_at DESC);

-- Enable RLS
ALTER TABLE user_follow ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_follow
CREATE POLICY "Users can view follow relationships involving them"
  ON user_follow FOR SELECT
  USING (
    follower_id = auth.uid() OR following_id = auth.uid()
  );

CREATE POLICY "Users can create follows where they are the follower"
  ON user_follow FOR INSERT
  WITH CHECK (follower_id = auth.uid());

CREATE POLICY "Users can delete follows where they are the follower"
  ON user_follow FOR DELETE
  USING (follower_id = auth.uid());

--------------------------------------------------------------------------------
-- USER_BLOCK TABLE
--------------------------------------------------------------------------------

CREATE TABLE user_block (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique constraint to prevent duplicate blocks
  UNIQUE(blocker_id, blocked_id),

  -- Prevent self-block
  CHECK (blocker_id != blocked_id)
);

-- Index for finding who a user has blocked
CREATE INDEX idx_user_block_blocker ON user_block(blocker_id);

-- Index for finding who has blocked a user
CREATE INDEX idx_user_block_blocked ON user_block(blocked_id);

-- Composite index for fast bidirectional block checks
CREATE INDEX idx_user_block_both ON user_block(blocker_id, blocked_id);

-- Enable RLS
ALTER TABLE user_block ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_block
CREATE POLICY "Users can view their own blocks"
  ON user_block FOR SELECT
  USING (blocker_id = auth.uid());

CREATE POLICY "Users can create blocks"
  ON user_block FOR INSERT
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Users can delete their own blocks"
  ON user_block FOR DELETE
  USING (blocker_id = auth.uid());

--------------------------------------------------------------------------------
-- PENDING_INVITE TABLE
--------------------------------------------------------------------------------

CREATE TABLE pending_invite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invite_type invite_type NOT NULL,
  trip_id UUID REFERENCES trip(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,

  -- Unique constraint on inviter + email + type (with COALESCE for nullable trip_id)
  UNIQUE(inviter_id, email, invite_type, COALESCE(trip_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- Index for looking up pending invites by email (for signup processing)
CREATE INDEX idx_pending_invite_email ON pending_invite(LOWER(email)) WHERE accepted_at IS NULL;

-- Index for looking up invites by inviter
CREATE INDEX idx_pending_invite_inviter ON pending_invite(inviter_id, created_at DESC);

-- Enable RLS
ALTER TABLE pending_invite ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pending_invite
CREATE POLICY "Users can view their own invites"
  ON pending_invite FOR SELECT
  USING (inviter_id = auth.uid());

CREATE POLICY "Users can create invites"
  ON pending_invite FOR INSERT
  WITH CHECK (inviter_id = auth.uid());

CREATE POLICY "Users can update their own invites"
  ON pending_invite FOR UPDATE
  USING (inviter_id = auth.uid());

--------------------------------------------------------------------------------
-- PUSH TOKEN COLUMN WITH SECURITY
--------------------------------------------------------------------------------

-- Add push_token column to user_profile
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Index for push token lookups
CREATE INDEX IF NOT EXISTS idx_user_profile_push_token ON user_profile(push_token)
  WHERE push_token IS NOT NULL;

--------------------------------------------------------------------------------
-- HELPER FUNCTIONS
--------------------------------------------------------------------------------

-- Function to check if there's a bidirectional block between two users
-- Used in RLS policies and API queries
CREATE OR REPLACE FUNCTION is_blocked_bidirectional(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_block
    WHERE (blocker_id = auth.uid() AND blocked_id = p_user_id)
       OR (blocker_id = p_user_id AND blocked_id = auth.uid())
  );
END;
$$;

-- Function to get country counts for multiple users
-- Used for efficient batch queries in user search/lists
CREATE OR REPLACE FUNCTION get_user_country_counts(user_ids UUID[])
RETURNS TABLE (
  user_id UUID,
  count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT uc.user_id, COUNT(DISTINCT uc.country_id)::BIGINT as count
  FROM user_countries uc
  WHERE uc.user_id = ANY(user_ids)
    AND uc.status = 'visited'
  GROUP BY uc.user_id;
END;
$$;

--------------------------------------------------------------------------------
-- PERFORMANCE INDEXES FOR FEED QUERIES
--------------------------------------------------------------------------------

-- Index for efficient feed queries - user_countries ordered by created_at
CREATE INDEX IF NOT EXISTS idx_user_countries_user_created
  ON user_countries(user_id, created_at DESC)
  WHERE status = 'visited';

-- Index for efficient feed queries - entries ordered by created_at
CREATE INDEX IF NOT EXISTS idx_entry_created
  ON entry(created_at DESC)
  WHERE deleted_at IS NULL;

-- Index for trip queries by user
CREATE INDEX IF NOT EXISTS idx_trip_user_id
  ON trip(user_id)
  WHERE deleted_at IS NULL;
