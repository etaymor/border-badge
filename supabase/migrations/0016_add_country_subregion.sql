-- Add subregion column to country table for granular regional filtering
-- Subregions provide finer geographic groupings within continents

ALTER TABLE country ADD COLUMN subregion TEXT;

-- Create index for efficient subregion filtering
CREATE INDEX idx_country_subregion ON country(subregion);

-- Add comment for documentation
COMMENT ON COLUMN country.subregion IS 'Granular regional grouping within continent (e.g., Northern Africa, Southeast Asia, Caribbean)';
