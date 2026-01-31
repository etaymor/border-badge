-- Fix function overload conflict for atomic_create_entry_with_place
--
-- Problem: Two function signatures exist with incompatible 4th parameters:
--   - Old (0026): p_saved_source_id UUID DEFAULT NULL
--   - New (0044): p_entries_limit INTEGER DEFAULT NULL
--
-- PostgreSQL can't choose between them when called with 3 arguments.
-- Solution: Drop the old signature and keep only the new one with limit enforcement.

-- Drop all existing overloads
DROP FUNCTION IF EXISTS atomic_create_entry_with_place(UUID, JSONB, JSONB);
DROP FUNCTION IF EXISTS atomic_create_entry_with_place(UUID, JSONB, JSONB, UUID);
DROP FUNCTION IF EXISTS atomic_create_entry_with_place(UUID, JSONB, JSONB, INTEGER);

-- Recreate with single clean signature that includes limit enforcement
CREATE OR REPLACE FUNCTION atomic_create_entry_with_place(
  p_trip_id UUID,
  p_entry_data JSONB,
  p_place_data JSONB DEFAULT NULL,
  p_entries_limit INTEGER DEFAULT NULL  -- Pass limit for free users, NULL for premium
)
RETURNS TABLE (
  entry_row JSONB,
  place_row JSONB,
  error_code TEXT,        -- 'LIMIT_EXCEEDED' or NULL on success
  current_count INTEGER   -- Current entry count when limit exceeded
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_entry_count INTEGER;
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

  -- Atomic limit enforcement for free users
  IF p_entries_limit IS NOT NULL THEN
    -- Advisory lock on trip to prevent concurrent inserts bypassing limit
    -- Uses transaction-scoped lock that's automatically released at commit/rollback
    PERFORM pg_advisory_xact_lock(hashtext(p_trip_id::text));

    -- Count current non-deleted entries
    SELECT COUNT(*) INTO v_entry_count
    FROM entry
    WHERE trip_id = p_trip_id AND deleted_at IS NULL;

    -- Reject if at or over limit
    IF v_entry_count >= p_entries_limit THEN
      RETURN QUERY SELECT
        NULL::JSONB,
        NULL::JSONB,
        'LIMIT_EXCEEDED'::TEXT,
        v_entry_count;
      RETURN;
    END IF;
  END IF;

  -- Create the entry
  INSERT INTO entry (
    trip_id,
    type,
    title,
    notes,
    link,
    metadata,
    date
  )
  VALUES (
    p_trip_id,
    COALESCE((p_entry_data->>'type')::entry_type, 'experience'),
    p_entry_data->>'title',
    p_entry_data->>'notes',
    p_entry_data->>'link',
    p_entry_data->'metadata',
    (p_entry_data->>'date')::DATE
  )
  RETURNING * INTO v_entry_record;

  -- Create place if provided
  IF p_place_data IS NOT NULL AND p_place_data != 'null'::JSONB THEN
    INSERT INTO place (
      entry_id,
      trip_id,
      google_place_id,
      place_name,
      lat,
      lng,
      address,
      extra_data
    )
    VALUES (
      v_entry_record.id,
      p_trip_id,
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

  RETURN QUERY SELECT v_entry_json, v_place_json, NULL::TEXT, NULL::INTEGER;
END;
$$;
