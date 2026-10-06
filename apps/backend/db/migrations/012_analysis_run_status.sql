-- OpenAPI 0.19.0: honest analysis-run lifecycle.
-- Status was only `completed`. Expand the check and record start / end /
-- failure so GET /analysis/runs/{id} can show queued | running | failed.
-- Existing completed rows keep their status; timestamps copy created_at.

ALTER TABLE app.analysis_runs
  DROP CONSTRAINT analysis_runs_status;

ALTER TABLE app.analysis_runs
  ADD CONSTRAINT analysis_runs_status CHECK (
    status IN ('queued', 'running', 'completed', 'failed')
  );

ALTER TABLE app.analysis_runs
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN failure_reason text;

UPDATE app.analysis_runs
   SET started_at = created_at,
       completed_at = created_at
 WHERE status = 'completed'
   AND started_at IS NULL
   AND completed_at IS NULL;
