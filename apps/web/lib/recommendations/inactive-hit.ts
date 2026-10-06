import type { Recommendation, RecommendationEvidence } from "@ruehrai/api-contracts";

/**
 * Shown once on a hit that has no own local trend (nAktiv 0).
 * OpenAPI 0.19.5 has no item-level nAktiv field — see isInactiveHit.
 */
export const INACTIVE_HIT_COPY =
  "Für diese Fläche liegen keine eigenen Verlaufsdaten vor. Die Einordnung beruht auf übergeordneten Werten.";

/**
 * True when this evidence is a local trend series (eigener Verlauf).
 * Inherited, Stichtag (`single` / `stichtag`), and absent rows are not.
 */
export function isOwnTrendEvidence(entry: RecommendationEvidence): boolean {
  if (entry.scope === "inherited") return false;
  if (entry.kind === "stichtag" || entry.kind === "absent") return false;
  if (entry.coverage === "single" || entry.coverage === "none") return false;
  return entry.kind === "trend" || entry.coverage === "series" || entry.coverage === "multi";
}

/**
 * No 0.19.5 item field names nAktiv. Inactive = no `criteriaEvidence` with
 * own Verlauf (local trend / series). Matches PO: only inherited or Stichtag.
 */
export function isInactiveHit(item: Pick<Recommendation, "criteriaEvidence">): boolean {
  return !(item.criteriaEvidence ?? []).some(isOwnTrendEvidence);
}
