import type { RecommendationEvidence } from "@ruehrai/api-contracts";

/**
 * Visible copy when a dataset trend is based on only two years.
 * Three years remain the normal case; this hint is additive.
 */
export const TWO_YEAR_TREND_LABEL = "Trend aus 2 Jahren";

/**
 * Isolated adapter for the 2-year trend hint on a dataset.
 * Uses official `RecommendationEvidence.trendYears === 2`.
 * `trendFromTwoYears` is equivalent when present. Does not count `points`.
 */
export function twoYearTrendLabelFromEvidence(evidence: RecommendationEvidence | undefined): string | null {
  if (!evidence) return null;
  if (evidence.kind === "stichtag" || evidence.kind === "absent") return null;
  if (evidence.coverage === "single" || evidence.coverage === "none") return null;
  return formatTwoYearTrendLabel(evidence.trendYears === 2 || evidence.trendFromTwoYears === true);
}

/** Exact UI text. */
export function formatTwoYearTrendLabel(isTwoYearTrend: boolean): string | null {
  return isTwoYearTrend ? TWO_YEAR_TREND_LABEL : null;
}
