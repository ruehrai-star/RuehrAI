import type { RecommendationEvidence } from "@ruehrai/api-contracts";

/**
 * Visible copy when a dataset trend is based on only two years.
 * Three years remain the normal case; this hint is additive.
 */
export const TWO_YEAR_TREND_LABEL = "Trend aus 2 Jahren";

/**
 * Isolated adapter for the 2-year trend hint on a dataset.
 *
 * TODO(#79): bind to the official OpenAPI field on `RecommendationEvidence`
 * once #79 adds it. Do not invent a field name. Do not count `points`.
 *
 * Until that field exists this always returns `null`, so the UI stays empty
 * rather than guessing from coverage or series length.
 */
export function twoYearTrendLabelFromEvidence(evidence: RecommendationEvidence | undefined): string | null {
  return formatTwoYearTrendLabel(readOfficialTwoYearTrend(evidence));
}

/** Exact UI text. Used by tests and by the adapter once the contract field lands. */
export function formatTwoYearTrendLabel(isTwoYearTrend: boolean): string | null {
  return isTwoYearTrend ? TWO_YEAR_TREND_LABEL : null;
}

function readOfficialTwoYearTrend(evidence: RecommendationEvidence | undefined): boolean {
  // TODO(#79): return the official contract field here. No guessed key, no points length.
  void evidence;
  return false;
}
