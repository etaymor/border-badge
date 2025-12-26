-- Migration: Social features database schema
-- Creates tables for follow relationships, blocking, and pending invites
-- Implements RLS policies with security definer functions for block checks

--------------------------------------------------------------------------------
-- ENUMS
--------------------------------------------------------------------------------

-- Invite type for pending invites
CREATE TYPE invite_type AS ENUM ('follow', 'trip_tag');

--------------------------------------------------------------------------------
-- TABLES
--------------------------------------------------------------------------------

-- User follow relationships (asymmetric, Instagram-style)
CREATE TABLE user_follow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(follower_id, following_id),
    CHECK (follower_id != following_id)  -- Prevent self-follow
);

-- Indexes for efficient follow queries (both directions)
CREATE INDEX idx_user_follow_follower ON user_follow(follower_id, created_at DESC);
CREATE INDEX idx_user_follow_following ON user_follow(following_id, created_at DESC);

COMMENT ON TABLE user_follow IS
    'Asymmetric follow relationships between users.
     follower_id follows following_id (one-way, like Instagram).
     Unique constraint prevents duplicate follows.
     CHECK constraint prevents self-follows.';

-- User block relationships
CREATE TABLE user_block (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)  -- Prevent self-block
);

-- Indexes for bidirectional block checks
CREATE INDEX idx_user_block_blocker ON user_block(blocker_id);
CREATE INDEX idx_user_block_blocked ON user_block(blocked_id);
CREATE INDEX idx_user_block_both ON user_block(blocker_id, blocked_id);  -- Fast bidirectional check

COMMENT ON TABLE user_block IS
    'Block relationships between users.
     blocker_id blocks blocked_id.
     Blocking is bidirectional for visibility (neither can see each other).
     When blocking, all follow relationships are removed (handled in app logic).';

-- Pending invites (email invites for non-users)
CREATE TABLE pending_invite (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    invite_type invite_type NOT NULL,
    trip_id UUID REFERENCES trip(id) ON DELETE CASCADE,  -- nullable, for trip_tag invites
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,  -- null until invite is accepted
    UNIQUE(inviter_id, email, COALESCE(trip_id, '00000000-0000-0000-0000-000000000000'))
);

-- Index for checking pending invites on signup
CREATE INDEX idx_pending_invite_email ON pending_invite(email) WHERE accepted_at IS NULL;
CREATE INDEX idx_pending_invite_inviter ON pending_invite(inviter_id, created_at DESC);

COMMENT ON TABLE pending_invite IS
    'Pending invites sent via email to non-users.
     Invite codes are HMAC-signed in application layer (not stored in DB).
     On signup, pending invites are processed to auto-create follows.
     UNIQUE constraint uses COALESCE to handle NULL trip_id (follow invites).';

--------------------------------------------------------------------------------
-- SECURITY DEFINER FUNCTIONS
--------------------------------------------------------------------------------

-- Helper function to check bidirectional blocks
-- Used in RLS policies to exclude blocked users from queries
CREATE OR REPLACE FUNCTION is_blocked_bidirectional(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_block
        WHERE (blocker_id = auth.uid() AND blocked_id = p_user_id)
           OR (blocker_id = p_user_id AND blocked_id = auth.uid())
    );
END;
$$;

COMMENT ON FUNCTION is_blocked_bidirectional(UUID) IS
    'Check if bidirectional block exists between current user and target user.
     Returns true if EITHER user has blocked the other.
     SECURITY DEFINER to allow RLS policies to check blocks without exposing block table.
     Used in trip visibility, feed queries, and user search.';

--------------------------------------------------------------------------------
-- ROW LEVEL SECURITY POLICIES
--------------------------------------------------------------------------------

-- Enable RLS on all social tables
ALTER TABLE user_follow ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_invite ENABLE ROW LEVEL SECURITY;

-- user_follow policies
CREATE POLICY "Users can view their own follows"
    ON user_follow FOR SELECT
    USING (follower_id = auth.uid() OR following_id = auth.uid());

CREATE POLICY "Users can create their own follows"
    ON user_follow FOR INSERT
    WITH CHECK (follower_id = auth.uid());

CREATE POLICY "Users can delete their own follows"
    ON user_follow FOR DELETE
    USING (follower_id = auth.uid());

-- user_block policies
CREATE POLICY "Users can view their own blocks"
    ON user_block FOR SELECT
    USING (blocker_id = auth.uid());

CREATE POLICY "Users can create their own blocks"
    ON user_block FOR INSERT
    WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Users can delete their own blocks"
    ON user_block FOR DELETE
    USING (blocker_id = auth.uid());

-- pending_invite policies
CREATE POLICY "Users can view invites they sent"
    ON pending_invite FOR SELECT
    USING (inviter_id = auth.uid());

CREATE POLICY "Users can create invites"
    ON pending_invite FOR INSERT
    WITH CHECK (inviter_id = auth.uid());

-- Service role can update accepted_at when processing signup
-- This policy allows backend to mark invites as accepted
CREATE POLICY "Service role can update invites"
    ON pending_invite FOR UPDATE
    USING (true)  -- Service role bypasses RLS, this is for documentation

WITH CHECK (true);

--------------------------------------------------------------------------------
-- PERFORMANCE INDEXES FOR FEED QUERIES
--------------------------------------------------------------------------------

-- Indexes to support on-demand feed queries (Phase 1.5)
-- These enable fast queries without materialized activity_feed table

-- Index for user_countries feed queries (country visited events)
CREATE INDEX idx_user_countries_user_created
    ON user_countries(user_id, created_at DESC)
    WHERE status = 'visited';

-- Index for entry feed queries (entry added events)
-- entry table already has created_at index, but add composite for joins
CREATE INDEX idx_entry_trip_created
    ON entry(trip_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- Index for trip user_id lookups (joining entries to user)
CREATE INDEX idx_trip_user_not_deleted
    ON trip(user_id, created_at DESC)
    WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_user_countries_user_created IS
    'Supports feed queries for country visited activities.
     Partial index only includes visited countries for efficiency.';

COMMENT ON INDEX idx_entry_trip_created IS
    'Supports feed queries for entry added activities.
     Partial index excludes soft-deleted entries.';

COMMENT ON INDEX idx_trip_user_not_deleted IS
    'Supports joining entries to users for feed queries.
     Partial index excludes soft-deleted trips.';
