-- Brain (lokale Postgres-Datenbank auf dem RuehrAI Mac), nicht Supabase.
-- Angewendet 2026-09-28, idempotent. Extension pgvector 0.8.6.
-- Rolle ruehrai, Datenbank Brain, localhost:5432. Credentials nur im Secret-Store.
-- embedding vector(1536) ist nach dem ersten Batch überall NULL; kein HNSW/IVFFlat.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS location_feature_docs (
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
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS location_feature_docs_geo_uniq
  ON location_feature_docs (geo_key, grain, (COALESCE(ref_period, '')));

CREATE INDEX IF NOT EXISTS location_feature_docs_grain_idx ON location_feature_docs (grain);
CREATE INDEX IF NOT EXISTS location_feature_docs_geo_key_idx ON location_feature_docs (geo_key);
CREATE INDEX IF NOT EXISTS location_feature_docs_ref_period_idx ON location_feature_docs (ref_period);

CREATE TABLE IF NOT EXISTS embedding_jobs (
  id bigserial PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ok','failed')),
  started_at timestamptz,
  finished_at timestamptz,
  row_count bigint,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
