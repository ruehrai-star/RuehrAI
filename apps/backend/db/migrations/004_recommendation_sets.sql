-- KAN-38 / KAN-39 / KAN-42: persisted Top-3 sets for one user.
-- `payload` is the recommendations body without id and createdAt.
-- Ranking reads app.analysis_runs; it does not change the Musteranalyse tables.

CREATE TABLE app.recommendation_sets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  analysis_run_id bigint NOT NULL REFERENCES app.analysis_runs (id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recommendation_sets_user_created_idx
  ON app.recommendation_sets (user_id, created_at DESC, id DESC);
