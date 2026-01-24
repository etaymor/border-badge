-- Migration: Fix ambiguous column reference in get_or_create_uncategorized_trip
-- Error: 'column reference "user_id" is ambiguous' (code 42702)
--
-- The RETURNS TABLE columns conflict with the SELECT statement when PostgreSQL
-- can't determine if column references are from the return table or the trip table.
-- Fix: Use explicit column aliases in the RETURN QUERY to disambiguate.

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
  BEGIN
    INSERT INTO trip (user_id, country_id, name, is_system)
    VALUES (v_user_id, NULL, 'Saved Places', true);
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  -- Now select the trip (either just inserted or already existing)
  SELECT t.id INTO v_trip_id
  FROM trip t
  WHERE t.user_id = v_user_id
    AND t.is_system = true
    AND t.deleted_at IS NULL;

  -- Return trip with entry count
  -- Use explicit column aliases to avoid ambiguity with RETURNS TABLE columns
  RETURN QUERY
  SELECT
    t.id AS id,
    t.user_id AS user_id,
    t.country_id AS country_id,
    t.name AS name,
    t.cover_image_url AS cover_image_url,
    t.date_range AS date_range,
    t.is_system AS is_system,
    t.created_at AS created_at,
    t.deleted_at AS deleted_at,
    COUNT(e.id)::BIGINT AS entry_count
  FROM trip t
  LEFT JOIN entry e ON e.trip_id = t.id AND e.deleted_at IS NULL
  WHERE t.id = v_trip_id
  GROUP BY
    t.id,
    t.user_id,
    t.country_id,
    t.name,
    t.cover_image_url,
    t.date_range,
    t.is_system,
    t.created_at,
    t.deleted_at;
END;
$$;
