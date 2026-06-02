-- Migration: Persistent, cross-user Google Places cache (Postgres L2)
-- Purpose: Replace the in-memory-only PlacesCache (lost on every deploy/restart,
--          not shared across instances or users) with a durable Supabase-backed
--          cache. The same physical location resolves from our DB instead of
--          being re-bought from Google at Enterprise pricing on every request.
--
-- Two complementary caches:
--   1. places_search_cache  -- Nearby/Text Search responses keyed by a quantized
--                              (lat,lng,radius,type-set-hash) cache key. Photo import.
--   2. cached_google_place   -- Per-place enriched fields keyed by google_place_id,
--                              consulted before any Place Details call. Social ingest.
--
-- Both are user-agnostic (place data is the same for everyone) and are accessed
-- only by the backend via the service role key, so RLS is enabled with no
-- user-facing policies (mirrors oembed_cache in 0025_social_ingest.sql).
--
-- Wrapped in a DO block because the remote migration runner cannot prepare
-- multiple statements in one call.

DO $migration$
BEGIN
  ----------------------------------------------------------------------------
  -- 1. Nearby/Text Search response cache
  ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.places_search_cache (
    cache_key   text PRIMARY KEY,
    response    jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_places_search_cache_expires
    ON public.places_search_cache(expires_at);

  COMMENT ON TABLE public.places_search_cache IS
    'Cross-user cache of Google Places Nearby/Text Search responses. '
    'Backend-only (service role); reduces repeat Enterprise-tier search calls.';
  COMMENT ON COLUMN public.places_search_cache.cache_key IS
    'Quantized key: nearby_{lat5}_{lng5}_{radius}_{type_set_hash} or '
    'text_{query}_{lat5}_{lng5}. Stable across deploys and users.';
  COMMENT ON COLUMN public.places_search_cache.response IS
    'Raw places list (array) returned by the Google Places search call.';
  COMMENT ON COLUMN public.places_search_cache.expires_at IS
    'Cache expiry; place sets near a coordinate are stable so TTL is long (~60d).';

  ----------------------------------------------------------------------------
  -- 2. Per-place enriched-fields cache (Place Details by ID)
  ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.cached_google_place (
    google_place_id  text PRIMARY KEY,
    details          jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cached_google_place_expires
    ON public.cached_google_place(expires_at);

  COMMENT ON TABLE public.cached_google_place IS
    'Cross-user cache of enriched Google Place Details keyed by google_place_id. '
    'Backend-only (service role); consulted before any Place Details call.';
  COMMENT ON COLUMN public.cached_google_place.details IS
    'Enriched place fields (name, address, location, city, country, types, etc.).';
  COMMENT ON COLUMN public.cached_google_place.expires_at IS
    'Cache expiry; place metadata is stable so TTL is long (~60d).';

  ----------------------------------------------------------------------------
  -- RLS: backend-only caches, no user-facing policies (mirrors oembed_cache)
  ----------------------------------------------------------------------------
  ALTER TABLE public.places_search_cache ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.cached_google_place ENABLE ROW LEVEL SECURITY;
END;
$migration$;
