-- Phase 9: Trip sharing feature
-- Adds share_slug to trips for public sharing via unique links

--------------------------------------------------------------------------------
-- SCHEMA CHANGES
--------------------------------------------------------------------------------

-- Add share_slug column to trip table for public sharing
-- NULL means trip is private, non-NULL means publicly accessible via slug
ALTER TABLE trip ADD COLUMN share_slug TEXT UNIQUE;

-- Index for efficient slug lookups (partial index for non-null slugs only)
CREATE INDEX idx_trip_share_slug ON trip(share_slug) WHERE share_slug IS NOT NULL;

--------------------------------------------------------------------------------
-- FUNCTIONS
--------------------------------------------------------------------------------

-- Generate unique slug from trip name (reuses pattern from list slug generation)
CREATE OR REPLACE FUNCTION generate_trip_share_slug(trip_name TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
BEGIN
  -- Convert name to slug: lowercase, replace spaces with hyphens, remove special chars
  base_slug := lower(regexp_replace(trip_name, '[^a-zA-Z0-9\s-]', '', 'g'));
  base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  base_slug := trim(both '-' from base_slug);

  -- Truncate to reasonable length
  base_slug := left(base_slug, 50);

  -- Add random suffix for uniqueness
  final_slug := base_slug || '-' || substr(gen_random_uuid()::text, 1, 8);

  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--------------------------------------------------------------------------------

-- Allow anyone to view trips that have been shared (have a share_slug)
-- This supplements existing policies that allow owner and approved tagged users
CREATE POLICY "Anyone can view shared trips"
  ON trip
  FOR SELECT
  USING (share_slug IS NOT NULL AND deleted_at IS NULL);

-- Allow anyone to view entries that belong to shared trips
-- This ensures public trip pages can render entry data without authentication
CREATE POLICY "Anyone can view entries from shared trips"
  ON entry
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM trip
      WHERE trip.id = entry.trip_id
        AND trip.share_slug IS NOT NULL
        AND trip.deleted_at IS NULL
    )
  );
