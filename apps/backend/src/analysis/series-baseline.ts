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

/** Copy series and attach `normalizedValue` when the Bezugsgröße is present. Never invent 0. */
export function attachNormalizedValues(series: YearlySeries[]): YearlySeries[] {
  const lookup = buildBaselineLookup(series);
  return series.map((item) => {
    const baseline = baselineForMetric(item.metricId, item.valueKey);
    return {
      ...item,
      points: item.points.map((point) => normalizePoint(point, item, baseline, lookup)),
    };
  });
}

export function normalizePoint(
  point: SeriesPoint,
  series: Pick<YearlySeries, "metricId" | "valueKey" | "sourceGeoKey" | "requestedGeoKey">,
  baseline: SeriesBaseline,
  lookup: BaselineLookup,
): SeriesPoint {
  if (point.status !== "present" || typeof point.value !== "number" || !Number.isFinite(point.value)) {
    return { period: point.period, status: point.status === "absent" ? "absent" : point.status };
  }
  const year = yearOf(point.period);
  const divisor = year == null ? null : baselineDivisor(baseline, series, year, lookup);
  if (divisor == null || !(divisor > 0)) {
    return { period: point.period, status: "present", value: point.value };
  }
  const scale = baseline === "per_1000_inhabitants" ? 1000 : 1;
  return {
    period: point.period,
    status: "present",
    value: point.value,
    normalizedValue: roundNormalized((point.value / divisor) * scale),
  };
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
