-- Phase 4: Shareable Lists feature
-- Creates tables for curated lists of entries that can be shared publicly

--------------------------------------------------------------------------------
-- TABLES
--------------------------------------------------------------------------------

-- List table (curated collection of entries from a trip)
CREATE TABLE list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_list_trip ON list(trip_id);
CREATE INDEX idx_list_owner ON list(owner_id);
CREATE INDEX idx_list_slug ON list(slug);
CREATE INDEX idx_list_public ON list(is_public) WHERE is_public = true;

-- List entries junction table (entries included in a list)
CREATE TABLE list_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES list(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(list_id, entry_id)
);

CREATE INDEX idx_list_entries_list ON list_entries(list_id, position);
CREATE INDEX idx_list_entries_entry ON list_entries(entry_id);

--------------------------------------------------------------------------------
-- FUNCTIONS
--------------------------------------------------------------------------------

-- Generate unique slug from list name
CREATE OR REPLACE FUNCTION generate_list_slug(list_name TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INT := 0;
BEGIN
  -- Convert name to slug: lowercase, replace spaces with hyphens, remove special chars
  base_slug := lower(regexp_replace(list_name, '[^a-zA-Z0-9\s-]', '', 'g'));
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

-- Auto-generate slug on insert if not provided
CREATE OR REPLACE FUNCTION set_list_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_list_slug(NEW.name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_list_slug_trigger
  BEFORE INSERT ON list
  FOR EACH ROW EXECUTE FUNCTION set_list_slug();

-- Update updated_at on list modification
CREATE OR REPLACE FUNCTION update_list_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_list_timestamp_trigger
  BEFORE UPDATE ON list
  FOR EACH ROW EXECUTE FUNCTION update_list_timestamp();

--------------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--------------------------------------------------------------------------------

ALTER TABLE list ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_entries ENABLE ROW LEVEL SECURITY;

-- List policies

-- Owner can do everything with their lists
CREATE POLICY "Owner can manage own lists"
  ON list
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Anyone can view public lists
CREATE POLICY "Anyone can view public lists"
  ON list
  FOR SELECT
  USING (is_public = true);

-- List entries policies

-- Owner can manage entries in their lists
CREATE POLICY "Owner can manage list entries"
  ON list_entries
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM list
      WHERE list.id = list_entries.list_id
      AND list.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM list
      WHERE list.id = list_entries.list_id
      AND list.owner_id = auth.uid()
    )
  );

-- Anyone can view entries in public lists
CREATE POLICY "Anyone can view public list entries"
  ON list_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM list
      WHERE list.id = list_entries.list_id
      AND list.is_public = true
    )
  );
