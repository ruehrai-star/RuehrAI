-- Brain STAGE (Eule, Postgres.app, Datenbank Brain). Stand 2026-10-04.
-- Lebender Vertrag für features / app / backend_ro_features.
-- Nicht ausführen gegen PROD (Fuchs). Kein Passwort, kein Connection-String.
--
-- Historie, weiterhin idempotent:
--   1. Initial-Create der Feature-Docs (zuerst public), pgvector.
--   2. Migration 03_features_schema: Schemas features + app, MOVE public → features,
--      Spalten name/lon/lat/source_theme, View features.v_location_search,
--      Rolle backend_ro_features NOLOGIN.
-- Live-Typ des Embedding ist vector(1024). Dieses Skript ändert eine bestehende
-- vector(1536)-Spalte nicht per ALTER TYPE. HNSW cosine ist angelegt.
-- PostGIS 3.6.3 liegt auf Brain für Schema geo. Geo-Tabellen-DDL steht nicht hier.
-- Connect über DATABASE_URL als ruehrai, danach SET ROLE backend_ro_features.
-- Eindeutigkeit: (geo_key, grain, COALESCE(ref_period, '')).
-- Kollidierende Zeiträume nutzen ein Themen-Suffix in ref_period (Beispiel 2025-12|bka).

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- PostGIS bedient den Katalogspiegel in Schema geo, nicht die Feature-Docs.
CREATE EXTENSION IF NOT EXISTS postgis;

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

-- Fresh Brain: create the live tables in features (skipped when the MOVE above already ran).
-- Grains: address, grid100, plz8, plz5, ags, ags5, other.
CREATE TABLE IF NOT EXISTS features.location_feature_docs (
  id bigserial PRIMARY KEY,
  geo_key text NOT NULL,
  grain text NOT NULL CHECK (grain IN ('address','grid100','plz8','plz5','ags','ags5','other')),
  ref_period text,
  title text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1024),
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

-- Cosine HNSW on Brain STAGE. NULL embeddings stay out of the index.
-- Queries through features.v_location_search use this index.
CREATE INDEX IF NOT EXISTS location_feature_docs_embedding_hnsw
  ON features.location_feature_docs
  USING hnsw (embedding vector_cosine_ops);

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

-- Backfill display name where metadata carries gemeinde_name. No-op once filled.
UPDATE features.location_feature_docs
SET name = metadata->>'gemeinde_name'
WHERE name IS NULL
  AND metadata->>'gemeinde_name' IS NOT NULL;

-- Backend /search projection. Column list unchanged. embedding is vector(1024), nullable.
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

-- Schema app is Backend-owned and already has live tables.
-- Those CREATE TABLE statements are not in this file.
-- ruehrai keeps USAGE, CREATE from the applied features migration.
GRANT USAGE, CREATE ON SCHEMA app TO ruehrai;

-- Schema geo (catalog mirror, not feature docs) is queried on Brain STAGE:
--   geo.geo_ref_plz, geo.geo_ref_bezirk, geo.geo_ref_ortsteil, geo.geo_ref_admin.
-- backend_ro_features has SELECT on those tables. Their DDL is not in this file.

COMMIT;
