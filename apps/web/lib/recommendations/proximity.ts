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
 * `0` is a scored value (gering), not missing. Omitted / null / non-finite / out of 0..1
 * is „liegt nicht vor“.
 */
export function proximityBand(proximity: number | null | undefined): ProximityBand {
  if (typeof proximity !== "number" || !Number.isFinite(proximity) || proximity < 0 || proximity > 1) {
    return PROXIMITY_COPY.missing;
  }
  if (proximity >= PROXIMITY_HIGH) return PROXIMITY_COPY.high;
  if (proximity >= PROXIMITY_MEDIUM) return PROXIMITY_COPY.medium;
  return PROXIMITY_COPY.low;
}

export function proximityLabel(proximity: number | null | undefined): string {
  return `${PROXIMITY_COPY.prefix}: ${proximityBand(proximity)}`;
}

export function proximityLabelFromEvidence(evidence: RecommendationEvidence | undefined): string {
  return proximityLabel(evidence?.proximity);
}
