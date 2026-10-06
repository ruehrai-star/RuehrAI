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

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}
