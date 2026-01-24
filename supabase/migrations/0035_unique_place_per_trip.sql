-- Migration: Add unique constraint to prevent duplicate places per trip
-- This provides atomic duplicate prevention that the application-level EXISTS
-- check cannot guarantee under concurrent access.
--
-- We use a denormalized trip_id column on place maintained via triggers,
-- since PostgreSQL doesn't support subqueries in unique index expressions.

-- First, clean up existing duplicate places (keep the oldest entry's place)
-- This deletes the place record AND the associated entry since they're true duplicates
DELETE FROM entry
WHERE id IN (
  SELECT p.entry_id FROM (
    SELECT
      p.id,
      p.entry_id,
      ROW_NUMBER() OVER (
        PARTITION BY p.google_place_id, e.trip_id
        ORDER BY e.created_at ASC
      ) as rn
    FROM place p
    JOIN entry e ON e.id = p.entry_id
    WHERE p.google_place_id IS NOT NULL
  ) p
  WHERE p.rn > 1
);

-- Add trip_id column to place (denormalized for constraint enforcement)
ALTER TABLE place ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trip(id) ON DELETE CASCADE;

-- Populate existing trip_ids from entry relationship
UPDATE place p
SET trip_id = e.trip_id
FROM entry e
WHERE p.entry_id = e.id
  AND p.trip_id IS NULL;

-- Create trigger function to maintain trip_id on place
CREATE OR REPLACE FUNCTION sync_place_trip_id()
RETURNS TRIGGER AS $$
BEGIN
  -- On INSERT or UPDATE of entry_id, sync the trip_id
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.entry_id IS DISTINCT FROM OLD.entry_id) THEN
    SELECT trip_id INTO NEW.trip_id
    FROM entry
    WHERE id = NEW.entry_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on place table
DROP TRIGGER IF EXISTS trg_sync_place_trip_id ON place;
CREATE TRIGGER trg_sync_place_trip_id
  BEFORE INSERT OR UPDATE ON place
  FOR EACH ROW
  EXECUTE FUNCTION sync_place_trip_id();

-- Also need a trigger on entry to update place when entry.trip_id changes
CREATE OR REPLACE FUNCTION sync_place_trip_id_on_entry_move()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id THEN
    UPDATE place SET trip_id = NEW.trip_id WHERE entry_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_place_trip_id_on_entry ON entry;
CREATE TRIGGER trg_sync_place_trip_id_on_entry
  AFTER UPDATE ON entry
  FOR EACH ROW
  EXECUTE FUNCTION sync_place_trip_id_on_entry_move();

-- Now create the unique constraint
-- Only applies when google_place_id is not null (external places)
--
-- Note: Custom places (google_place_id IS NULL) are intentionally NOT constrained:
-- 1. User-entered names lack canonical identifiers for reliable deduplication
-- 2. Normalized matching (lowercase, trim) would still allow legitimate duplicates
-- 3. Risk of false positives (e.g., two different "Coffee Shop" entries in same trip)
CREATE UNIQUE INDEX idx_place_unique_google_per_trip
  ON place(google_place_id, trip_id)
  WHERE google_place_id IS NOT NULL;

-- Index for efficient lookups
CREATE INDEX idx_place_trip_id ON place(trip_id);
