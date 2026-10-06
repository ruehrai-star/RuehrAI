/**
 * Musteranalyse process limits. Defaults sit below the ~150 s STAGE gateway
 * and the Web client's ~3 min polling cap.
 */
export const ANALYSIS_ENV_DEFAULTS = {
  runDeadlineMs: 120_000,
  maxConcurrent: 2,
  phaseWarnMs: 5_000,
  statementTimeoutMs: 20_000,
  analysisPoolMax: 2,
  seriesCandidateCap: 400,
  yieldMs: 20,
} as const;

export function readAnalysisRunDeadlineMs(
  read: (name: string) => string | undefined = (name) => process.env[name],
): number {
  return positiveInt(read("ANALYSIS_RUN_DEADLINE_MS"), ANALYSIS_ENV_DEFAULTS.runDeadlineMs);
}

export function readAnalysisMaxConcurrent(
  read: (name: string) => string | undefined = (name) => process.env[name],
): number {
  return positiveInt(read("ANALYSIS_MAX_CONCURRENT"), ANALYSIS_ENV_DEFAULTS.maxConcurrent);
}

export function readAnalysisPhaseWarnMs(
  read: (name: string) => string | undefined = (name) => process.env[name],
): number {
  return positiveInt(read("ANALYSIS_PHASE_WARN_MS"), ANALYSIS_ENV_DEFAULTS.phaseWarnMs);
}

export function readPgStatementTimeoutMs(
  read: (name: string) => string | undefined = (name) => process.env[name],
): number {
  return positiveInt(read("PG_STATEMENT_TIMEOUT_MS"), ANALYSIS_ENV_DEFAULTS.statementTimeoutMs);
}

export function readPgAnalysisPoolMax(
  read: (name: string) => string | undefined = (name) => process.env[name],
): number {
  return positiveInt(read("PG_ANALYSIS_POOL_MAX"), ANALYSIS_ENV_DEFAULTS.analysisPoolMax);
}

export function readAnalysisSeriesCandidateCap(
  read: (name: string) => string | undefined = (name) => process.env[name],
): number {
  return positiveInt(read("ANALYSIS_SERIES_CANDIDATE_CAP"), ANALYSIS_ENV_DEFAULTS.seriesCandidateCap);
}

export function readAnalysisYieldMs(
  read: (name: string) => string | undefined = (name) => process.env[name],
): number {
  return positiveInt(read("ANALYSIS_YIELD_MS"), ANALYSIS_ENV_DEFAULTS.yieldMs);
}

export function readAnalysisUseWorkerThreads(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  const raw = read("ANALYSIS_USE_WORKER_THREADS");
  if (raw === undefined || raw.trim() === "") return true;
  const value = raw.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "no") return false;
  return true;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}
