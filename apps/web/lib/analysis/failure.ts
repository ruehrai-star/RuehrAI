/** Closed OpenAPI `AnalysisRunFailureReason` → German copy. Never show the key. */

import type { AnalysisRun } from "@ruehrai/api-contracts";

export type AnalysisRunFailureReason = NonNullable<AnalysisRun["failureReason"]>;

/** Must stay identical to OpenAPI `AnalysisRunFailureReason`. */
export const ANALYSIS_RUN_FAILURE_REASONS = [
  "timeout",
  "pattern_failed",
  "set_save_failed",
  "interrupted",
  "internal_error",
] as const satisfies readonly AnalysisRunFailureReason[];

type MissingReason = Exclude<AnalysisRunFailureReason, (typeof ANALYSIS_RUN_FAILURE_REASONS)[number]>;
const _exhaustiveReasons: MissingReason extends never ? true : never = true;
void _exhaustiveReasons;

export const ANALYSIS_FAILURE_COPY = {
  prefix: "Analyse fehlgeschlagen: ",
  timeout: "Die Berechnung hat zu lange gedauert.",
  pattern: "Das Muster der Bestandsstandorte konnte nicht berechnet werden.",
  setSave: "Die Trefferliste konnte nicht erstellt werden.",
  interrupted: "Die Analyse wurde unterbrochen.",
  unexpected: "Es ist ein unerwarteter Fehler aufgetreten.",
  restart: "Erneut starten",
} as const;

const REASON_DETAIL: Record<AnalysisRunFailureReason, string> = {
  timeout: ANALYSIS_FAILURE_COPY.timeout,
  pattern_failed: ANALYSIS_FAILURE_COPY.pattern,
  set_save_failed: ANALYSIS_FAILURE_COPY.setSave,
  interrupted: ANALYSIS_FAILURE_COPY.interrupted,
  internal_error: ANALYSIS_FAILURE_COPY.unexpected,
};

const REASON_SET = new Set<string>(ANALYSIS_RUN_FAILURE_REASONS);

function withPrefix(detail: string): string {
  return `${ANALYSIS_FAILURE_COPY.prefix}${detail}`;
}

export function isAnalysisRunFailureReason(value: string): value is AnalysisRunFailureReason {
  return REASON_SET.has(value);
}

/**
 * Map the closed `failureReason` enum to a prefixed German sentence.
 * Unknown values use the unexpected line. Keys are never shown.
 */
export function analysisFailureMessage(reason: string | null | undefined): string {
  if (typeof reason !== "string") return withPrefix(ANALYSIS_FAILURE_COPY.unexpected);
  if (isAnalysisRunFailureReason(reason)) return withPrefix(REASON_DETAIL[reason]);
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
