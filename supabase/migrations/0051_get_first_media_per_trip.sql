-- Returns exactly one media file_path per trip using DISTINCT ON.
-- Replaces the over-fetching query that pulled N*5 rows and filtered in Python.
CREATE OR REPLACE FUNCTION get_first_media_per_trip(trip_ids uuid[])
RETURNS TABLE(trip_id uuid, file_path text)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (e.trip_id)
         e.trip_id,
         mf.file_path
    FROM media_files mf
    JOIN entry e ON e.id = mf.entry_id
   WHERE e.trip_id = ANY(trip_ids)
     AND e.deleted_at IS NULL
   ORDER BY e.trip_id, mf.created_at ASC;
$$;
