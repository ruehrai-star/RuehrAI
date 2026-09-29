-- KAN-31 / KAN-35: persisted Musteranalyse runs in schema app.
-- `pattern` is the snapshot a later Top-3 step (KAN-5) can read.
-- This migration does not add recommendation tables or endpoints.

CREATE TABLE app.analysis_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  status text NOT NULL,
  input jsonb NOT NULL,
  brain jsonb NOT NULL,
  pattern jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_runs_status CHECK (status = 'completed')
);

CREATE INDEX analysis_runs_user_created_idx
  ON app.analysis_runs (user_id, created_at DESC, id DESC);
