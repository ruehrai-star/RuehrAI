-- Brain (lokale Postgres-Datenbank auf dem RuehrAI Mac), nicht Supabase.
-- Lebender Stand 2026-09-28, eine Datei:
--   1. Initial-Create der Feature-Docs (zuerst in public, pgvector 0.8.6)
--   2. Angewendete Migration 03_features_schema: Schemas features + app,
--      MOVE public → features, Spalten name/lon/lat/source_theme,
--      View features.v_location_search, Rolle backend_ro_features (NOLOGIN).
-- Idempotent. Keine LOGIN-Rolle, kein Passwort, kein Connection-String.
-- Connect über DATABASE_URL als ruehrai, danach SET ROLE backend_ro_features.
-- embedding vector(1536) ist nach dem ersten Batch überall NULL; kein HNSW/IVFFlat.
-- name ist für die 10786 Zensus-ags-Docs gefüllt; lon/lat/source_theme sind NULL.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS features;
CREATE SCHEMA IF NOT EXISTS app;

-- Move tables from public → features (no-op if already moved or never created in public)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'location_feature_docs'
  ) THEN
    ALTER TABLE public.location_feature_docs SET SCHEMA features;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'embedding_jobs'
  ) THEN
    ALTER TABLE public.embedding_jobs SET SCHEMA features;
  END IF;
END $$;

-- Safety: move orphaned sequences if still in public
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'location_feature_docs_id_seq'
      AND c.relkind = 'S'
  ) THEN
    ALTER SEQUENCE public.location_feature_docs_id_seq SET SCHEMA features;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'embedding_jobs_id_seq'
      AND c.relkind = 'S'
  ) THEN
    ALTER SEQUENCE public.embedding_jobs_id_seq SET SCHEMA features;
  END IF;
END $$;

-- Fresh Brain: create the live tables in features (skipped when the MOVE above already ran)
CREATE TABLE IF NOT EXISTS features.location_feature_docs (
  id bigserial PRIMARY KEY,
  geo_key text NOT NULL,
  grain text NOT NULL CHECK (grain IN ('address','grid100','plz8','plz5','ags','ags5','other')),
  ref_period text,
  title text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  source_tables text[] NOT NULL DEFAULT '{}',
  supabase_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name text,
  lon double precision,
  lat double precision,
  source_theme text
);

CREATE UNIQUE INDEX IF NOT EXISTS location_feature_docs_geo_uniq
  ON features.location_feature_docs (geo_key, grain, (COALESCE(ref_period, '')));

CREATE INDEX IF NOT EXISTS location_feature_docs_grain_idx
  ON features.location_feature_docs (grain);
CREATE INDEX IF NOT EXISTS location_feature_docs_geo_key_idx
  ON features.location_feature_docs (geo_key);
CREATE INDEX IF NOT EXISTS location_feature_docs_ref_period_idx
  ON features.location_feature_docs (ref_period);

CREATE TABLE IF NOT EXISTS features.embedding_jobs (
  id bigserial PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ok','failed')),
  started_at timestamptz,
  finished_at timestamptz,
  row_count bigint,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tables moved from the initial public create lack the Backend columns
ALTER TABLE features.location_feature_docs
  ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE features.location_feature_docs
  ADD COLUMN IF NOT EXISTS lon double precision;
ALTER TABLE features.location_feature_docs
  ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE features.location_feature_docs
  ADD COLUMN IF NOT EXISTS source_theme text;

-- Backfill display name from metadata
UPDATE features.location_feature_docs
SET name = metadata->>'gemeinde_name'
WHERE name IS NULL
  AND metadata->>'gemeinde_name' IS NOT NULL;

-- Backend /search projection (embedding nullable; unused until filled)
CREATE OR REPLACE VIEW features.v_location_search AS
SELECT
  id,
  geo_key,
  grain,
  ref_period,
  name,
  title,
  lon,
  lat,
  source_theme,
  source_tables,
  metadata,
  supabase_synced_at,
  embedding
FROM features.location_feature_docs;

-- Read-only role for Backend (NOLOGIN — SET ROLE from ruehrai / DATABASE_URL user)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backend_ro_features') THEN
    CREATE ROLE backend_ro_features NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA features TO backend_ro_features;
GRANT SELECT ON ALL TABLES IN SCHEMA features TO backend_ro_features;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA features TO backend_ro_features;

ALTER DEFAULT PRIVILEGES FOR ROLE ruehrai IN SCHEMA features
  GRANT SELECT ON TABLES TO backend_ro_features;
ALTER DEFAULT PRIVILEGES FOR ROLE ruehrai IN SCHEMA features
  GRANT SELECT ON SEQUENCES TO backend_ro_features;

GRANT backend_ro_features TO ruehrai;

-- app schema placeholder: Backend owns DDL later; ruehrai may CREATE
GRANT USAGE, CREATE ON SCHEMA app TO ruehrai;

COMMIT;
