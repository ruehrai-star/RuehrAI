export const ANALYSIS_RUN_FAILURE_REASONS = [
  "timeout",
  "pattern_failed",
  "set_save_failed",
  "interrupted",
  "internal_error",
] as const;

export type AnalysisRunFailureReason = (typeof ANALYSIS_RUN_FAILURE_REASONS)[number];

export type AnalysisFailurePhase = "pattern" | "set" | "startup" | "unknown";

const FAILURE_REASON_SET = new Set<string>(ANALYSIS_RUN_FAILURE_REASONS);

export function isAnalysisRunFailureReason(value: string | null | undefined): value is AnalysisRunFailureReason {
  return Boolean(value && FAILURE_REASON_SET.has(value));
}

/** Closed enum for the API. Unknown stored strings (older German copy) become internal_error. */
export function asAnalysisRunFailureReason(value: string | null | undefined): AnalysisRunFailureReason | null {
  if (!value) return null;
  if (isAnalysisRunFailureReason(value)) return value;
  return "internal_error";
}

export function isAnalysisDeadlineError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "ANALYSIS_DEADLINE" || code === "57014";
}

export function analysisDeadlineError(): Error {
  return Object.assign(new Error("analysis run deadline exceeded"), { code: "ANALYSIS_DEADLINE" });
}

/**
 * Map a thrown error to the closed failureReason enum.
 * Technical detail stays in the log, never in the response body.
 */
export function mapAnalysisFailureReason(
  error: unknown,
  phase: AnalysisFailurePhase,
): AnalysisRunFailureReason {
  if (phase === "startup") return "interrupted";
  if (isAnalysisDeadlineError(error)) return "timeout";
  if (phase === "pattern") return "pattern_failed";
  if (phase === "set") return "set_save_failed";
  return "internal_error";
}

export function failureDetailForLog(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "unknown error";
}
