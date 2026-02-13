-- Fix trip card fallback cover images.
--
-- The previous version had two bugs:
-- 1. No status filter — could return processing/failed media with no image
-- 2. Returned file_path only — HEIC originals can't render in expo-image
--
-- This version mirrors the logic in backend/app/core/media.py extract_media_urls:
-- - Only consider 'uploaded' media
-- - Prefer thumbnail_path (always web-compatible JPEG)
-- - Skip non-web originals (HEIC, etc.) that lack a thumbnail
CREATE OR REPLACE FUNCTION get_first_media_per_trip(trip_ids uuid[])
RETURNS TABLE(trip_id uuid, file_path text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (e.trip_id)
         e.trip_id,
         COALESCE(mf.thumbnail_path, mf.file_path) AS file_path
    FROM media_files mf
    JOIN entry e ON e.id = mf.entry_id
   WHERE e.trip_id = ANY(trip_ids)
     AND e.deleted_at IS NULL
     AND mf.status = 'uploaded'
     AND (
       mf.thumbnail_path IS NOT NULL
       OR lower(mf.file_path) ~ '\.(jpg|jpeg|png|gif|webp)$'
     )
   ORDER BY e.trip_id, mf.created_at ASC;
$$;
