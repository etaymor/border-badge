-- Migration: Add extraction result caching to oembed_cache
-- Purpose: Cache LLM and video extraction results alongside oEmbed data
-- Note: Reuses existing oembed_cache table - extraction results are same for all users

-- Add extraction result columns to existing oembed_cache table
alter table public.oembed_cache
    add column if not exists extraction_result jsonb,
    add column if not exists extraction_source text
        check (extraction_source is null or extraction_source in ('caption', 'video_frames', 'carousel', 'screenshot')),
    add column if not exists extraction_at timestamptz;

-- Comment on new columns
comment on column public.oembed_cache.extraction_result is
    'Cached place extraction result as JSON (places array with name, city, country, entry_type)';

comment on column public.oembed_cache.extraction_source is
    'How the places were extracted (caption, video_frames, carousel, screenshot)';

comment on column public.oembed_cache.extraction_at is
    'When extraction was performed (may differ from row creation if oEmbed was cached first)';
