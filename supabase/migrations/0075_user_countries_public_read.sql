-- Migration: Allow authenticated users to read other users' country counts
-- This fixes the issue where viewing another user's profile shows 0 countries
-- because the RLS policy only allowed users to view their own data.

-- Add policy to allow any authenticated user to view user_countries for country counts
-- This is safe because user_countries only contains:
-- - user_id (UUID)
-- - country_code (string)
-- - status (visited/wishlist)
-- - created_at/updated_at timestamps
-- No sensitive information is exposed.

-- Drop first to make idempotent
DROP POLICY IF EXISTS "Authenticated users can view any user_countries" ON user_countries;

CREATE POLICY "Authenticated users can view any user_countries"
  ON user_countries FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY "Authenticated users can view any user_countries" ON user_countries IS
  'Allow authenticated users to read country associations for displaying country counts on profiles';
