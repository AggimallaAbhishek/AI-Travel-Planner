-- Hybrid relational schema for data-driven trip planning.
-- Requires PostgreSQL 14+ with PostGIS and pgcrypto.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT '',
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  center_point GEOGRAPHY(POINT, 4326),
  last_ingested_at TIMESTAMPTZ,
  fresh_until TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE RESTRICT,
  days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 30),
  budget_amount INTEGER,
  preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  planning_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_place_id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geo_point GEOGRAPHY(POINT, 4326),
  rating NUMERIC(3, 2),
  price_level TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  fresh_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT places_source_external_unique UNIQUE (source, external_place_id)
);

CREATE TABLE IF NOT EXISTS transport_edges (
  id BIGSERIAL PRIMARY KEY,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  from_place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  to_place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'walk',
  distance_m DOUBLE PRECISION NOT NULL,
  duration_s DOUBLE PRECISION NOT NULL,
  weight DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL DEFAULT 'haversine',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transport_edges_unique UNIQUE (destination_id, from_place_id, to_place_id, mode)
);

CREATE TABLE IF NOT EXISTS trip_place_candidates (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  preference_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  cluster_id INTEGER,
  visit_day INTEGER,
  visit_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, place_id)
);

CREATE TABLE IF NOT EXISTS route_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_no INTEGER NOT NULL,
  algorithm_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid
  ON users (firebase_uid);

CREATE INDEX IF NOT EXISTS idx_trips_user_created_desc
  ON trips (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_places_destination_category_rating
  ON places (destination_id, category, rating DESC);

CREATE INDEX IF NOT EXISTS idx_places_geo_point
  ON places USING GIST (geo_point);

CREATE INDEX IF NOT EXISTS idx_transport_edges_from_mode_weight
  ON transport_edges (from_place_id, mode, weight);

CREATE INDEX IF NOT EXISTS idx_transport_edges_to_mode
  ON transport_edges (to_place_id, mode);

CREATE INDEX IF NOT EXISTS idx_trip_candidates_visit_order
  ON trip_place_candidates (trip_id, visit_day, visit_order);

