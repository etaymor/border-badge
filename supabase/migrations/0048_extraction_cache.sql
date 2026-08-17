-- Migration: Add extraction result caching to oembed_cache
-- Purpose: Cache LLM and video extraction results alongside oEmbed data
-- Note: Reuses existing oembed_cache table - extraction results are same for all users

-- Add extraction result columns to existing oembed_cache table
-- Wrapped in DO block because remote migration runner cannot prepare multiple statements.
DO $migration$
BEGIN
  ALTER TABLE public.oembed_cache
      ADD COLUMN IF NOT EXISTS extraction_result jsonb,
      ADD COLUMN IF NOT EXISTS extraction_source text
          CHECK (extraction_source IS NULL OR extraction_source IN ('caption', 'video_frames', 'carousel', 'screenshot')),
      ADD COLUMN IF NOT EXISTS extraction_at timestamptz;

  COMMENT ON COLUMN public.oembed_cache.extraction_result IS
      'Cached place extraction result as JSON (places array with name, city, country, entry_type)';

  COMMENT ON COLUMN public.oembed_cache.extraction_source IS
      'How the places were extracted (caption, video_frames, carousel, screenshot)';

  COMMENT ON COLUMN public.oembed_cache.extraction_at IS
      'When extraction was performed (may differ from row creation if oEmbed was cached first)';
END;
$migration$;
