-- Migration: Allow authenticated users to read all user profiles
-- This enables the user search feature for finding other travelers

-- Drop any existing policies that might conflict
DROP POLICY IF EXISTS "Users can view own profile" ON user_profile;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON user_profile;

-- Create a new policy that allows any authenticated user to view profiles
-- This is needed for:
-- 1. User search (finding other travelers)
-- 2. Viewing other users' profiles
-- 3. Following/unfollowing users
CREATE POLICY "Authenticated users can view profiles"
  ON user_profile FOR SELECT
  TO authenticated
  USING (true);
