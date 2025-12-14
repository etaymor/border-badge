-- Use custom code XN for Northern Cyprus so NC can represent New Caledonia
-- Update existing data to keep references consistent

UPDATE country
SET code = 'XN'
WHERE code = 'NC' AND name = 'Northern Cyprus';

UPDATE user_profile
SET home_country_code = 'XN'
WHERE home_country_code = 'NC';

COMMENT ON COLUMN country.code IS 'ISO 3166-1 alpha-2 code or approved custom code (e.g., XN for Northern Cyprus)';

