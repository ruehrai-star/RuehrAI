import { buildPatternByDataset } from "../analysis/pattern-profile";
import { PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate } from "./area-candidates";
import { localDatasetCountOf, rankTeilflaechen } from "./score";
import { leaveOneOutTopN } from "./score-formula";

export const LOO_MIN_STORES = 3;

export interface LeaveOneOutStore {
  geoKey: string;
  title: string;
}

export interface LeaveOneOutRow {
  title: string;
  geoKey: string;
  rank: number | null;
  topN: number;
  passed: boolean;
  score: number | null;
  nAktiv: number;
}

export interface LeaveOneOutReport {
  passed: boolean;
  storeCount: number;
  candidateCount: number;
  rows: LeaveOneOutRow[];
  abortedReason?: string;
}

export function assertEnoughLooStores(stores: LeaveOneOutStore[]): void {
  if (stores.length < LOO_MIN_STORES) {
    throw Object.assign(new Error(`Leave-one-out braucht mindestens ${LOO_MIN_STORES} Bestandsfilialen.`), {
      code: "LOO_TOO_FEW_STORES",
      storeCount: stores.length,
    });
  }
}

/**
 * Rebuild the store-surroundings pattern without each store and check that
 * the left-out store area stays in Top-N of its region (N = max(3, ceil(n/10))).
 * Failure is calibration, not PROD.
 */
export function evaluateLeaveOneOut(input: {
  stores: LeaveOneOutStore[];
  pool: AreaCandidate[];
  yearlyFor: (geoKeys: string[]) => YearlySeries[];
  criteria: PatternCriterion[];
  targetRegionGeoKey: string;
}): LeaveOneOutReport {
  assertEnoughLooStores(input.stores);
  const allKeys = [...new Set([...input.stores.map((store) => store.geoKey), ...input.pool.map((item) => item.geoKey)])];
  const rows: LeaveOneOutRow[] = [];
  for (const leftOut of input.stores) {
    const remaining = input.stores.filter((store) => store.geoKey !== leftOut.geoKey);
    const patternByDataset = buildPatternByDataset(input.yearlyFor(remaining.map((store) => store.geoKey)));
    const ranked = rankTeilflaechen(input.pool, input.yearlyFor(allKeys), input.criteria, [], {
      patternByDataset,
    });
    const regionHits = ranked.filter((item) => item.targetRegionGeoKey === input.targetRegionGeoKey);
    const index = regionHits.findIndex((item) => item.location.geoKey === leftOut.geoKey);
    const topN = leaveOneOutTopN(regionHits.length);
    const hit = index >= 0 ? regionHits[index] : undefined;
    rows.push({
      title: leftOut.title,
      geoKey: leftOut.geoKey,
      rank: index >= 0 ? index + 1 : null,
      topN,
      passed: index >= 0 && index < topN,
      score: hit?.score ?? null,
      nAktiv: hit ? localDatasetCountOf(hit.criteriaEvidence) : 0,
    });
  }
  return {
    passed: rows.every((row) => row.passed),
    storeCount: input.stores.length,
    candidateCount: input.pool.length,
    rows,
  };
}

export function formatLeaveOneOutMarkdown(report: LeaveOneOutReport): string {
  const lines = [
    "# Leave-one-out (read-only)",
    "",
    report.abortedReason
      ? `Aborted: ${report.abortedReason}`
      : `Stores: ${report.storeCount}. Candidates: ${report.candidateCount}. ${report.passed ? "PASS" : "FAIL (calibration, not PROD)"}.`,
    "",
    "| Filiale | geoKey | Rang | Top-N | Score | nAktiv |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of report.rows) {
    lines.push(
      `| ${row.title} | ${row.geoKey} | ${row.rank ?? "—"} | ${row.topN} | ${row.score ?? "—"} | ${row.nAktiv} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
