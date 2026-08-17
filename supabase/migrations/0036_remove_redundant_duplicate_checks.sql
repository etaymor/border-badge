-- Migration: Remove redundant duplicate checks from move functions
--
-- The explicit duplicate checks in move_entry_to_trip and bulk_move_entries_to_trip
-- create a race condition: two concurrent requests can both pass the check, then
-- one will violate the unique constraint (idx_place_unique_google_per_trip).
--
-- The unique index provides atomic database-level protection, so we rely on that
-- and catch the constraint violation in the backend to return a clean 409 error.

-- Update move_entry_to_trip to remove the redundant duplicate check
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

  -- NOTE: Duplicate detection is handled by the unique index (idx_place_unique_google_per_trip).
  -- The trigger trg_sync_place_trip_id_on_entry updates place.trip_id when entry.trip_id changes,
  -- which then enforces the unique constraint atomically. The backend catches constraint
  -- violations and returns a clean 409 error.

  -- Move the entry (triggers place.trip_id sync)
  UPDATE entry
  SET trip_id = p_target_trip_id
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  -- Get place if exists (returned to avoid N+1 query in backend)
  SELECT * INTO v_place FROM place WHERE entry_id = p_entry_id;

  -- Return results as JSONB
  RETURN QUERY SELECT
    to_jsonb(v_entry) AS entry_row,
    CASE WHEN v_place IS NOT NULL THEN to_jsonb(v_place) ELSE NULL END AS place_row;
END;
$$;

-- Update bulk_move_entries_to_trip to remove the redundant duplicate check
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
  v_target_user_id UUID;
  v_count INT;
  v_moved_entries JSONB;
  v_requested INT;
  v_found INT;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify target trip exists and belongs to user
  SELECT user_id INTO v_target_user_id
  FROM trip
  WHERE id = p_target_trip_id
    AND deleted_at IS NULL;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target trip not found';
  END IF;

  IF v_target_user_id != v_user_id THEN
    RAISE EXCEPTION 'Not authorized to move to this trip';
  END IF;

  -- Validate all entries exist and are owned by user
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

  -- NOTE: Duplicate detection is handled by the unique index (idx_place_unique_google_per_trip).
  -- The trigger trg_sync_place_trip_id_on_entry updates place.trip_id when entry.trip_id changes,
  -- which then enforces the unique constraint atomically. The backend catches constraint
  -- violations and returns a clean 409 error.

  -- Move all entries in a single update (triggers place.trip_id sync for each)
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
