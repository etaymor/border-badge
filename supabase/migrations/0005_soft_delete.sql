-- Phase 5: Soft delete support for undo functionality
-- Adds deleted_at columns to key tables and updates queries to filter deleted rows

--------------------------------------------------------------------------------
-- ADD DELETED_AT COLUMNS
--------------------------------------------------------------------------------

-- Trip table
ALTER TABLE trip ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX idx_trip_deleted ON trip(deleted_at) WHERE deleted_at IS NOT NULL;

-- Entry table
ALTER TABLE entry ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX idx_entry_deleted ON entry(deleted_at) WHERE deleted_at IS NOT NULL;

-- List table
ALTER TABLE list ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX idx_list_deleted ON list(deleted_at) WHERE deleted_at IS NOT NULL;

--------------------------------------------------------------------------------
-- UPDATE RLS POLICIES FOR SOFT DELETE SUPPORT
--------------------------------------------------------------------------------

-- Note: We need to update trip and entry policies to filter soft-deleted records.
-- Drop policies from 0002 and recreate with deleted_at IS NULL checks.

--------------------------------------------------------------------------------
-- TRIP POLICIES - Update for soft delete
--------------------------------------------------------------------------------

-- Drop existing trip policies from 0002
DROP POLICY IF EXISTS "Trip owner has full access" ON trip;
DROP POLICY IF EXISTS "Approved tagged users can view trip" ON trip;

-- Recreate trip policies with soft-delete filter
-- Owner can view their own non-deleted trips
CREATE POLICY "Trip owner can view own trips"
  ON trip FOR SELECT
  USING (user_id = auth.uid() AND deleted_at IS NULL);

-- Owner can create trips
CREATE POLICY "Trip owner can create trips"
  ON trip FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Owner can update their trips (including deleted ones for restore)
CREATE POLICY "Trip owner can update own trips"
  ON trip FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Owner can delete their trips
CREATE POLICY "Trip owner can delete own trips"
  ON trip FOR DELETE
  USING (user_id = auth.uid());

-- Approved tagged users can view non-deleted trips they're tagged in
-- Uses SECURITY DEFINER function from 0002 to avoid RLS recursion
CREATE POLICY "Approved tagged users can view trip"
  ON trip FOR SELECT
  USING (deleted_at IS NULL AND has_approved_trip_tag(id));

--------------------------------------------------------------------------------
-- ENTRY POLICIES - Update for soft delete
--------------------------------------------------------------------------------

-- Drop existing entry policies from 0002
DROP POLICY IF EXISTS "Trip participants can view entries" ON entry;
DROP POLICY IF EXISTS "Trip owner can insert entries" ON entry;
DROP POLICY IF EXISTS "Trip owner can update entries" ON entry;
DROP POLICY IF EXISTS "Trip owner can delete entries" ON entry;

-- Recreate entry policies with soft-delete filter
CREATE POLICY "Trip participants can view entries"
  ON entry FOR SELECT
  USING (
    deleted_at IS NULL
    AND is_trip_participant(trip_id)
  );

CREATE POLICY "Trip owner can insert entries"
  ON entry FOR INSERT
  WITH CHECK (is_trip_owner(trip_id));

-- UPDATE allows updating deleted entries (for restore functionality)
CREATE POLICY "Trip owner can update entries"
  ON entry FOR UPDATE
  USING (is_trip_owner(trip_id))
  WITH CHECK (is_trip_owner(trip_id));

CREATE POLICY "Trip owner can delete entries"
  ON entry FOR DELETE
  USING (is_trip_owner(trip_id));

--------------------------------------------------------------------------------
-- UPDATE HELPER FUNCTIONS FOR SOFT DELETE
--------------------------------------------------------------------------------

-- Update is_trip_participant to filter soft-deleted trips
CREATE OR REPLACE FUNCTION is_trip_participant(p_trip_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM trip
    WHERE trip.id = p_trip_id
      AND trip.deleted_at IS NULL
      AND (
        trip.user_id = auth.uid()
        OR has_approved_trip_tag(trip.id)
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update is_trip_owner to filter soft-deleted trips (for non-restore operations)
-- Note: The base is_trip_owner doesn't filter deleted because UPDATE needs to work
-- on deleted trips for restore. The policies themselves handle this.

--------------------------------------------------------------------------------
-- List policies (from 0004_lists.sql)
DROP POLICY IF EXISTS "Owner can manage own lists" ON list;
DROP POLICY IF EXISTS "Anyone can view public lists" ON list;

-- Recreate list policies with soft-delete filter
-- Split into separate policies to allow restore functionality
CREATE POLICY "Owner can view own lists"
  ON list
  FOR SELECT
  USING (owner_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Owner can create lists"
  ON list
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Note: UPDATE allows updating deleted lists (for restore functionality)
CREATE POLICY "Owner can update own lists"
  ON list
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner can delete own lists"
  ON list
  FOR DELETE
  USING (owner_id = auth.uid());

CREATE POLICY "Anyone can view public lists"
  ON list
  FOR SELECT
  USING (is_public = true AND deleted_at IS NULL);

--------------------------------------------------------------------------------
-- HELPER FUNCTION FOR SOFT DELETE
--------------------------------------------------------------------------------

-- Function to set deleted_at timestamp
CREATE OR REPLACE FUNCTION soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  NEW.deleted_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- CLEANUP FUNCTION (Optional: for scheduled purging of old soft-deleted records)
--------------------------------------------------------------------------------

-- Permanently delete records soft-deleted more than 30 days ago
-- This can be run as a scheduled job in Supabase
CREATE OR REPLACE FUNCTION purge_soft_deleted(days_old INT DEFAULT 30)
RETURNS TABLE(
  trips_deleted BIGINT,
  entries_deleted BIGINT,
  lists_deleted BIGINT
) AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  trips_count BIGINT;
  entries_count BIGINT;
  lists_count BIGINT;
BEGIN
  cutoff := now() - (days_old || ' days')::INTERVAL;

  -- Delete old soft-deleted trips (cascades to entries via FK)
  WITH deleted AS (
    DELETE FROM trip WHERE deleted_at < cutoff RETURNING 1
  )
  SELECT COUNT(*) INTO trips_count FROM deleted;

  -- Delete orphaned soft-deleted entries (those whose trips were not soft-deleted)
  WITH deleted AS (
    DELETE FROM entry WHERE deleted_at < cutoff RETURNING 1
  )
  SELECT COUNT(*) INTO entries_count FROM deleted;

  -- Delete old soft-deleted lists
  WITH deleted AS (
    DELETE FROM list WHERE deleted_at < cutoff RETURNING 1
  )
  SELECT COUNT(*) INTO lists_count FROM deleted;

  RETURN QUERY SELECT trips_count, entries_count, lists_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
