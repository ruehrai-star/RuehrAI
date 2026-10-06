import type { RecommendationEvidence } from "@ruehrai/api-contracts";

/** German bands for `RecommendationEvidence.proximity` (OpenAPI 0.19.4). Never the raw 0..1 number. */
export const PROXIMITY_COPY = {
  prefix: "Nähe zum Filialmuster",
  high: "hoch",
  medium: "mittel",
  low: "gering",
  missing: "liegt nicht vor",
} as const;

export const PROXIMITY_HIGH = 0.67;
export const PROXIMITY_MEDIUM = 0.34;

export type ProximityBand = (typeof PROXIMITY_COPY)["high" | "medium" | "low" | "missing"];

/**
 * Maps official `criteriaEvidence[].proximity` to the UX band.
 * `0` is a scored value (gering), not missing.
 */
export function proximityBand(proximity: number | null | undefined): ProximityBand {
  if (!isScoredProximity(proximity)) return PROXIMITY_COPY.missing;
  if (proximity >= PROXIMITY_HIGH) return PROXIMITY_COPY.high;
  if (proximity >= PROXIMITY_MEDIUM) return PROXIMITY_COPY.medium;
  return PROXIMITY_COPY.low;
}

export function proximityLabel(proximity: number | null | undefined): string {
  return `${PROXIMITY_COPY.prefix}: ${proximityBand(proximity)}`;
}

/**
 * Visible Nähe-Zeile for one dataset.
 *
 * - Evidence absent (no row / `kind: absent` / `coverage: none`): „liegt nicht vor“.
 * - `scope: inherited` or present-but-neutral (proximity omitted): hide the line.
 * - Scored 0..1 including `0`: hoch / mittel / gering, never the raw number.
 */
export function proximityLabelFromEvidence(evidence: RecommendationEvidence | undefined): string | null {
  if (evidence?.scope === "inherited") return null;
  if (!evidence || evidence.kind === "absent" || evidence.coverage === "none") {
    return proximityLabel(undefined);
  }
  if (!isScoredProximity(evidence.proximity)) return null;
  return proximityLabel(evidence.proximity);
}

function isScoredProximity(proximity: number | null | undefined): proximity is number {
  return typeof proximity === "number" && Number.isFinite(proximity) && proximity >= 0 && proximity <= 1;
}
