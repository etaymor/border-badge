-- Phase 1: Core schema for Border Badge travel app
-- Creates all tables, enums, indexes, and triggers

--------------------------------------------------------------------------------
-- ENUMS
--------------------------------------------------------------------------------

-- Country recognition status for filtering
CREATE TYPE country_recognition AS ENUM (
  'un_member',      -- 193 UN member states
  'observer',       -- Vatican, Palestine
  'disputed',       -- Kosovo, Taiwan
  'territory'       -- Bermuda, Zanzibar, etc. (future)
);

-- User-country association status
CREATE TYPE user_country_status AS ENUM ('visited', 'wishlist');

-- Trip tag consent status
CREATE TYPE trip_tag_status AS ENUM ('pending', 'approved', 'declined');

-- Entry type categories
CREATE TYPE entry_type AS ENUM ('place', 'food', 'stay', 'experience');

-- Media file processing status
CREATE TYPE media_status AS ENUM ('processing', 'uploaded', 'failed');

--------------------------------------------------------------------------------
-- TABLES
--------------------------------------------------------------------------------

-- Country table (global reference data)
CREATE TABLE country (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  flag_url TEXT,
  recognition country_recognition NOT NULL DEFAULT 'un_member'
);

CREATE INDEX idx_country_region ON country(region);
CREATE INDEX idx_country_recognition ON country(recognition);

-- User profile (extends Supabase auth.users)
CREATE TABLE user_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_profile_user ON user_profile(user_id);
CREATE INDEX idx_user_profile_is_test ON user_profile(is_test) WHERE is_test = true;

-- User-country associations (visited/wishlist)
CREATE TABLE user_countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES country(id) ON DELETE CASCADE,
  status user_country_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, country_id)
);

CREATE INDEX idx_user_countries_user_status ON user_countries(user_id, status);

-- Trip table
CREATE TABLE trip (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES country(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  cover_image_url TEXT,
  date_range DATERANGE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_user_country ON trip(user_id, country_id);
CREATE INDEX idx_trip_user_created ON trip(user_id, created_at DESC);

-- Trip tags (consent workflow for tagged users)
CREATE TABLE trip_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  tagged_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status trip_tag_status NOT NULL DEFAULT 'pending',
  initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notification_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE(trip_id, tagged_user_id)
);

CREATE INDEX idx_trip_tags_tagged_user ON trip_tags(tagged_user_id, status);
CREATE INDEX idx_trip_tags_trip ON trip_tags(trip_id, status);

-- Entry table (places, food, stays, experiences within a trip)
CREATE TABLE entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  type entry_type NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  metadata JSONB,
  date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entry_trip_date ON entry(trip_id, date);
CREATE INDEX idx_entry_trip_type ON entry(trip_id, type);

-- Place table (Google Places enrichment for place-type entries)
CREATE TABLE place (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID UNIQUE REFERENCES entry(id) ON DELETE CASCADE,
  google_place_id TEXT,
  place_name TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  address TEXT,
  extra_data JSONB
);

CREATE INDEX idx_place_google_id ON place(google_place_id);

-- Media files table (photos and attachments)
CREATE TABLE media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES entry(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trip(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  exif JSONB,
  status media_status NOT NULL DEFAULT 'processing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_must_have_parent CHECK (entry_id IS NOT NULL OR trip_id IS NOT NULL)
);

CREATE INDEX idx_media_owner_created ON media_files(owner_id, created_at DESC);
CREATE INDEX idx_media_entry ON media_files(entry_id);
CREATE INDEX idx_media_trip ON media_files(trip_id);
CREATE INDEX idx_media_status ON media_files(status);

--------------------------------------------------------------------------------
-- TRIGGERS
--------------------------------------------------------------------------------

-- Auto-create user_profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profile (user_id, display_name, is_test)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email LIKE '%+test@%'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
