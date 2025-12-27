-- Migration: Add status column to pending_invite
-- This column was expected by the API but missing from the original schema

-- Create enum for invite status
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'expired', 'cancelled');

-- Add status column with default 'pending'
ALTER TABLE pending_invite
ADD COLUMN status invite_status NOT NULL DEFAULT 'pending';

-- Update existing rows: if accepted_at is set, mark as accepted
UPDATE pending_invite
SET status = 'accepted'
WHERE accepted_at IS NOT NULL;

-- Index for querying pending invites by status
CREATE INDEX idx_pending_invite_status
  ON pending_invite(status)
  WHERE status = 'pending';
