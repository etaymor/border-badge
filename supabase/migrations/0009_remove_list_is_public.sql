-- Migration: Remove is_public column from list table
-- All lists are always public, so this column is unnecessary.

--------------------------------------------------------------------------------
-- DROP INDEX
--------------------------------------------------------------------------------

-- Drop the index on is_public since the column is being removed
DROP INDEX IF EXISTS idx_list_public;

--------------------------------------------------------------------------------
-- UPDATE RLS POLICIES
--------------------------------------------------------------------------------

-- Drop existing policies that reference is_public
DROP POLICY IF EXISTS "Anyone can view public lists" ON list;

-- Recreate policy without is_public check - all lists are viewable by anyone
CREATE POLICY "Anyone can view lists"
  ON list
  FOR SELECT
  USING (deleted_at IS NULL);

-- Update list entries policy that references is_public through list table
DROP POLICY IF EXISTS "Anyone can view public list entries" ON list_entries;

-- Recreate without is_public check - entries in any list are viewable
CREATE POLICY "Anyone can view list entries"
  ON list_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM list
      WHERE list.id = list_entries.list_id
      AND list.deleted_at IS NULL
    )
  );

--------------------------------------------------------------------------------
-- DROP COLUMN
--------------------------------------------------------------------------------

-- Remove the is_public column since all lists are always public
ALTER TABLE list DROP COLUMN is_public;
