import type {
  AnalysisPattern,
  MonthlyRevenuePoint,
  Recommendation,
  RecommendationSet,
  RecommendationWindow,
  SeriesCoverage,
  SeriesLevel,
  SeriesPoint,
  TargetRegion,
  YearlySeries,
} from "@ruehrai/api-contracts";
import { ADDRESS_COPY, topicName } from "../addresses/model.ts";
import { criterionDirectionLabel } from "../analysis/model.ts";
import { catalogBadge, catalogPlaceName, grainLabel } from "../format.ts";
import { formatAddress, RECOMMENDATION_COPY } from "../recommendations/model.ts";

/** After Standorte the product opens Verlauf. Vorschlag 1 (Karte zuerst) does not apply. */
export const POST_STANDORTE_HREF: string = "/verlauf";

export const SELECTABLE_AREA_LEVELS = ["Stadtbezirk", "Stadtteil", "Ortsteil", "PLZ"] as const;

/** Contract wording for an absent Brain cell. Never 0, null, or {}. */
export const ABSENT_LABEL = ADDRESS_COPY.absent;

const STORE_REVENUE_METRIC = /^(umsatz|app\.store_monthly_revenue)$/;

const SERIES_LEVEL_LABELS: Record<SeriesLevel, string> = {
  address: "Adresse",
  grid100: "100-m-Raster",
  plz: "PLZ",
  bezirk: "Bezirk",
  stadtbezirk: "Stadtbezirk",
  stadtteil: "Stadtteil",
  ortsteil: "Ortsteil",
  gemeinde: "Gemeinde",
  kreis: "Kreis",
  land: "Land",
};

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
] as const;

export const VERLAUF_COPY = {
  title: "Verlauf",
  kicker: "Verlauf",
  heroHeading: "Veränderung der Kleinraumdaten",
  nextHeading: "Weiterentwicklung",
  nextLead: "Als Nächstes",
  top3: RECOMMENDATION_COPY.subtitle,
  proof: "Lage",
  revenueOptional: "Monatsumsatz der bestehenden Standorte (optional)",
  levels: "Stadtbezirk, Stadtteil, Ortsteil und PLZ bleiben wählbar.",
  gemeindeHint: "Gemeinde gilt nur für eine Gemeinde. Ohne Teilgebiet ist das kein Fehler.",
  toStandorte: "Zu den Standorten",
  toAnalysis: "Zur Musteranalyse",
  startAnalysis: "Musteranalyse starten",
  compute: RECOMMENDATION_COPY.compute,
  running: RECOMMENDATION_COPY.running,
  analysisRunning: "Analyse läuft …",
  analysisFailed: "Analyse fehlgeschlagen.",
  noneYet: RECOMMENDATION_COPY.noneYet,
  empty: RECOMMENDATION_COPY.empty,
  thin: RECOMMENDATION_COPY.thin,
  missingRun: "Für diese Zielregion liegt noch kein Analyselauf vor.",
  missingPattern: "Es liegt noch kein Muster vor. Bitte zuerst eine Analyse starten.",
  noSeries: "Für diesen Lauf liegt keine Dreijahresreihe vor.",
  noTrend: "Kein Trend: es liegt höchstens ein Wert vor.",
  noPoints: "Für die letzten drei Jahre liegen keine Kleinraumwerte vor.",
  signedOut: "Der Verlauf steht nach der Anmeldung zur Verfügung.",
} as const;

export interface VerlaufCriterion {
  key: string;
  label: string;
  direction: string;
  evidence: string;
}

export interface VerlaufTop3 {
  id: string;
  rank: number;
  address: string;
  rationale: string;
}

export interface VerlaufSeriesPoint {
  period: string;
  status: "present" | "absent";
  display: string;
  value?: number;
}

export interface VerlaufSeriesView {
  metricId: string;
  label: string;
  requestedLevel: string;
  requestedGeoKey: string;
  sourceLevel: string;
  coverage: SeriesCoverage;
  showTrend: boolean;
  sourceNote: string | null;
  points: VerlaufSeriesPoint[];
}

export interface VerlaufHero {
  heading: typeof VERLAUF_COPY.heroHeading;
  change: string;
  series: VerlaufSeriesView[];
  hasYearlySeries: boolean;
  criteria: VerlaufCriterion[];
  months: string[];
  nextHeading: typeof VERLAUF_COPY.nextHeading;
  nextSentence: string | null;
  nextAddress: string | null;
  top3: VerlaufTop3[];
  engine: "yearlySeries" | "pattern";
}

export interface VerlaufRegionView {
  label: string | null;
  badge: string | null;
  error: string | null;
}

export function isPostStandorteMap(): boolean {
  return POST_STANDORTE_HREF === "/";
}

/** A Gemeinde without Ortsteil / Stadtteil is a valid Zielregion. */
export function municipalityNeedsSubarea(): boolean {
  return false;
}

export function seriesLevelLabel(level: SeriesLevel): string {
  return SERIES_LEVEL_LABELS[level];
}

export function sourceAttribution(series: Pick<YearlySeries, "requestedLevel" | "sourceLevel">): string | null {
  if (series.sourceLevel === series.requestedLevel) return null;
  const source = sourceValueNoun(series.sourceLevel);
  const requested = seriesLevelLabel(series.requestedLevel);
  return `${source}, nicht lokale Werte der gewählten Ebene (${requested}).`;
}

export function regionView(region: TargetRegion | null): VerlaufRegionView {
  if (!region) return { label: null, badge: null, error: null };
  const badge = catalogBadge(region) || (region.grain ? grainLabel(region.grain, region.ags || region.geoKey) : null);
  return {
    label: catalogPlaceName(region) ?? region.label,
    badge: badge || null,
    error: null,
  };
}

export function monthRow(window: RecommendationWindow | null | undefined): string[] {
  if (!window) return [];
  const start = parseYearMonth(window.from);
  const end = parseYearMonth(window.to);
  if (!start || !end) return [];
  const rows: string[] = [];
  let { year, month } = start;
  while (year < end.year || (year === end.year && month <= end.month)) {
    const name = MONTHS_SHORT[month - 1];
    if (name) rows.push(name);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (rows.length > 36) break;
  }
  return rows;
}

/**
 * Hero is the Kleinraum change from `yearlySeries` and the next step.
 * Store revenue is never the engine. No yearly means and no dataset name
 * are invented. `coverage` `single` or `none` is not a trend.
 */
export function buildVerlaufHero(input: {
  pattern: AnalysisPattern | null;
  recommendations: RecommendationSet | null;
  revenue?: MonthlyRevenuePoint[];
}): VerlaufHero | null {
  if (!input.pattern) return null;
  const first = input.recommendations?.items[0] ?? null;
  const series = kleinraumSeries(input.pattern.yearlySeries);
  return {
    heading: VERLAUF_COPY.heroHeading,
    change: changeFromSeries(series, input.pattern.summary),
    series,
    hasYearlySeries: Array.isArray(input.pattern.yearlySeries),
    criteria: input.pattern.criteria.map((criterion) => ({
      key: criterion.key,
      label: criterion.label,
      direction: criterionDirectionLabel(criterion.direction),
      evidence: criterion.evidence,
    })),
    months: monthRow(input.recommendations?.window),
    nextHeading: VERLAUF_COPY.nextHeading,
    nextSentence: first?.rationale.trim() || null,
    nextAddress: first ? streetAddress(first) : null,
    top3: (input.recommendations?.items ?? []).map((item) => ({
      id: item.id,
      rank: item.rank,
      address: streetAddress(item),
      rationale: item.rationale,
    })),
    engine: Array.isArray(input.pattern.yearlySeries) ? "yearlySeries" : "pattern",
  };
}

export function kleinraumSeries(raw: YearlySeries[] | undefined): VerlaufSeriesView[] {
  if (!raw) return [];
  return raw.filter((series) => !isStoreRevenueMetric(series.metricId)).map(toSeriesView);
}

export function toSeriesView(series: YearlySeries): VerlaufSeriesView {
  const showTrend = series.coverage === "multi";
  return {
    metricId: series.metricId,
    label: topicName(series.metricId),
    requestedLevel: seriesLevelLabel(series.requestedLevel),
    requestedGeoKey: series.requestedGeoKey,
    sourceLevel: seriesLevelLabel(series.sourceLevel),
    coverage: series.coverage,
    showTrend,
    sourceNote: sourceAttribution(series),
    points: series.points.map((point) => toPointView(point)),
  };
}

export function toPointView(point: SeriesPoint): VerlaufSeriesPoint {
  if (point.status === "absent") {
    return { period: point.period, status: "absent", display: ABSENT_LABEL };
  }
  return {
    period: point.period,
    status: "present",
    display: formatSeriesValue(point.value ?? 0),
    value: point.value ?? 0,
  };
}

export function streetAddress(item: Recommendation): string {
  return formatAddress(item);
}

export function optionalRevenueCount(points: MonthlyRevenuePoint[] | null | undefined): number {
  if (!points) return 0;
  return points.filter((point) => point.revenueEur != null).length;
}

function changeFromSeries(series: VerlaufSeriesView[], summary: string): string {
  const withTrend = series.find((item) => item.showTrend);
  if (withTrend) {
    const present = withTrend.points.filter((point) => point.status === "present");
    const first = present[0];
    const last = present[present.length - 1];
    if (first && last && first !== last) {
      return `${withTrend.label}: ${first.display} (${first.period}) → ${last.display} (${last.period})`;
    }
  }
  if (series.some((item) => item.points.some((point) => point.status === "present"))) {
    return VERLAUF_COPY.noTrend;
  }
  if (series.length > 0) return VERLAUF_COPY.noPoints;
  const trimmed = summary.trim();
  return trimmed || VERLAUF_COPY.noSeries;
}

function sourceValueNoun(level: SeriesLevel): string {
  if (level === "gemeinde") return "Gemeindewerte";
  if (level === "kreis") return "Kreiswerte";
  if (level === "land") return "Landeswerte";
  return `${seriesLevelLabel(level)}werte`;
}

function isStoreRevenueMetric(metricId: string): boolean {
  return STORE_REVENUE_METRIC.test(metricId);
}

function formatSeriesValue(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}
