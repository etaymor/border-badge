-- Use custom code XN for Northern Cyprus so NC can represent New Caledonia
-- Update existing data to keep references consistent
--
-- Safety: This migration is idempotent and validates exactly one row matches
-- before updating to prevent accidental changes to other countries.

DO $$
DECLARE
  matched_count INT;
  updated_count INT;
BEGIN
  -- Check if migration has already been applied (XN already exists)
  SELECT COUNT(*) INTO matched_count FROM country WHERE code = 'XN';
  IF matched_count > 0 THEN
    RAISE NOTICE 'Migration already applied: XN code exists';
    RETURN;
  END IF;

  -- Verify exactly one row matches the intended target
  SELECT COUNT(*) INTO matched_count
  FROM country
  WHERE code = 'NC' AND name = 'Northern Cyprus';

  IF matched_count = 0 THEN
    RAISE NOTICE 'No Northern Cyprus with code NC found - migration may have been applied or data differs';
    RETURN;
  END IF;

  IF matched_count > 1 THEN
    RAISE EXCEPTION 'Safety check failed: Found % rows matching NC + Northern Cyprus, expected 1', matched_count;
  END IF;

  -- Safe to proceed: exactly 1 row matches
  UPDATE country
  SET code = 'XN'
  WHERE code = 'NC' AND name = 'Northern Cyprus';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated Northern Cyprus code from NC to XN (% row)', updated_count;

  -- Update user_profile references for users who had Northern Cyprus as home country
  -- This is safe because we just changed the country code, so any NC references
  -- that were for Northern Cyprus need to be updated to XN
  UPDATE user_profile
  SET home_country_code = 'XN'
  WHERE home_country_code = 'NC';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count > 0 THEN
    RAISE NOTICE 'Updated % user_profile home_country_code from NC to XN', updated_count;
  END IF;
END $$;

COMMENT ON COLUMN country.code IS 'ISO 3166-1 alpha-2 code or approved custom code (e.g., XN for Northern Cyprus)';

