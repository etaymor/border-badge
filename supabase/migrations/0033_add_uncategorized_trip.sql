-- Migration: Add support for uncategorized/system trips
-- This enables a "Saved Places" holding area for entries when no matching trip exists

--------------------------------------------------------------------------------
-- SCHEMA CHANGES
--------------------------------------------------------------------------------

-- Make country_id nullable so system trips don't need a country
ALTER TABLE trip ALTER COLUMN country_id DROP NOT NULL;

-- Add is_system flag to distinguish system trips from user-created trips
ALTER TABLE trip ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

-- Unique constraint: Only one active system trip per user
-- Uses partial index to exclude soft-deleted trips
CREATE UNIQUE INDEX idx_trip_unique_system_per_user
  ON trip(user_id)
  WHERE is_system = true AND deleted_at IS NULL;

-- Index for filtering system trips
CREATE INDEX idx_trip_is_system ON trip(is_system) WHERE is_system = true;

--------------------------------------------------------------------------------
-- RLS POLICY UPDATES
--------------------------------------------------------------------------------

-- Drop and recreate trip policies to handle nullable country_id

-- Policy: Users can view their own trips
DROP POLICY IF EXISTS "Users can view own trips" ON trip;
CREATE POLICY "Users can view own trips" ON trip
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND deleted_at IS NULL
  );

-- Policy: Users can view trips they're approved on
DROP POLICY IF EXISTS "Users can view trips they are tagged on" ON trip;
CREATE POLICY "Users can view trips they are tagged on" ON trip
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM trip_tags
      WHERE trip_tags.trip_id = trip.id
        AND trip_tags.tagged_user_id = auth.uid()
        AND trip_tags.status = 'approved'
    )
  );

-- Policy: Users can create trips
DROP POLICY IF EXISTS "Users can create own trips" ON trip;
CREATE POLICY "Users can create own trips" ON trip
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own trips (but not system or deleted trips)
DROP POLICY IF EXISTS "Users can update own trips" ON trip;
CREATE POLICY "Users can update own trips" ON trip
  FOR UPDATE
  USING (user_id = auth.uid() AND deleted_at IS NULL AND is_system = false)
  WITH CHECK (user_id = auth.uid() AND deleted_at IS NULL AND is_system = false);

-- Policy: Users can soft-delete their own trips (but not system trips)
-- Note: Actual deletion prevention for system trips handled in application layer
DROP POLICY IF EXISTS "Users can delete own trips" ON trip;
CREATE POLICY "Users can delete own trips" ON trip
  FOR DELETE
  USING (user_id = auth.uid() AND is_system = false);

--------------------------------------------------------------------------------
-- HELPER FUNCTION: Get or create uncategorized trip
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_or_create_uncategorized_trip()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  country_id UUID,
  name TEXT,
  cover_image_url TEXT,
  date_range DATERANGE,
  is_system BOOLEAN,
  created_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  entry_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_trip_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Attempt to insert a new system trip; if one already exists for this user,
  -- the partial unique index (user_id WHERE is_system = true AND deleted_at IS NULL)
  -- will cause a conflict and DO NOTHING will skip the insert.
  -- Use the partial unique index for conflict detection.
  -- The index idx_trip_unique_system_per_user covers (user_id) WHERE is_system = true AND deleted_at IS NULL
  INSERT INTO trip (user_id, country_id, name, is_system)
  VALUES (v_user_id, NULL, 'Saved Places', true)
  ON CONFLICT (user_id) WHERE (is_system = true AND deleted_at IS NULL)
  DO NOTHING;

  -- Now select the trip (either just inserted or already existing)
  SELECT t.id INTO v_trip_id
  FROM trip t
  WHERE t.user_id = v_user_id
    AND t.is_system = true
    AND t.deleted_at IS NULL;

  -- Return trip with entry count
  RETURN QUERY
  SELECT
    t.id,
    t.user_id,
    t.country_id,
    t.name,
    t.cover_image_url,
    t.date_range,
    t.is_system,
    t.created_at,
    t.deleted_at,
    COUNT(e.id)::BIGINT AS entry_count
  FROM trip t
  LEFT JOIN entry e ON e.trip_id = t.id AND e.deleted_at IS NULL
  WHERE t.id = v_trip_id
  GROUP BY t.id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_or_create_uncategorized_trip() TO authenticated;

--------------------------------------------------------------------------------
-- HELPER FUNCTION: Move entry to different trip
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION move_entry_to_trip(
  p_entry_id UUID,
  p_target_trip_id UUID
)
RETURNS TABLE (
  entry_row JSONB,
  place_row JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_source_trip_user_id UUID;
  v_target_trip_user_id UUID;
  v_entry RECORD;
  v_place RECORD;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify entry exists and belongs to a trip owned by the user
  SELECT t.user_id INTO v_source_trip_user_id
  FROM entry e
  JOIN trip t ON t.id = e.trip_id
  WHERE e.id = p_entry_id
    AND e.deleted_at IS NULL
    AND t.deleted_at IS NULL;

  IF v_source_trip_user_id IS NULL THEN
    RAISE EXCEPTION 'Entry not found';
  END IF;

  IF v_source_trip_user_id != v_user_id THEN
    RAISE EXCEPTION 'Not authorized to move this entry';
  END IF;

  -- Verify target trip exists and belongs to the user
  SELECT t.user_id INTO v_target_trip_user_id
  FROM trip t
  WHERE t.id = p_target_trip_id
    AND t.deleted_at IS NULL;

  IF v_target_trip_user_id IS NULL THEN
    RAISE EXCEPTION 'Target trip not found';
  END IF;

  IF v_target_trip_user_id != v_user_id THEN
    RAISE EXCEPTION 'Not authorized to move to this trip';
  END IF;

  -- Check for duplicate place in target trip
  IF EXISTS (
    SELECT 1
    FROM entry e1
    JOIN place p1 ON p1.entry_id = e1.id
    JOIN entry e2 ON e2.trip_id = p_target_trip_id AND e2.deleted_at IS NULL
    JOIN place p2 ON p2.entry_id = e2.id
    WHERE e1.id = p_entry_id
      AND p1.google_place_id IS NOT NULL
      AND p1.google_place_id = p2.google_place_id
  ) THEN
    RAISE EXCEPTION 'This place already exists in the target trip';
  END IF;

  -- Move the entry
  UPDATE entry
  SET trip_id = p_target_trip_id
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  -- Get place if exists
  SELECT * INTO v_place FROM place WHERE entry_id = p_entry_id;

  -- Return results as JSONB
  RETURN QUERY SELECT
    to_jsonb(v_entry) AS entry_row,
    CASE WHEN v_place IS NOT NULL THEN to_jsonb(v_place) ELSE NULL END AS place_row;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION move_entry_to_trip(UUID, UUID) TO authenticated;

--------------------------------------------------------------------------------
-- HELPER FUNCTION: Bulk move entries to trip
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bulk_move_entries_to_trip(
  p_entry_ids UUID[],
  p_target_trip_id UUID
)
RETURNS TABLE (
  moved_count INT,
  entries JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_target_trip_user_id UUID;
  v_moved_entries JSONB;
  v_count INT;
  v_found INT;
  v_requested INT;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify target trip exists and belongs to the user
  SELECT t.user_id INTO v_target_trip_user_id
  FROM trip t
  WHERE t.id = p_target_trip_id
    AND t.deleted_at IS NULL;

  IF v_target_trip_user_id IS NULL THEN
    RAISE EXCEPTION 'Target trip not found';
  END IF;

  IF v_target_trip_user_id != v_user_id THEN
    RAISE EXCEPTION 'Not authorized to move to this trip';
  END IF;

  -- Explicit existence and ownership check: count matching entries
  -- This enforces all-or-nothing semantics - all entry IDs must exist,
  -- belong to trips owned by the user, and not be soft-deleted
  v_requested := array_length(p_entry_ids, 1);
  IF v_requested IS NULL OR v_requested = 0 THEN
    RAISE EXCEPTION 'No entries specified';
  END IF;

  SELECT COUNT(*)::INT INTO v_found
  FROM entry e
  WHERE e.id = ANY(p_entry_ids)
    AND e.trip_id IN (SELECT id FROM trip WHERE user_id = v_user_id)
    AND e.deleted_at IS NULL;

  IF v_found != v_requested THEN
    RAISE EXCEPTION 'One or more entries not found or not authorized (found % of % requested)', v_found, v_requested;
  END IF;

  -- Check for duplicate places in target trip
  IF EXISTS (
    SELECT 1
    FROM unnest(p_entry_ids) AS entry_id
    JOIN entry e1 ON e1.id = entry_id
    JOIN place p1 ON p1.entry_id = e1.id
    JOIN entry e2 ON e2.trip_id = p_target_trip_id AND e2.deleted_at IS NULL
    JOIN place p2 ON p2.entry_id = e2.id
    WHERE p1.google_place_id IS NOT NULL
      AND p1.google_place_id = p2.google_place_id
  ) THEN
    RAISE EXCEPTION 'One or more places already exist in the target trip';
  END IF;

  -- Move all entries in a single update
  WITH moved AS (
    UPDATE entry
    SET trip_id = p_target_trip_id
    WHERE id = ANY(p_entry_ids)
    RETURNING *
  )
  SELECT COUNT(*)::INT, jsonb_agg(to_jsonb(moved))
  INTO v_count, v_moved_entries
  FROM moved;

  RETURN QUERY SELECT v_count, COALESCE(v_moved_entries, '[]'::JSONB);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION bulk_move_entries_to_trip(UUID[], UUID) TO authenticated;
