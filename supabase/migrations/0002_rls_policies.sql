-- Phase 1: Row Level Security policies for Border Badge
-- Ensures users can only access their own data and shared trip data

--------------------------------------------------------------------------------
-- ENABLE RLS ON ALL TABLES
--------------------------------------------------------------------------------

ALTER TABLE country ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE place ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- COUNTRY POLICIES (Public reference data)
--------------------------------------------------------------------------------

-- Countries are readable by everyone (authenticated or not)
CREATE POLICY "Countries are viewable by everyone"
  ON country FOR SELECT
  USING (true);

--------------------------------------------------------------------------------
-- USER PROFILE POLICIES
--------------------------------------------------------------------------------

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON user_profile FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON user_profile FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Profile creation is handled by trigger; restrict to service role only
CREATE POLICY "Service role can insert profiles"
  ON user_profile FOR INSERT
  TO service_role
  WITH CHECK (true);

--------------------------------------------------------------------------------
-- USER COUNTRIES POLICIES
--------------------------------------------------------------------------------

-- Users can view their own country associations
CREATE POLICY "Users can view own user_countries"
  ON user_countries FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own country associations
CREATE POLICY "Users can insert own user_countries"
  ON user_countries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own country associations
CREATE POLICY "Users can update own user_countries"
  ON user_countries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own country associations
CREATE POLICY "Users can delete own user_countries"
  ON user_countries FOR DELETE
  USING (auth.uid() = user_id);

--------------------------------------------------------------------------------
-- HELPER FUNCTIONS FOR RLS (SECURITY DEFINER to bypass RLS in subqueries)
-- These prevent infinite recursion between trip and trip_tags policies
--------------------------------------------------------------------------------

-- Check if user is the owner of a trip (used by trip_tags policies)
CREATE OR REPLACE FUNCTION is_trip_owner(p_trip_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM trip
    WHERE id = p_trip_id
      AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has approved tag for a trip (used by trip policies)
CREATE OR REPLACE FUNCTION has_approved_trip_tag(p_trip_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM trip_tags
    WHERE trip_id = p_trip_id
      AND tagged_user_id = auth.uid()
      AND status = 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

--------------------------------------------------------------------------------
-- TRIP POLICIES
--------------------------------------------------------------------------------

-- Trip owners have full access to their trips
CREATE POLICY "Trip owner has full access"
  ON trip FOR ALL
  USING (auth.uid() = user_id);

-- Approved tagged users can view trips they're tagged in
-- Uses SECURITY DEFINER function to avoid RLS recursion with trip_tags
CREATE POLICY "Approved tagged users can view trip"
  ON trip FOR SELECT
  USING (has_approved_trip_tag(id));

--------------------------------------------------------------------------------
-- TRIP TAGS POLICIES
--------------------------------------------------------------------------------

-- Trip owner can view all tags on their trips
-- Uses SECURITY DEFINER function to avoid RLS recursion with trip
CREATE POLICY "Trip owner can view tags"
  ON trip_tags FOR SELECT
  USING (is_trip_owner(trip_id));

-- Tagged users can view their own tags (to see pending invitations)
CREATE POLICY "Tagged user can view own tag"
  ON trip_tags FOR SELECT
  USING (auth.uid() = tagged_user_id);

-- Trip owner can create tags on their trips
CREATE POLICY "Trip owner can create tags"
  ON trip_tags FOR INSERT
  WITH CHECK (is_trip_owner(trip_id));

-- Tagged user can update their own tag status (approve/decline)
CREATE POLICY "Tagged user can update own tag status"
  ON trip_tags FOR UPDATE
  USING (auth.uid() = tagged_user_id)
  WITH CHECK (auth.uid() = tagged_user_id);

-- Trip owner can delete tags from their trips
CREATE POLICY "Trip owner can delete tags"
  ON trip_tags FOR DELETE
  USING (is_trip_owner(trip_id));

--------------------------------------------------------------------------------
-- ENTRY POLICIES
--------------------------------------------------------------------------------

-- Helper function to check if user is trip participant (owner or approved tag)
CREATE OR REPLACE FUNCTION is_trip_participant(p_trip_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM trip
    WHERE trip.id = p_trip_id
      AND (
        trip.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM trip_tags
          WHERE trip_tags.trip_id = trip.id
            AND trip_tags.tagged_user_id = auth.uid()
            AND trip_tags.status = 'approved'
        )
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trip participants can view entries
CREATE POLICY "Trip participants can view entries"
  ON entry FOR SELECT
  USING (is_trip_participant(trip_id));

-- Only trip owner can insert entries
CREATE POLICY "Trip owner can insert entries"
  ON entry FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trip
      WHERE trip.id = entry.trip_id
        AND trip.user_id = auth.uid()
    )
  );

-- Only trip owner can update entries
CREATE POLICY "Trip owner can update entries"
  ON entry FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM trip
      WHERE trip.id = entry.trip_id
        AND trip.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trip
      WHERE trip.id = entry.trip_id
        AND trip.user_id = auth.uid()
    )
  );

-- Only trip owner can delete entries
CREATE POLICY "Trip owner can delete entries"
  ON entry FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM trip
      WHERE trip.id = entry.trip_id
        AND trip.user_id = auth.uid()
    )
  );

--------------------------------------------------------------------------------
-- PLACE POLICIES
--------------------------------------------------------------------------------

-- Trip participants can view places (via entry relationship)
CREATE POLICY "Trip participants can view places"
  ON place FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM entry
      WHERE entry.id = place.entry_id
        AND is_trip_participant(entry.trip_id)
    )
  );

-- Only entry owner can insert places
CREATE POLICY "Entry owner can insert places"
  ON place FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = auth.uid()
    )
  );

-- Only entry owner can update places
CREATE POLICY "Entry owner can update places"
  ON place FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = auth.uid()
    )
  );

-- Only entry owner can delete places
CREATE POLICY "Entry owner can delete places"
  ON place FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM entry
      JOIN trip ON trip.id = entry.trip_id
      WHERE entry.id = place.entry_id
        AND trip.user_id = auth.uid()
    )
  );

--------------------------------------------------------------------------------
-- MEDIA FILES POLICIES
--------------------------------------------------------------------------------

-- Media owner can do everything with their files
CREATE POLICY "Media owner has full access"
  ON media_files FOR ALL
  USING (auth.uid() = owner_id);

-- Trip participants can view media attached to trips/entries they can access
CREATE POLICY "Trip participants can view media"
  ON media_files FOR SELECT
  USING (
    -- Direct trip attachment
    (trip_id IS NOT NULL AND is_trip_participant(trip_id))
    OR
    -- Entry attachment (check via entry's trip)
    (entry_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM entry
      WHERE entry.id = media_files.entry_id
        AND is_trip_participant(entry.trip_id)
    ))
  );
