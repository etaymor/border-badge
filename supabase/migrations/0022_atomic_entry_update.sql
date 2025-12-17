-- Atomic entry update with place handling
-- Provides transaction safety for entry + place updates in a single operation.
-- Prevents data inconsistency when entry update succeeds but place update fails.

--------------------------------------------------------------------------------
-- ATOMIC UPDATE FUNCTION
--------------------------------------------------------------------------------

-- Atomically update an entry and its associated place data.
-- Uses SECURITY DEFINER to verify ownership via trip ownership check.
--
-- Parameters:
--   p_entry_id: The entry to update
--   p_entry_data: JSONB containing entry fields to update (title, notes, type, date, etc.)
--   p_place_operation: 'none' (preserve existing), 'delete' (remove place), or 'upsert' (create/update)
--   p_place_data: JSONB containing place fields when operation = 'upsert'
--
-- Returns: Table with entry_row (JSONB) and place_row (JSONB, may be null)
-- Returns empty result set if entry not found or user doesn't own it
CREATE OR REPLACE FUNCTION atomic_update_entry_with_place(
  p_entry_id UUID,
  p_entry_data JSONB,
  p_place_operation TEXT,
  p_place_data JSONB DEFAULT '{}'::JSONB
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

  -- Verify entry exists and user owns it via trip ownership
  -- Also filter out soft-deleted entries
  SELECT e.* INTO v_entry_record
  FROM entry e
  INNER JOIN trip t ON e.trip_id = t.id
  WHERE e.id = p_entry_id
    AND t.user_id = v_user_id
    AND e.deleted_at IS NULL
    AND t.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Update entry fields if provided
  IF p_entry_data IS NOT NULL AND p_entry_data != '{}'::JSONB THEN
    UPDATE entry
    SET
      title = COALESCE(p_entry_data->>'title', title),
      notes = CASE
        WHEN p_entry_data ? 'notes' THEN p_entry_data->>'notes'
        ELSE notes
      END,
      type = CASE
        WHEN p_entry_data ? 'type' THEN (p_entry_data->>'type')::entry_type
        ELSE type
      END,
      date = CASE
        WHEN p_entry_data ? 'date' THEN (p_entry_data->>'date')::TIMESTAMPTZ
        ELSE date
      END,
      metadata = CASE
        WHEN p_entry_data ? 'metadata' THEN p_entry_data->'metadata'
        ELSE metadata
      END
    WHERE id = p_entry_id
    RETURNING * INTO v_entry_record;
  END IF;

  -- Handle place operations
  IF p_place_operation = 'delete' THEN
    -- Delete existing place
    DELETE FROM place WHERE entry_id = p_entry_id;
    v_place_json := NULL;

  ELSIF p_place_operation = 'upsert' THEN
    -- Upsert place data (insert or update)
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
      p_entry_id,
      p_place_data->>'google_place_id',
      p_place_data->>'place_name',
      (p_place_data->>'lat')::DOUBLE PRECISION,
      (p_place_data->>'lng')::DOUBLE PRECISION,
      p_place_data->>'address',
      p_place_data->'extra_data'
    )
    ON CONFLICT (entry_id) DO UPDATE SET
      google_place_id = EXCLUDED.google_place_id,
      place_name = EXCLUDED.place_name,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      address = EXCLUDED.address,
      extra_data = EXCLUDED.extra_data
    RETURNING * INTO v_place_record;

    SELECT to_jsonb(v_place_record) INTO v_place_json;

  ELSE
    -- 'none' or any other value: preserve existing place
    SELECT to_jsonb(p.*) INTO v_place_json
    FROM place p
    WHERE p.entry_id = p_entry_id;
  END IF;

  -- Build entry JSON for return
  SELECT to_jsonb(v_entry_record) INTO v_entry_json;

  RETURN QUERY SELECT v_entry_json, v_place_json;
END;
$$;
