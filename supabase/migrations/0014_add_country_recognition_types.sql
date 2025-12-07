-- Add additional country recognition types for dependent territories and special regions
-- This enables tracking of places like Hong Kong, Puerto Rico, Scotland, etc.

-- Add new enum values to country_recognition type
ALTER TYPE country_recognition ADD VALUE IF NOT EXISTS 'dependent_territory';
ALTER TYPE country_recognition ADD VALUE IF NOT EXISTS 'special_region';
ALTER TYPE country_recognition ADD VALUE IF NOT EXISTS 'constituent_country';

-- Update comment for clarity
COMMENT ON TYPE country_recognition IS 'Country recognition status: un_member (193 UN states), observer (Vatican, Palestine), disputed (Kosovo, Taiwan), territory (Antarctica), dependent_territory (Puerto Rico, Hong Kong pre-1997 style), special_region (Hong Kong, Macau SARs), constituent_country (Scotland, Wales, N. Ireland)';
