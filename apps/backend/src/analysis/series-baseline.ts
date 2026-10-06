import { sourceThemesForMetric } from "../address-pair/topics";
import {
  AreaBaselineIndex,
  AreaBaselineRow,
  BaselineMethod,
  MetricCatalogEntry,
  areaDivisor,
  buildAreaBaselineIndex,
  catalogSeriesBaseline,
  findAreaBaseline,
  isBaselineMethod,
} from "./area-baseline";
import { isCountMetricKey } from "./count-metrics";
import { SeriesPoint, YearlySeries } from "./yearly-series";

export const SERIES_BASELINES = ["per_1000_inhabitants", "per_km2", "per_household"] as const;
export type SeriesBaseline = (typeof SERIES_BASELINES)[number];

/** Brain themes that are Einwohner stock — used as Bezugsgröße, not a relative dataset. */
export const POPULATION_METRIC_IDS = new Set([
  "bevoelkerung",
  "destatis",
  "hamburg_stadtteil_regionalstatistik",
  "muenchen_indikatorenatlas",
  "berlin_lor_ewr_bevoelkerung",
  "koeln_statistischer_datenkatalog",
  "leipzig_lis_ortsteil",
  "duesseldorf_bevoelkerung_stadtteile",
  "essen_bevoelkerung_stadtteile",
  "frankfurt_demographie_stadtteile",
]);

const HOUSEHOLD_VALUE = /haushalt/i;

export function isPopulationMetric(metricId: string): boolean {
  return POPULATION_METRIC_IDS.has(metricId);
}

export function isSeriesBaseline(value: unknown): value is SeriesBaseline {
  return typeof value === "string" && (SERIES_BASELINES as readonly string[]).includes(value);
}

/**
 * Default Bezugsgröße for a dataset. Population stock is per km² (area often
 * missing → normalized absent). Counts are per 1.000 Einwohner. Household
 * stocks baseline other household-relative counts.
 */
export function baselineForMetric(metricId: string, valueKey?: string): SeriesBaseline {
  if (isPopulationMetric(metricId)) return "per_km2";
  if (HOUSEHOLD_VALUE.test(valueKey ?? "") || HOUSEHOLD_VALUE.test(metricId)) return "per_household";
  if (!isCountMetricKey(valueKey ?? metricId, metricId)) return "per_km2";
  return "per_1000_inhabitants";
}

export function baselineNoun(baseline: SeriesBaseline): string {
  if (baseline === "per_km2") return "je km²";
  if (baseline === "per_household") return "je Haushalt";
  return "je 1.000 Einwohner";
}

export interface BaselineLookup {
  inhabitants: Map<string, number>;
  households: Map<string, number>;
  km2: Map<string, number>;
}

/** Brain `geo.area_baseline` + catalog. Catalog-first when the theme is listed. */
export interface AreaBaselineContext {
  catalog: Map<string, MetricCatalogEntry>;
  rows: AreaBaselineRow[];
}

export function buildBaselineLookup(series: YearlySeries[]): BaselineLookup {
  const inhabitants = new Map<string, number>();
  const households = new Map<string, number>();
  const km2 = new Map<string, number>();
  for (const item of series) {
    for (const point of presentRawPoints(item.points)) {
      const year = yearOf(point.period);
      if (year == null) continue;
      if (isPopulationMetric(item.metricId)) {
        putBaseline(inhabitants, item.sourceGeoKey, year, point.value);
        putBaseline(inhabitants, item.requestedGeoKey, year, point.value);
      }
      if (HOUSEHOLD_VALUE.test(item.valueKey ?? "") || HOUSEHOLD_VALUE.test(item.metricId)) {
        putBaseline(households, item.sourceGeoKey, year, point.value);
        putBaseline(households, item.requestedGeoKey, year, point.value);
      }
      if (/flaeche|area_km|qkm|km2/i.test(item.valueKey ?? "") || /flaeche|area_km|qkm|km2/i.test(item.metricId)) {
        putBaseline(km2, item.sourceGeoKey, year, point.value);
        putBaseline(km2, item.requestedGeoKey, year, point.value);
      }
    }
  }
  return { inhabitants, households, km2 };
}

export function catalogEntryForMetric(
  catalog: Map<string, MetricCatalogEntry> | undefined,
  metricId: string,
  valueKey?: string,
): MetricCatalogEntry | undefined {
  if (!catalog || catalog.size === 0) return undefined;
  const keys = [metricId, ...sourceThemesForMetric(metricId)];
  const entries: MetricCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = catalog.get(key);
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return undefined;
  if (HOUSEHOLD_VALUE.test(valueKey ?? "") || HOUSEHOLD_VALUE.test(metricId)) {
    return entries.find((entry) => entry.recommendedBaseline === "haushalte") ?? entries[0];
  }
  return entries[0];
}

/**
 * Copy series and attach `normalizedValue` when the Bezugsgröße is present.
 * Never invent 0. Catalog themes never fall back to sibling series or divide by 1.
 * A prior `baselineMethod: missing` is kept on a second attach.
 */
export function attachNormalizedValues(series: YearlySeries[], area?: AreaBaselineContext): YearlySeries[] {
  const lookup = buildBaselineLookup(series);
  const index = area ? buildAreaBaselineIndex(area.rows) : null;
  return series.map((item) => {
    const catalog = catalogEntryForMetric(area?.catalog, item.metricId, item.valueKey);
    const fromCatalog = catalog ? catalogSeriesBaseline(catalog) : null;
    const baseline = fromCatalog?.baseline ?? baselineForMetric(item.metricId, item.valueKey);
    const scale = fromCatalog?.scale ?? (baseline === "per_1000_inhabitants" ? 1000 : 1);
    return {
      ...item,
      points: item.points.map((point) =>
        normalizePoint(point, item, baseline, lookup, {
          catalog,
          scale,
          index,
        }),
      ),
    };
  });
}

export function normalizePoint(
  point: SeriesPoint,
  series: Pick<YearlySeries, "metricId" | "valueKey" | "sourceGeoKey" | "requestedGeoKey">,
  baseline: SeriesBaseline,
  lookup: BaselineLookup,
  area?: {
    catalog?: MetricCatalogEntry;
    scale: number;
    index: AreaBaselineIndex | null;
  },
): SeriesPoint {
  if (point.status !== "present" || typeof point.value !== "number" || !Number.isFinite(point.value)) {
    return { period: point.period, status: point.status === "absent" ? "absent" : point.status };
  }
  if (area?.catalog && area.index) {
    return normalizeFromArea(point, series, area.catalog, area.scale, area.index);
  }
  if (point.baselineMethod === "missing") {
    return presentRaw(point.period, point.value, "missing");
  }
  if (isBaselineMethod(point.baselineMethod)) {
    return copyCatalogPoint(point);
  }
  const year = yearOf(point.period);
  const divisor = year == null ? null : baselineDivisor(baseline, series, year, lookup);
  if (divisor == null || !(divisor > 0)) {
    return presentRaw(point.period, point.value);
  }
  const scale = baseline === "per_1000_inhabitants" ? 1000 : 1;
  return presentRaw(point.period, point.value, undefined, roundNormalized((point.value / divisor) * scale));
}

export function presentNormalizedPoints(
  points: SeriesPoint[],
): Array<SeriesPoint & { value: number; normalizedValue: number }> {
  return points.filter(
    (point): point is SeriesPoint & { value: number; normalizedValue: number } =>
      point.status === "present" &&
      typeof point.value === "number" &&
      Number.isFinite(point.value) &&
      typeof point.normalizedValue === "number" &&
      Number.isFinite(point.normalizedValue),
  );
}

export function latestRawValue(points: SeriesPoint[]): number | undefined {
  const present = presentRawPoints(points);
  return present.length === 0 ? undefined : present[present.length - 1]!.value;
}

export function latestNormalizedValue(points: SeriesPoint[]): number | undefined {
  const present = presentNormalizedPoints(points);
  return present.length === 0 ? undefined : present[present.length - 1]!.normalizedValue;
}

export function latestBaselineMethod(points: SeriesPoint[]): BaselineMethod | undefined {
  const present = presentRawPoints(points);
  for (let index = present.length - 1; index >= 0; index -= 1) {
    const method = present[index]!.baselineMethod;
    if (isBaselineMethod(method)) return method;
  }
  return undefined;
}

function normalizeFromArea(
  point: SeriesPoint,
  series: Pick<YearlySeries, "sourceGeoKey" | "requestedGeoKey">,
  catalog: MetricCatalogEntry,
  scale: number,
  index: AreaBaselineIndex,
): SeriesPoint {
  const year = yearOf(point.period);
  if (year == null) return presentRaw(point.period, point.value!, "missing");
  const row = findAreaBaseline(index, [series.sourceGeoKey, series.requestedGeoKey], year, catalog.recommendedBaseline);
  const divisor = areaDivisor(row, catalog.recommendedBaseline);
  if (!row || divisor == null) {
    return presentRaw(point.period, point.value!, "missing");
  }
  const next = presentRaw(
    point.period,
    point.value!,
    divisor.method,
    roundNormalized((point.value! / divisor.value) * scale),
  );
  next.baselineYear = row.refYear;
  if (row.baselineYearRule) next.baselineYearRule = row.baselineYearRule;
  return next;
}

function copyCatalogPoint(point: SeriesPoint): SeriesPoint {
  const next = presentRaw(point.period, point.value!, point.baselineMethod);
  if (typeof point.normalizedValue === "number" && Number.isFinite(point.normalizedValue)) {
    next.normalizedValue = point.normalizedValue;
  }
  if (point.baselineYear != null) next.baselineYear = point.baselineYear;
  if (point.baselineYearRule) next.baselineYearRule = point.baselineYearRule;
  return next;
}

function presentRaw(
  period: string,
  value: number,
  baselineMethod?: BaselineMethod,
  normalizedValue?: number,
): SeriesPoint {
  const point: SeriesPoint = { period, status: "present", value };
  if (baselineMethod) point.baselineMethod = baselineMethod;
  if (normalizedValue != null) point.normalizedValue = normalizedValue;
  return point;
}

function baselineDivisor(
  baseline: SeriesBaseline,
  series: Pick<YearlySeries, "sourceGeoKey" | "requestedGeoKey">,
  year: number,
  lookup: BaselineLookup,
): number | null {
  const table = baseline === "per_km2" ? lookup.km2 : baseline === "per_household" ? lookup.households : lookup.inhabitants;
  return getBaseline(table, series.sourceGeoKey, year) ?? getBaseline(table, series.requestedGeoKey, year);
}

function putBaseline(map: Map<string, number>, geoKey: string, year: number, value: number): void {
  const key = `${geoKey}|${year}`;
  if (!map.has(key)) map.set(key, value);
}

function getBaseline(map: Map<string, number>, geoKey: string, year: number): number | null {
  const value = map.get(`${geoKey}|${year}`);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function presentRawPoints(points: SeriesPoint[]): Array<SeriesPoint & { value: number }> {
  return points.filter(
    (point): point is SeriesPoint & { value: number } =>
      point.status === "present" && typeof point.value === "number" && Number.isFinite(point.value),
  );
}

function yearOf(period: string): number | null {
  const year = Number(period.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function roundNormalized(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
