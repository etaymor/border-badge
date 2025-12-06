-- Add link field to entry table
-- This allows users to associate a URL with their entries

ALTER TABLE entry ADD COLUMN link TEXT;

-- Add comment for documentation
COMMENT ON COLUMN entry.link IS 'Optional URL associated with the entry (e.g., restaurant website, booking link)';
