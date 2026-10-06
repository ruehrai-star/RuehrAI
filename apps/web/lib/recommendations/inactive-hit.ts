import type { Recommendation, RecommendationEvidence } from "@ruehrai/api-contracts";

/**
 * Shown once on a hit that has no own local Verlauf (nAktiv 0):
 * „Für diese Fläche liegen keine eigenen Verlaufsdaten vor. Die
 * Einordnung beruht auf übergeordneten Werten.“
 * OpenAPI 0.19.6: bind to `items[].localDatasetCount === 0`.
 */
export const INACTIVE_HIT_COPY =
  "Für diese Fläche liegen keine eigenen Verlaufsdaten vor. Die Einordnung beruht auf übergeordneten Werten.";

/**
 * True when this evidence is a local trend series (eigener Verlauf).
 * Inherited, Stichtag (`single` / `stichtag`), and absent rows are not.
 * Fallback only — new sets use `localDatasetCount`, not this heuristic.
 */
export function isOwnTrendEvidence(entry: RecommendationEvidence): boolean {
  if (entry.scope === "inherited") return false;
  if (entry.kind === "stichtag" || entry.kind === "absent") return false;
  if (entry.coverage === "single" || entry.coverage === "none") return false;
  return entry.kind === "trend" || entry.coverage === "series" || entry.coverage === "multi";
}

/**
 * Official OpenAPI 0.19.6 nAktiv on this item. Integer ≥ 0 on new sets;
 * omitted on older stored rows. `0` is a real count, not missing.
 */
export function hasLocalDatasetCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Inactive card when nAktiv is 0.
 *
 * - `localDatasetCount === 0` → inactive
 * - `localDatasetCount > 0` → active (do not apply the evidence heuristic)
 * - field missing (older sets) → no `criteriaEvidence` with own Verlauf
 */
export function isInactiveHit(
  item: Pick<Recommendation, "criteriaEvidence" | "localDatasetCount">,
): boolean {
  if (hasLocalDatasetCount(item.localDatasetCount)) {
    return item.localDatasetCount === 0;
  }
  return !(item.criteriaEvidence ?? []).some(isOwnTrendEvidence);
}
