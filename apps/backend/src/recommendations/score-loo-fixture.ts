import { PatternCriterion } from "../analysis/types";
import { SeriesBaseline, baselineForMetric } from "../analysis/series-baseline";
import { SeriesLevel, YearlySeries, isSeriesLevel } from "../analysis/yearly-series";
import { AreaCandidate, isAreaKind, isLorPlrKey, stampCandidateTargetRegion } from "./area-candidates";
import { LeaveOneOutStore } from "./score-loo";
import { Grain } from "../target-region/dto";
import { RecommendationItem, RecommendationPayload } from "./types";

export interface LooFixture {
  targetRegionGeoKey: string;
  /** Why a single targetRegionGeoKey was stamped (multi-Ortsteil / set fallback). */
  targetRegionStampNote?: string;
  stores: LeaveOneOutStore[];
  pool: AreaCandidate[];
  yearly: YearlySeries[];
  criteria: PatternCriterion[];
}

const GRAIN_SET = new Set<string>(["address", "grid100", "plz8", "plz5", "ags", "ags5", "other"]);

/**
 * Pick a `valueKey` so `baselineForMetric(metricId, valueKey)` matches the
 * stored criterion / evidence baseline. Missing valueKey on count metrics
 * defaults to per_1000_inhabitants and falsely zeros nAktiv on per_km2
 * Unfallatlas criteria.
 */
export function valueKeyForBaselineMatch(
  metricId: string,
  baseline: SeriesBaseline | undefined,
  knownValueKey?: string,
): string | undefined {
  if (knownValueKey && (!baseline || baselineForMetric(metricId, knownValueKey) === baseline)) {
    return knownValueKey;
  }
  if (!baseline) return knownValueKey;
  if (baselineForMetric(metricId, knownValueKey) === baseline) return knownValueKey;
  if (baseline === "per_km2") {
    return metricId === "unfallatlas" ? "unfaelle_je_km2" : "je_km2";
  }
  if (baseline === "per_household") return "haushalte";
  return undefined;
}

/** Copy or infer valueKey on every yearly series so re-rank baselinesMatch. */
export function withFixtureValueKeyHygiene(fixture: LooFixture): LooFixture {
  const knownByMetric = knownValueKeysFromSeries(fixture.yearly);
  const yearly = fixture.yearly.map((series) => {
    const criterion = criterionForSeries(fixture.criteria, series);
    const known = series.valueKey ?? knownByMetric.get(series.metricId);
    const valueKey = valueKeyForBaselineMatch(series.metricId, criterion?.baseline, known);
    if (!valueKey || valueKey === series.valueKey) return series;
    return { ...series, valueKey };
  });
  return { ...fixture, yearly };
}

/**
 * Build a LOO fixture from a stored recommendation payload.
 * Prefers `patternByDataset[].yearlySeries.valueKey`; otherwise infers from
 * criterion/evidence baseline. Does not invent metrics.
 */
export function extractLooFixtureFromPayload(input: {
  payload: RecommendationPayload;
  stores: LeaveOneOutStore[];
}): LooFixture {
  const criteria = input.payload.pattern?.criteria ?? [];
  const knownByMetric = new Map<string, string>();
  for (const profile of input.payload.patternByDataset ?? []) {
    const key = profile.yearlySeries.valueKey;
    if (key) knownByMetric.set(profile.metricId, key);
  }

  const yearly: YearlySeries[] = [];
  for (const profile of input.payload.patternByDataset ?? []) {
    yearly.push(withSeriesValueKey(profile.yearlySeries, profile.criterion.baseline, knownByMetric));
  }
  for (const item of input.payload.items ?? []) {
    yearly.push(...yearlyFromItemEvidence(item, criteria, knownByMetric));
  }

  const pool = candidatesFromItems(input.payload.items ?? []);
  const stamped = stampPoolTargetRegion(pool, uniqueOrtsteilKeys([]), input.payload);
  return withFixtureValueKeyHygiene({
    targetRegionGeoKey: stamped.targetRegionGeoKey,
    targetRegionStampNote: stamped.targetRegionStampNote,
    stores: input.stores,
    pool: stamped.pool,
    yearly,
    criteria,
  });
}

export function stampPoolTargetRegion(
  pool: AreaCandidate[],
  homeOrtsteile: string[],
  payload?: Pick<RecommendationPayload, "items" | "targetRegions">,
): { pool: AreaCandidate[]; targetRegionGeoKey: string; targetRegionStampNote?: string } {
  const uniqueHomes = unique(homeOrtsteile);
  let targetRegionGeoKey = uniqueHomes[0] ?? "";
  let targetRegionStampNote: string | undefined;
  if (uniqueHomes.length === 1) {
    targetRegionGeoKey = uniqueHomes[0]!;
  } else if (uniqueHomes.length > 1) {
    targetRegionGeoKey = uniqueHomes.slice().sort((a, b) => a.localeCompare(b, "de"))[0]!;
    targetRegionStampNote =
      `LOO stamps a single targetRegionGeoKey when stores sit in multiple Ortsteile. ` +
      `Stamped=${targetRegionGeoKey}; Ortsteile=${uniqueHomes.join(", ")}. No invented metrics.`;
  } else {
    const fromItems = unique(
      (payload?.items ?? []).map((item) => item.targetRegionGeoKey?.trim()).filter((key): key is string => Boolean(key)),
    );
    const fromRegions = unique(
      (payload?.targetRegions ?? []).map((region) => region.geoKey?.trim()).filter((key): key is string => Boolean(key)),
    );
    const fallback = fromItems[0] ?? fromRegions[0] ?? pool[0]?.targetRegionGeoKey?.trim() ?? pool[0]?.geoKey ?? "";
    targetRegionGeoKey = fallback;
    if (fromItems.length > 1 || fromRegions.length > 1) {
      targetRegionStampNote =
        `LOO stamps a single targetRegionGeoKey from the last completed set. ` +
        `Stamped=${targetRegionGeoKey}. No invented metrics.`;
    }
  }
  return {
    pool: pool.map((item) => stampCandidateTargetRegion(item, targetRegionGeoKey)),
    targetRegionGeoKey,
    targetRegionStampNote,
  };
}

export function uniqueOrtsteilKeys(keys: Array<string | null | undefined>): string[] {
  return unique(keys.filter((key): key is string => Boolean(key?.trim())));
}

function yearlyFromItemEvidence(
  item: RecommendationItem,
  criteria: PatternCriterion[],
  knownByMetric: Map<string, string>,
): YearlySeries[] {
  const series: YearlySeries[] = [];
  for (const evidence of item.criteriaEvidence ?? []) {
    if (!evidence.points || evidence.points.length === 0) continue;
    const metricId = evidence.metricId ?? evidence.key;
    const criterion = criteria.find((entry) => (entry.metricId ?? entry.key) === metricId);
    const baseline = evidence.baseline ?? criterion?.baseline;
    const known = knownByMetric.get(metricId);
    const valueKey = valueKeyForBaselineMatch(metricId, baseline, known);
    const requestedLevel = seriesLevelOf(item.kind);
    const sourceLevel = seriesLevelOf(evidence.sourceLevel) ?? requestedLevel;
    series.push({
      metricId,
      requestedLevel,
      requestedGeoKey: item.location.geoKey,
      sourceLevel,
      sourceGeoKey: evidence.sourceGeoKey ?? item.location.geoKey,
      granularity: "year",
      coverage: evidence.coverage ?? "multi",
      ...(valueKey ? { valueKey } : {}),
      points: evidence.points,
    });
  }
  return series;
}

function withSeriesValueKey(
  series: YearlySeries,
  baseline: SeriesBaseline | undefined,
  knownByMetric: Map<string, string>,
): YearlySeries {
  const known = series.valueKey ?? knownByMetric.get(series.metricId);
  const valueKey = valueKeyForBaselineMatch(series.metricId, baseline, known);
  if (valueKey && valueKey !== series.valueKey) return { ...series, valueKey };
  return series;
}

function candidatesFromItems(items: RecommendationItem[]): AreaCandidate[] {
  const plrOnly = items.filter((item) => isLorPlrKey(item.location.geoKey) || item.kind === "lor");
  const source = plrOnly.length > 0 ? plrOnly : items;
  const out: AreaCandidate[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const candidate = candidateFromItem(item);
    if (!candidate || seen.has(candidate.geoKey)) continue;
    seen.add(candidate.geoKey);
    out.push(candidate);
  }
  return out;
}

function candidateFromItem(item: RecommendationItem): AreaCandidate | null {
  const geoKey = item.location?.geoKey?.trim();
  if (!geoKey || !isAreaKind(item.kind) || !isGrain(item.grain)) return null;
  return {
    id: item.id,
    geoKey,
    grain: item.grain,
    kind: item.kind,
    title: item.title,
    name: item.name,
    ags: null,
    plz: null,
    lon: item.location.lon,
    lat: item.location.lat,
    targetRegionGeoKey: item.targetRegionGeoKey,
  };
}

function criterionForSeries(criteria: PatternCriterion[], series: YearlySeries): PatternCriterion | undefined {
  return criteria.find((entry) => (entry.metricId ?? entry.key) === series.metricId);
}

function knownValueKeysFromSeries(yearly: YearlySeries[]): Map<string, string> {
  const known = new Map<string, string>();
  for (const series of yearly) {
    if (series.valueKey && !known.has(series.metricId)) known.set(series.metricId, series.valueKey);
  }
  return known;
}

function seriesLevelOf(value: string | null | undefined): SeriesLevel {
  if (isSeriesLevel(value)) return value;
  return "lor";
}

function isGrain(value: string | null | undefined): value is Grain {
  return Boolean(value && GRAIN_SET.has(value));
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function isLooFixture(value: unknown): value is LooFixture {
  if (!value || typeof value !== "object") return false;
  const record = value as LooFixture;
  return (
    typeof record.targetRegionGeoKey === "string" &&
    Array.isArray(record.stores) &&
    Array.isArray(record.pool) &&
    Array.isArray(record.yearly) &&
    Array.isArray(record.criteria)
  );
}
