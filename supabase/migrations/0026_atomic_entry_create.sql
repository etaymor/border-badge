-- Atomic entry creation with place handling
-- Provides transaction safety for entry + place creation in a single operation.
-- Prevents orphaned entries if place creation fails.

--------------------------------------------------------------------------------
-- ATOMIC CREATE FUNCTION
--------------------------------------------------------------------------------

-- Atomically create an entry and optionally its associated place data.
-- Uses SECURITY DEFINER to verify ownership via trip ownership check.
--
-- Parameters:
--   p_trip_id: The trip to create the entry in
--   p_entry_data: JSONB containing entry fields (title, notes, type, link, metadata)
--   p_place_data: JSONB containing place fields (null if no place)
--   p_saved_source_id: Optional saved source to link (null if not from social ingest)
--
-- Returns: Table with entry_row (JSONB) and place_row (JSONB, may be null)
-- Returns empty result set if trip not found or user doesn't own it
CREATE OR REPLACE FUNCTION atomic_create_entry_with_place(
  p_trip_id UUID,
  p_entry_data JSONB,
  p_place_data JSONB DEFAULT NULL,
  p_saved_source_id UUID DEFAULT NULL
)
RETURNS TABLE (entry_row JSONB, place_row JSONB)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_entry_record RECORD;
  v_place_record RECORD;
  v_entry_json JSONB;
  v_place_json JSONB;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Verify trip exists and user owns it (not soft-deleted)
  IF NOT EXISTS (
    SELECT 1 FROM trip
    WHERE id = p_trip_id
      AND user_id = v_user_id
      AND deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  -- Create the entry
  INSERT INTO entry (
    trip_id,
    type,
    title,
    notes,
    link,
    metadata
  )
  VALUES (
    p_trip_id,
    COALESCE((p_entry_data->>'type')::entry_type, 'experience'),
    p_entry_data->>'title',
    p_entry_data->>'notes',
    p_entry_data->>'link',
    p_entry_data->'metadata'
  )
  RETURNING * INTO v_entry_record;

  -- Create place if provided
  IF p_place_data IS NOT NULL AND p_place_data != 'null'::JSONB THEN
    INSERT INTO place (
      entry_id,
      google_place_id,
      place_name,
      lat,
      lng,
      address,
      extra_data
    )
    VALUES (
      v_entry_record.id,
      p_place_data->>'google_place_id',
      p_place_data->>'place_name',
      (p_place_data->>'lat')::DOUBLE PRECISION,
      (p_place_data->>'lng')::DOUBLE PRECISION,
      p_place_data->>'address',
      p_place_data->'extra_data'
    )
    RETURNING * INTO v_place_record;

    SELECT to_jsonb(v_place_record) INTO v_place_json;
  ELSE
    v_place_json := NULL;
  END IF;

  -- Link saved source to entry if provided
  IF p_saved_source_id IS NOT NULL THEN
    UPDATE saved_source
    SET entry_id = v_entry_record.id
    WHERE id = p_saved_source_id
      AND user_id = v_user_id;
  END IF;

  -- Build entry JSON for return
  SELECT to_jsonb(v_entry_record) INTO v_entry_json;

  RETURN QUERY SELECT v_entry_json, v_place_json;
END;
$$;
