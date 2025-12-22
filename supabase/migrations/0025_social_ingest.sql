-- Social ingest service tables
-- Creates tables for saved social media sources and oEmbed response caching

--------------------------------------------------------------------------------
-- ENUMS
--------------------------------------------------------------------------------

-- Social media provider type
CREATE TYPE social_provider AS ENUM ('tiktok', 'instagram');

--------------------------------------------------------------------------------
-- TABLES
--------------------------------------------------------------------------------

-- oEmbed response cache
-- Caches metadata from TikTok/Instagram oEmbed APIs to reduce API calls
CREATE TABLE oembed_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url TEXT NOT NULL UNIQUE,
  provider social_provider NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_oembed_cache_url ON oembed_cache(canonical_url);
CREATE INDEX idx_oembed_cache_expires ON oembed_cache(expires_at);
CREATE INDEX idx_oembed_cache_provider ON oembed_cache(provider);

COMMENT ON TABLE oembed_cache IS 'Cache for TikTok/Instagram oEmbed API responses';
COMMENT ON COLUMN oembed_cache.canonical_url IS 'Normalized URL after redirect resolution';
COMMENT ON COLUMN oembed_cache.response IS 'Full oEmbed JSON response from provider';
COMMENT ON COLUMN oembed_cache.expires_at IS 'Cache expiry timestamp (typically 24h TTL)';

-- Saved social media sources
-- Stores metadata from TikTok/Instagram shares before place resolution
CREATE TABLE saved_source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider social_provider NOT NULL,
  original_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  thumbnail_url TEXT,
  author_handle TEXT,
  caption TEXT,
  title TEXT,
  oembed_data JSONB,
  entry_id UUID REFERENCES entry(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_source_user ON saved_source(user_id);
CREATE INDEX idx_saved_source_canonical_url ON saved_source(canonical_url);
CREATE INDEX idx_saved_source_provider ON saved_source(provider);
CREATE INDEX idx_saved_source_entry ON saved_source(entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX idx_saved_source_created ON saved_source(created_at DESC);

COMMENT ON TABLE saved_source IS 'Saved social media content from TikTok/Instagram shares';
COMMENT ON COLUMN saved_source.original_url IS 'Original URL as shared by user (may include tracking params)';
COMMENT ON COLUMN saved_source.canonical_url IS 'Normalized URL after redirect resolution';
COMMENT ON COLUMN saved_source.thumbnail_url IS 'Video/post thumbnail from oEmbed response';
COMMENT ON COLUMN saved_source.author_handle IS 'Creator username/handle from oEmbed';
COMMENT ON COLUMN saved_source.caption IS 'Optional caption text provided by user when sharing';
COMMENT ON COLUMN saved_source.title IS 'Video/post title from oEmbed response';
COMMENT ON COLUMN saved_source.oembed_data IS 'Full oEmbed response for reference';
COMMENT ON COLUMN saved_source.entry_id IS 'Associated entry when place is confirmed and saved';

--------------------------------------------------------------------------------
-- TRIGGERS
--------------------------------------------------------------------------------

-- Auto-update updated_at on saved_source changes
CREATE OR REPLACE FUNCTION update_saved_source_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER saved_source_updated_at
  BEFORE UPDATE ON saved_source
  FOR EACH ROW EXECUTE FUNCTION update_saved_source_timestamp();

--------------------------------------------------------------------------------
-- RLS POLICIES
--------------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE oembed_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_source ENABLE ROW LEVEL SECURITY;

-- oEmbed cache is service-role only (internal cache)
-- No user-facing policies needed

-- Saved sources are user-scoped
CREATE POLICY saved_source_select_own ON saved_source
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY saved_source_insert_own ON saved_source
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY saved_source_update_own ON saved_source
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY saved_source_delete_own ON saved_source
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
