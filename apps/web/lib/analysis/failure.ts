/** Plain-German messages for a failed Musteranalyse run. Never a raw key. */

export const ANALYSIS_FAILURE_COPY = {
  generic: "Analyse fehlgeschlagen. Bitte erneut versuchen.",
  prefix: "Analyse fehlgeschlagen: ",
  timeout: "Die Berechnung hat zu lange gedauert.",
  cancelled: "Die Analyse wurde abgebrochen.",
  brain: "Die Gebietsdaten konnten nicht gelesen werden.",
  pattern: "Das Muster konnte nicht berechnet werden.",
  recommendations: "Die Trefferliste konnte nicht berechnet werden.",
  revenue: "Die Monatsumsätze reichen für eine Musteranalyse nicht aus.",
  region: "Es ist keine Zielregion gespeichert.",
  deadline: "Die Analyse dauert zu lange. Bitte starten Sie sie erneut.",
  restart: "Erneut starten",
} as const;

type FailureCategory =
  | "timeout"
  | "cancelled"
  | "brain"
  | "pattern"
  | "recommendations"
  | "revenue"
  | "region";

const CATEGORY_DETAIL: Record<FailureCategory, string> = {
  timeout: ANALYSIS_FAILURE_COPY.timeout,
  cancelled: ANALYSIS_FAILURE_COPY.cancelled,
  brain: ANALYSIS_FAILURE_COPY.brain,
  pattern: ANALYSIS_FAILURE_COPY.pattern,
  recommendations: ANALYSIS_FAILURE_COPY.recommendations,
  revenue: ANALYSIS_FAILURE_COPY.revenue,
  region: ANALYSIS_FAILURE_COPY.region,
};

const GENERIC_GERMAN = new Set([
  ANALYSIS_FAILURE_COPY.generic,
  "Die Analyse ist fehlgeschlagen. Bitte erneut versuchen.",
  "Analyse fehlgeschlagen.",
]);

/**
 * Map `failureReason` (or an HTTP error body) to a sentence the user can read.
 * Known categories become a fixed German line. Unknown keys, stacks, SQL, and
 * status codes become the generic sentence. A German backend sentence is kept
 * when it is already safe.
 */
export function analysisFailureMessage(reason: string | null | undefined): string {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) return ANALYSIS_FAILURE_COPY.generic;
  if (GENERIC_GERMAN.has(trimmed)) return ANALYSIS_FAILURE_COPY.generic;

  const keyCategory = failureKeyCategory(trimmed);
  if (keyCategory) return `${ANALYSIS_FAILURE_COPY.prefix}${CATEGORY_DETAIL[keyCategory]}`;
  if (isRawFailureKey(trimmed)) return ANALYSIS_FAILURE_COPY.generic;

  const category = failurePhraseCategory(trimmed);
  if (category) return `${ANALYSIS_FAILURE_COPY.prefix}${CATEGORY_DETAIL[category]}`;
  if (isUnsafeFailureText(trimmed)) return ANALYSIS_FAILURE_COPY.generic;
  if (/^Analyse fehlgeschlagen\b/i.test(trimmed)) return trimmed;
  return `${ANALYSIS_FAILURE_COPY.prefix}${trimmed}`;
}

export function analysisFailureFromHttp(status: number, body?: string | null): string {
  if (status === 408 || status === 504 || status === 524) {
    return `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`;
  }
  return analysisFailureMessage(body);
}

function failureKeyCategory(reason: string): FailureCategory | null {
  const key = reason.toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "timeout" || key === "timed_out" || key === "deadline" || key === "gateway_timeout") {
    return "timeout";
  }
  if (key === "cancelled" || key === "canceled" || key === "aborted") return "cancelled";
  if (key === "brain" || key === "brain_failed" || key === "brain_search_failed") return "brain";
  if (key === "pattern" || key === "pattern_failed") return "pattern";
  if (key === "recommendations" || key === "recommendations_failed") return "recommendations";
  if (key === "revenue" || key === "revenue_insufficient" || key === "insufficient_revenue") return "revenue";
  if (key === "region" || key === "region_missing" || key === "no_target_region") return "region";
  if (key === "504" || key === "408" || key === "524") return "timeout";
  return null;
}

function failurePhraseCategory(reason: string): FailureCategory | null {
  const compact = reason.replace(/\s+/g, " ").trim();
  if (/umsatz/i.test(compact)) return "revenue";
  if (/keine zielregion/i.test(compact)) return "region";
  if (/timeout|timed[_ -]?out|deadline|gateway.?timeout|etimedout|zu lange( gedauert)?/i.test(compact)) {
    return "timeout";
  }
  if (/cancel+ed|aborted|abgebrochen/i.test(compact)) return "cancelled";
  if (
    /brain|vector|embedding|gebietsdaten|brain[-_ ]suche/i.test(compact) &&
    !/sql|select |postgres/i.test(compact)
  ) {
    return "brain";
  }
  if (/trefferliste|empfehlungen.*(fehl|nicht)/i.test(compact)) return "recommendations";
  if (/\bmuster\b(?!analyse)/i.test(compact) && /(fehl|nicht)/i.test(compact)) return "pattern";
  return null;
}

function isRawFailureKey(reason: string): boolean {
  return /^[a-z][a-z0-9]+(?:[_:-][a-z0-9]+)+$/i.test(reason) || /^[A-Z][A-Z0-9_]{2,}$/.test(reason);
}

function isUnsafeFailureText(reason: string): boolean {
  if (/\b(select|insert|update|delete|from|where|join)\b/i.test(reason)) return true;
  if (/\b(postgres|sqlstate|syntax error|relation "|column ")/i.test(reason)) return true;
  if (/\bat\s+\S+\.\S+\s*\(/.test(reason) || /\n\s+at\s+/.test(reason)) return true;
  if (/\{[\s\S]*"stack"[\s\S]*\}/.test(reason)) return true;
  if (/\/(?:src|apps|node_modules)\//.test(reason)) return true;
  if (/^(?:error|exception|errno|econn|eai_):/i.test(reason)) return true;
  if (isRawFailureKey(reason)) return true;
  if (/^[0-9]{2}[A-Z0-9]{3}$/i.test(reason)) return true;
  if (/^[0-9]{3}$/.test(reason)) return true;
  return false;
}
