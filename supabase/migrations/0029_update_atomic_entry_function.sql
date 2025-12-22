-- Update atomic_create_entry_with_place to remove saved_source linking logic
-- The saved_source table has been removed, so this function no longer needs to link entries to it.
-- Also updated to use is_trip_participant() to allow approved trip_tags members to create entries.

CREATE OR REPLACE FUNCTION atomic_create_entry_with_place(
  p_trip_id UUID,
  p_entry_data JSONB,
  p_place_data JSONB DEFAULT NULL
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

  -- Verify user is a trip participant (owner or approved tag) and trip is not soft-deleted
  -- Uses is_trip_participant() helper which already checks deleted_at IS NULL
  IF NOT is_trip_participant(p_trip_id) THEN
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

  -- Build entry JSON for return
  SELECT to_jsonb(v_entry_record) INTO v_entry_json;

  RETURN QUERY SELECT v_entry_json, v_place_json;
END;
$$;
