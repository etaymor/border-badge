-- Clear cached negative TikTok slideshow results so they get re-extracted with gallery-dl.
-- The old HTML scraper never worked reliably, so all cached results for /photo/ URLs
-- are either empty arrays or NULL -- both represent failed extractions.
UPDATE oembed_cache
SET extraction_result = NULL, extraction_source = NULL
WHERE canonical_url LIKE 'https://www.tiktok.com/%/photo/%'
  AND (extraction_result = '[]' OR extraction_result IS NULL);
