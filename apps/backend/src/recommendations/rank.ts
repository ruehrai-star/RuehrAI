import { AnalysisRegion, CriterionDirection, PatternCriterion } from "../analysis/types";
import { GRAINS, Grain } from "../target-region/dto";
import { CandidateRow, ScoredLocation } from "./types";
import { monthKey } from "./window";

const GRAIN_SET = new Set<string>(GRAINS);

/**
 * Pattern fit is the share of directional criteria whose observed
 * month-to-month direction inside the window matches the saved pattern.
 * A location counts only when at least one criterion matches. The 1% band
 * for "flat" is the same rule as the Musteranalyse heuristic.
 */
export function rankCandidates(
  rows: CandidateRow[],
  criteria: PatternCriterion[],
  months: ReadonlySet<string>,
): ScoredLocation[] {
  const directional = criteria.filter((criterion) => criterion.direction !== "unknown");
  if (directional.length === 0) return [];

  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const period = monthKey(row.refPeriod);
    if (!period || !months.has(period)) continue;
    const grain = asGrain(row.grain);
    const geoKey = row.geoKey.trim();
    if (!grain || !geoKey) continue;

    const id = `${grain}:${geoKey}`;
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = {
        id,
        geoKey,
        grain,
        title: row.title.trim() || row.name?.trim() || `${grain} ${geoKey}`,
        name: row.name?.trim() || null,
        lon: row.lon,
        lat: row.lat,
        period,
        series: new Map(),
      };
      buckets.set(id, bucket);
    } else if (period >= bucket.period) {
      bucket.period = period;
      if (row.title.trim()) bucket.title = row.title.trim();
      if (row.name?.trim()) bucket.name = row.name.trim();
      if (row.lon !== null && row.lat !== null) {
        bucket.lon = row.lon;
        bucket.lat = row.lat;
      }
    }

    for (const criterion of directional) {
      const value = numericSignal(row.metadata, criterion.key);
      if (value === null) continue;
      const byPeriod = bucket.series.get(criterion.key) ?? new Map<string, number[]>();
      const values = byPeriod.get(period) ?? [];
      values.push(value);
      byPeriod.set(period, values);
      bucket.series.set(criterion.key, byPeriod);
    }
  }

  const scored: ScoredLocation[] = [];
  for (const bucket of buckets.values()) {
    const evidence = directional.flatMap((criterion) => {
      const periods = bucket.series.get(criterion.key);
      if (!periods || periods.size === 0) return [];
      const direction = directionAcrossPeriods(periods);
      if (direction === "unknown" || direction !== criterion.direction) return [];
      return [
        {
          key: criterion.key,
          label: criterion.label,
          direction,
          patternDirection: criterion.direction,
          evidence: evidenceFor(criterion.label, periods, direction),
        },
      ];
    });
    if (evidence.length === 0) continue;
    scored.push({
      id: bucket.id,
      title: bucket.title,
      location: {
        geoKey: bucket.geoKey,
        grain: bucket.grain,
        lon: bucket.lon,
        lat: bucket.lat,
        name: bucket.name,
      },
      score: roundScore(evidence.length / directional.length),
      criteriaEvidence: evidence,
    });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.criteriaEvidence.length !== left.criteriaEvidence.length) {
      return right.criteriaEvidence.length - left.criteriaEvidence.length;
    }
    const byTitle = left.title.localeCompare(right.title, "de");
    if (byTitle !== 0) return byTitle;
    return left.id.localeCompare(right.id, "de");
  });
  return scored;
}

/**
 * Drop the target-region anchor when a finer positive location exists.
 * A region with only its own aggregate still returns that one place.
 */
export function withoutRegionAnchor(
  ranked: ScoredLocation[],
  region: Pick<AnalysisRegion, "geoKey" | "grain" | "ags" | "plz">,
): ScoredLocation[] {
  return withoutRegionAnchors(ranked, [region]);
}

/** Drop every list-item anchor when a finer positive location exists. */
export function withoutRegionAnchors(
  ranked: ScoredLocation[],
  regions: Array<Pick<AnalysisRegion, "geoKey" | "grain" | "ags" | "plz">>,
): ScoredLocation[] {
  if (ranked.length <= 1 || regions.length === 0) return ranked;
  const interior = ranked.filter((item) => !regions.some((region) => isAnchor(item, region)));
  return interior.length > 0 ? interior : ranked;
}

function isAnchor(
  item: ScoredLocation,
  region: Pick<AnalysisRegion, "geoKey" | "grain" | "ags" | "plz">,
): boolean {
  const { geoKey, grain } = item.location;
  if (region.geoKey && region.grain && geoKey === region.geoKey && grain === region.grain) {
    return true;
  }
  if (region.ags && (grain === "ags" || grain === "ags5") && geoKey === region.ags) return true;
  if (region.plz && (grain === "plz5" || grain === "plz8") && geoKey === region.plz) return true;
  return false;
}

interface Bucket {
  id: string;
  geoKey: string;
  grain: Grain;
  title: string;
  name: string | null;
  lon: number | null;
  lat: number | null;
  period: string;
  series: Map<string, Map<string, number[]>>;
}

export function numericSignal(metadata: unknown, key: string): number | null {
  const found: number[] = [];
  walk(metadata, "", key, found);
  if (found.length === 0) return null;
  return found.reduce((total, value) => total + value, 0) / found.length;
}

function walk(value: unknown, prefix: string, key: string, found: number[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [childKey, nested] of Object.entries(value as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${childKey}` : childKey;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      walk(nested, fullKey, key, found);
      continue;
    }
    if (fullKey !== key) continue;
    const numeric = asNumber(nested);
    if (numeric !== null) found.push(numeric);
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function directionAcrossPeriods(periods: Map<string, number[]>): CriterionDirection {
  const ordered = [...periods.entries()]
    .filter(([, values]) => values.length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (ordered.length < 2) return "unknown";
  const first = mean(ordered[0]?.[1] ?? []);
  const last = mean(ordered[ordered.length - 1]?.[1] ?? []);
  const scale = Math.max(Math.abs(first), 1);
  if (Math.abs(last - first) / scale < 0.01) return "flat";
  return last > first ? "up" : "down";
}

function evidenceFor(
  label: string,
  periods: Map<string, number[]>,
  direction: CriterionDirection,
): string {
  const ordered = [...periods.entries()]
    .filter(([, values]) => values.length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  const rendered = ordered
    .map(([period, values]) => `${period}: ${formatNumber(mean(values))}`)
    .join("; ");
  const word = direction === "up" ? "steigt" : direction === "down" ? "fällt" : "bleibt nahezu gleich";
  return `${label} ${word} in den letzten sechs Monaten (${rendered}).`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function asGrain(value: string): Grain | null {
  return GRAIN_SET.has(value) ? (value as Grain) : null;
}
