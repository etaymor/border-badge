-- Migration: 0064_trip_visibility_followers (renumbered from 0038)
-- Description: Update trip and entry RLS policies for follower visibility
--
-- MERGE RECONCILIATION: this migration now runs AFTER main's
-- 0033_add_uncategorized_trip and 0054_fix_rls_performance, so the
-- comprehensive SELECT policy below carries BOTH sides' fixes:
--   - (select auth.uid()) InitPlan pattern from 0054 (evaluate once per query)
--   - deleted_at IS NULL soft-delete guard (matches the 0054 view policies
--     this replaces)
--   - follower/approved-tag visibility with bidirectional block checks (branch)
-- It also drops 0054's "Users can view trips they are tagged on" because the
-- comprehensive policy covers approved tags WITH block checks; leaving both
-- would let blocked-but-tagged users bypass blocks via the older policy.

-- Drop old trip view policies if they exist
DROP POLICY IF EXISTS "Users can view own trips" ON trip;
DROP POLICY IF EXISTS "Users can view trips they are tagged on" ON trip;
DROP POLICY IF EXISTS "trip_view_policy" ON trip;
DROP POLICY IF EXISTS "Trip visibility with followers and blocks" ON trip;

-- Create comprehensive trip visibility policy
-- Visible to: owner, approved tagged users, followers (unless blocked)
CREATE POLICY "Trip visibility with followers and blocks"
  ON trip FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      -- Owner can always see their own (non-deleted) trips
      user_id = (select auth.uid())
      OR
      -- Approved tagged user can see (as long as not blocked)
      (
        id IN (
          SELECT trip_id FROM trip_tags
          WHERE tagged_user_id = (select auth.uid())
            AND status = 'approved'
        )
        AND NOT is_blocked_bidirectional(user_id)
      )
      OR
      -- Followers can see (as long as not blocked)
      (
        user_id IN (
          SELECT following_id FROM user_follow
          WHERE follower_id = (select auth.uid())
        )
        AND NOT is_blocked_bidirectional(user_id)
      )
    )
  );

-- Drop old entry view policies
DROP POLICY IF EXISTS "Users can view own entries" ON entry;
DROP POLICY IF EXISTS "entry_view_policy" ON entry;
DROP POLICY IF EXISTS "Entry visibility matches trip" ON entry;

-- Entry visibility follows the trip visibility
-- If you can see the trip, you can see its entries
CREATE POLICY "Entry visibility matches trip"
  ON entry FOR SELECT
  USING (
    -- Check if user can view the parent trip
    EXISTS (
      SELECT 1 FROM trip t
      WHERE t.id = entry.trip_id
      -- The trip's RLS policy will filter this
    )
  );

-- Keep existing insert/update/delete policies for trips
-- These should already exist and only allow owner operations
--
-- MERGE RECONCILIATION: the original 0038 conditionally created a
-- "Users can insert own trips" policy. Main's 0054 already provides the
-- INSERT policy "Users can create own trips" (InitPlan-optimized), so that
-- block was removed to avoid a duplicate permissive INSERT policy. The
-- update/delete blocks below are kept as no-op safety nets: main's
-- 0033/0054 versions (with is_system guards and InitPlan pattern) already
-- exist by this point and are the surviving definitions.

-- Create policy for trip update if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'trip'
        AND policyname = 'Users can update own trips'
    ) THEN
        CREATE POLICY "Users can update own trips"
          ON trip FOR UPDATE
          USING (user_id = auth.uid())
          WITH CHECK (user_id = auth.uid());
    END IF;
END $$;

-- Create policy for trip delete if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'trip'
        AND policyname = 'Users can delete own trips'
    ) THEN
        CREATE POLICY "Users can delete own trips"
          ON trip FOR DELETE
          USING (user_id = auth.uid());
    END IF;
END $$;

-- Create policies for entries if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'entry'
        AND policyname = 'Users can insert entries for own trips'
    ) THEN
        CREATE POLICY "Users can insert entries for own trips"
          ON entry FOR INSERT
          WITH CHECK (
            trip_id IN (SELECT id FROM trip WHERE user_id = auth.uid())
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'entry'
        AND policyname = 'Users can update entries for own trips'
    ) THEN
        CREATE POLICY "Users can update entries for own trips"
          ON entry FOR UPDATE
          USING (
            trip_id IN (SELECT id FROM trip WHERE user_id = auth.uid())
          )
          WITH CHECK (
            trip_id IN (SELECT id FROM trip WHERE user_id = auth.uid())
          );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'entry'
        AND policyname = 'Users can delete entries for own trips'
    ) THEN
        CREATE POLICY "Users can delete entries for own trips"
          ON entry FOR DELETE
          USING (
            trip_id IN (SELECT id FROM trip WHERE user_id = auth.uid())
          );
    END IF;
END $$;
