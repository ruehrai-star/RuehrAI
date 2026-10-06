/** Closed `failureReason` enum → German copy. Never show the key. */

export const ANALYSIS_FAILURE_REASONS = [
  "timeout",
  "pattern_failed",
  "set_save_failed",
  "interrupted",
  "internal_error",
] as const;

export type AnalysisFailureReason = (typeof ANALYSIS_FAILURE_REASONS)[number];

export const ANALYSIS_FAILURE_COPY = {
  prefix: "Analyse fehlgeschlagen: ",
  timeout: "Die Berechnung hat zu lange gedauert.",
  pattern: "Das Muster der Bestandsstandorte konnte nicht berechnet werden.",
  setSave: "Die Trefferliste konnte nicht erstellt werden.",
  interrupted: "Die Analyse wurde unterbrochen.",
  unexpected: "Es ist ein unerwarteter Fehler aufgetreten.",
  restart: "Erneut starten",
} as const;

const REASON_DETAIL: Record<AnalysisFailureReason, string> = {
  timeout: ANALYSIS_FAILURE_COPY.timeout,
  pattern_failed: ANALYSIS_FAILURE_COPY.pattern,
  set_save_failed: ANALYSIS_FAILURE_COPY.setSave,
  interrupted: ANALYSIS_FAILURE_COPY.interrupted,
  internal_error: ANALYSIS_FAILURE_COPY.unexpected,
};

function withPrefix(detail: string): string {
  return `${ANALYSIS_FAILURE_COPY.prefix}${detail}`;
}

function normalizeReasonKey(reason: string): string {
  return reason.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isClosedReason(key: string): key is AnalysisFailureReason {
  return (ANALYSIS_FAILURE_REASONS as readonly string[]).includes(key);
}

/**
 * Map the closed `failureReason` enum to a prefixed German sentence.
 * Unknown values, empty text, SQL, stacks, and codes use the unexpected line.
 */
export function analysisFailureMessage(reason: string | null | undefined): string {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) return withPrefix(ANALYSIS_FAILURE_COPY.unexpected);
  const key = normalizeReasonKey(trimmed);
  if (isClosedReason(key)) return withPrefix(REASON_DETAIL[key]);
  return withPrefix(ANALYSIS_FAILURE_COPY.unexpected);
}

export function analysisFailureFromHttp(status: number, body?: string | null): string {
  if (status === 408 || status === 504 || status === 524) {
    return analysisFailureMessage("timeout");
  }
  if (status === 404) {
    return analysisFailureMessage("internal_error");
  }
  return analysisFailureMessage(body);
}

/** Client 3-minute safety net: same copy as a server `timeout`. */
export function clientDeadlineMessage(): string {
  return analysisFailureMessage("timeout");
}
