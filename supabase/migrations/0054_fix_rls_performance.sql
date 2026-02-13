-- Fix RLS performance warnings:
-- 1. Remove duplicate trip policies left over from 0033 naming mismatch
-- 2. Replace auth.uid() with (select auth.uid()) to evaluate once per query

--------------------------------------------------------------------------------
-- PART 1: Remove duplicate trip policies from 0005
--
-- Migration 0033 tried to DROP these but used wrong names ("Users can..."
-- instead of "Trip owner can..."), so the DROPs silently no-op'd via IF EXISTS.
-- Both sets have coexisted since, causing double policy evaluation.
--------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Trip owner can view own trips" ON trip;
DROP POLICY IF EXISTS "Trip owner can create trips" ON trip;
DROP POLICY IF EXISTS "Trip owner can update own trips" ON trip;
DROP POLICY IF EXISTS "Trip owner can delete own trips" ON trip;
DROP POLICY IF EXISTS "Approved tagged users can view trip" ON trip;

--------------------------------------------------------------------------------
-- PART 2: Recreate policies with (select auth.uid()) for InitPlan optimization
--
-- Wrapping auth.uid() in a subquery makes PostgreSQL evaluate it once per
-- query instead of once per row, improving performance on large tables.
--------------------------------------------------------------------------------

-- user_profile (from 0002)
DROP POLICY IF EXISTS "Users can view own profile" ON user_profile;
CREATE POLICY "Users can view own profile" ON user_profile
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON user_profile;
CREATE POLICY "Users can update own profile" ON user_profile
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- user_countries (from 0002)
DROP POLICY IF EXISTS "Users can view own user_countries" ON user_countries;
CREATE POLICY "Users can view own user_countries" ON user_countries
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own user_countries" ON user_countries;
CREATE POLICY "Users can insert own user_countries" ON user_countries
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own user_countries" ON user_countries;
CREATE POLICY "Users can update own user_countries" ON user_countries
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own user_countries" ON user_countries;
CREATE POLICY "Users can delete own user_countries" ON user_countries
  FOR DELETE USING ((select auth.uid()) = user_id);

-- trip_tags (from 0002)
DROP POLICY IF EXISTS "Tagged user can view own tag" ON trip_tags;
CREATE POLICY "Tagged user can view own tag" ON trip_tags
  FOR SELECT USING ((select auth.uid()) = tagged_user_id);

DROP POLICY IF EXISTS "Tagged user can update own tag status" ON trip_tags;
CREATE POLICY "Tagged user can update own tag status" ON trip_tags
  FOR UPDATE
  USING ((select auth.uid()) = tagged_user_id)
  WITH CHECK ((select auth.uid()) = tagged_user_id);

-- place (from 0002)
DROP POLICY IF EXISTS "Entry owner can insert places" ON place;
CREATE POLICY "Entry owner can insert places" ON place
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Entry owner can update places" ON place;
CREATE POLICY "Entry owner can update places" ON place
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Entry owner can delete places" ON place;
CREATE POLICY "Entry owner can delete places" ON place
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = (select auth.uid())
    )
  );

-- media_files (from 0002)
DROP POLICY IF EXISTS "Media owner has full access" ON media_files;
CREATE POLICY "Media owner has full access" ON media_files
  FOR ALL USING ((select auth.uid()) = owner_id);

-- list_entries (from 0004)
DROP POLICY IF EXISTS "Owner can manage list entries" ON list_entries;
CREATE POLICY "Owner can manage list entries" ON list_entries
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM list
      WHERE list.id = list_entries.list_id
        AND list.owner_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM list
      WHERE list.id = list_entries.list_id
        AND list.owner_id = (select auth.uid())
    )
  );

-- trip (from 0033 — recreate with InitPlan optimization)
DROP POLICY IF EXISTS "Users can view own trips" ON trip;
CREATE POLICY "Users can view own trips" ON trip
  FOR SELECT
  USING (user_id = (select auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Users can view trips they are tagged on" ON trip;
CREATE POLICY "Users can view trips they are tagged on" ON trip
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM trip_tags
      WHERE trip_tags.trip_id = trip.id
        AND trip_tags.tagged_user_id = (select auth.uid())
        AND trip_tags.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "Users can create own trips" ON trip;
CREATE POLICY "Users can create own trips" ON trip
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update own trips" ON trip;
CREATE POLICY "Users can update own trips" ON trip
  FOR UPDATE
  USING (user_id = (select auth.uid()) AND deleted_at IS NULL AND is_system = false)
  WITH CHECK (user_id = (select auth.uid()) AND deleted_at IS NULL AND is_system = false);

DROP POLICY IF EXISTS "Users can delete own trips" ON trip;
CREATE POLICY "Users can delete own trips" ON trip
  FOR DELETE USING (user_id = (select auth.uid()) AND is_system = false);

-- list (from 0005)
DROP POLICY IF EXISTS "Owner can view own lists" ON list;
CREATE POLICY "Owner can view own lists" ON list
  FOR SELECT USING (owner_id = (select auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Owner can create lists" ON list;
CREATE POLICY "Owner can create lists" ON list
  FOR INSERT WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Owner can update own lists" ON list;
CREATE POLICY "Owner can update own lists" ON list
  FOR UPDATE
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Owner can delete own lists" ON list;
CREATE POLICY "Owner can delete own lists" ON list
  FOR DELETE USING (owner_id = (select auth.uid()));
