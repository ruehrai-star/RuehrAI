/** Closed OpenAPI `AnalysisRunFailureReason` → German copy. Never show the key. */

import type { AnalysisRun } from "@ruehrai/api-contracts";
import { ApiError } from "../api/types.ts";

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
  tooManyTargetRegions: "Bitte wählen Sie höchstens 200 Zielregionen.",
  markedTargetRegionMissing: "Diese Zielregion ist nicht mehr gespeichert. Bitte wählen Sie sie neu.",
  chooseTargetRegion: "Zielregion wählen",
} as const;

/** OpenAPI ErrorResponse.code on POST /analysis/runs for an unknown/foreign mark. */
export const MARKED_TARGET_REGION_NOT_FOUND_CODE = "marked_target_region_not_found";

export const CHOOSE_TARGET_REGION_HREF = "/standorte#zielregion";

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

/**
 * HTTP mapping for a *final* failure. Gateway 502/504 on GET are not final
 * (see `isTransientPollError`). Timeout copy is never derived from a status
 * code — only from `failureReason=timeout` or the 180 s client deadline.
 *
 * POST `/analysis/runs` 400 for more than 200 Zielregionen is a user-facing
 * limit, not a run `failureReason` — show the German sentence, not the
 * generic unexpected line.
 *
 * POST `/analysis/runs` 404 with `code` `marked_target_region_not_found`
 * means the marked geoKey is gone from the saved list. Other 404s stay
 * the generic unexpected line.
 */
export function analysisFailureFromHttp(
  status: number,
  body?: string | null,
  code?: string | null,
): string {
  if (status === 404 && isMarkedTargetRegionNotFoundCode(code)) {
    return ANALYSIS_FAILURE_COPY.markedTargetRegionMissing;
  }
  if (status === 404) {
    return analysisFailureMessage("internal_error");
  }
  if (status === 400 && isTooManyTargetRegionsMessage(body)) {
    return ANALYSIS_FAILURE_COPY.tooManyTargetRegions;
  }
  return analysisFailureMessage(body);
}

export function isMarkedTargetRegionNotFoundCode(code?: string | null): boolean {
  return typeof code === "string" && code.trim() === MARKED_TARGET_REGION_NOT_FOUND_CODE;
}

export function isMarkedTargetRegionNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && isMarkedTargetRegionNotFoundCode(error.code);
}

function isTooManyTargetRegionsMessage(body: string | null | undefined): boolean {
  if (typeof body !== "string" || body.trim().length === 0) return false;
  const text = body.toLowerCase();
  const mentionsRegions = /zielregion/.test(text) || /target[\s_-]?region/.test(text);
  const mentionsLimit =
    /\b200\b/.test(text) ||
    /too many/.test(text) ||
    /höchstens/.test(text) ||
    /max(imum)?/.test(text) ||
    /limit/.test(text);
  return mentionsRegions && mentionsLimit;
}

/** Client 180 s safety net: same copy as a server `timeout`. */
export function clientDeadlineMessage(): string {
  return analysisFailureMessage("timeout");
}
