-- Affiliate outbound redirect service tables
-- Creates tables for link definitions, click logs, and partner mappings

--------------------------------------------------------------------------------
-- ENUMS
--------------------------------------------------------------------------------

-- Link status for enabling/disabling redirects
CREATE TYPE outbound_link_status AS ENUM ('active', 'paused', 'archived');

-- Resolution path for analytics
CREATE TYPE resolution_path AS ENUM ('direct_partner', 'skimlinks', 'original');

--------------------------------------------------------------------------------
-- TABLES
--------------------------------------------------------------------------------

-- Outbound link definitions
-- Each entry with a link or place can have an outbound_link for affiliate routing
CREATE TABLE outbound_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES entry(id) ON DELETE CASCADE,
  destination_url TEXT NOT NULL,
  partner_slug TEXT,
  affiliate_url TEXT,
  status outbound_link_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outbound_link_entry_unique UNIQUE (entry_id)
);

CREATE INDEX idx_outbound_link_entry ON outbound_link(entry_id);
CREATE INDEX idx_outbound_link_status ON outbound_link(status) WHERE status = 'active';
CREATE INDEX idx_outbound_link_partner ON outbound_link(partner_slug) WHERE partner_slug IS NOT NULL;

COMMENT ON TABLE outbound_link IS 'Affiliate link definitions for monetizing outbound clicks';
COMMENT ON COLUMN outbound_link.destination_url IS 'Original destination URL before affiliate wrapping';
COMMENT ON COLUMN outbound_link.partner_slug IS 'Partner identifier (booking, tripadvisor, getyourguide, skimlinks)';
COMMENT ON COLUMN outbound_link.affiliate_url IS 'Cached affiliate-wrapped URL for fast redirects';

-- Outbound click logs
-- Records every redirect attempt for analytics
CREATE TABLE outbound_click (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES outbound_link(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trip(id) ON DELETE SET NULL,
  entry_id UUID REFERENCES entry(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  resolution resolution_path NOT NULL,
  destination_url TEXT NOT NULL,
  user_agent TEXT,
  ip_country TEXT,
  referer TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbound_click_link ON outbound_click(link_id);
CREATE INDEX idx_outbound_click_date ON outbound_click(clicked_at DESC);
CREATE INDEX idx_outbound_click_trip ON outbound_click(trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX idx_outbound_click_resolution ON outbound_click(resolution);
CREATE INDEX idx_outbound_click_source ON outbound_click(source);

COMMENT ON TABLE outbound_click IS 'Click log for affiliate redirect analytics';
COMMENT ON COLUMN outbound_click.source IS 'Click source context (trip_share, list_share, in_app)';
COMMENT ON COLUMN outbound_click.resolution IS 'How the URL was resolved (direct_partner, skimlinks, original)';
COMMENT ON COLUMN outbound_click.ip_country IS 'Country code derived from IP (no raw IP stored for privacy)';

-- Partner mappings for direct affiliate matching
-- Maps entries/places to specific partner property IDs
CREATE TABLE partner_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES entry(id) ON DELETE CASCADE,
  google_place_id TEXT,
  partner_slug TEXT NOT NULL,
  partner_property_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.0,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_mapping_unique UNIQUE (entry_id, partner_slug)
);

CREATE INDEX idx_partner_mapping_entry ON partner_mapping(entry_id);
CREATE INDEX idx_partner_mapping_place ON partner_mapping(google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX idx_partner_mapping_partner ON partner_mapping(partner_slug);
CREATE INDEX idx_partner_mapping_confidence ON partner_mapping(confidence DESC);

COMMENT ON TABLE partner_mapping IS 'Maps entries/places to partner property IDs for direct affiliate links';
COMMENT ON COLUMN partner_mapping.confidence IS 'Match confidence score (0.0-1.0) from resolver';
COMMENT ON COLUMN partner_mapping.is_verified IS 'True if mapping was manually verified';

-- Skimlinks URL cache
-- Caches wrapped URLs to reduce API calls
CREATE TABLE skimlinks_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_url TEXT NOT NULL UNIQUE,
  wrapped_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_skimlinks_cache_url ON skimlinks_cache(original_url);
CREATE INDEX idx_skimlinks_cache_expires ON skimlinks_cache(expires_at);

COMMENT ON TABLE skimlinks_cache IS 'Cache for Skimlinks-wrapped URLs to reduce API calls';

--------------------------------------------------------------------------------
-- TRIGGERS
--------------------------------------------------------------------------------

-- Auto-update updated_at on outbound_link changes
CREATE OR REPLACE FUNCTION update_outbound_link_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbound_link_updated_at
  BEFORE UPDATE ON outbound_link
  FOR EACH ROW EXECUTE FUNCTION update_outbound_link_timestamp();

-- Auto-update updated_at on partner_mapping changes
CREATE TRIGGER partner_mapping_updated_at
  BEFORE UPDATE ON partner_mapping
  FOR EACH ROW EXECUTE FUNCTION update_outbound_link_timestamp();

--------------------------------------------------------------------------------
-- RLS POLICIES
--------------------------------------------------------------------------------

-- All affiliate tables are service-role only (no user access)
-- Public pages use service role to generate redirect URLs

ALTER TABLE outbound_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_click ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE skimlinks_cache ENABLE ROW LEVEL SECURITY;

-- Service role has full access (implicit through SECURITY DEFINER or service role key)
-- No user-facing policies needed since these are internal tables
