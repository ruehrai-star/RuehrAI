import type {
  AnalysisPattern,
  BaselineMethod,
  PatternDatasetProfile,
  RecommendationEvidence,
  RecommendationWindow,
  SeriesBaseline,
  SeriesCoverage,
  SeriesLevel,
  SeriesPoint,
  TargetRegion,
} from "@ruehrai/api-contracts";
import type { Recommendation, RecommendationSet } from "../api/types.ts";
import { criterionDirectionLabel, patternSourceLabel } from "../analysis/model.ts";
import { catalogBadge, catalogParentName, isCatalogKey, visibleRationale } from "../format.ts";
import { readRegionGeometry } from "../map/karte.ts";
import { samePlace, type PlaceRef } from "../locations/regions.ts";
import { itemMatchesMarkedRegion } from "./target-region-key.ts";
import { standRegionLabel } from "../verlauf/bind.ts";
import { hitBadge, hitName, overlapDetailLines, overlapLageSentence } from "./hit-copy.ts";
import { INACTIVE_HIT_COPY, isInactiveHit } from "./inactive-hit.ts";
import { proximityLabelFromEvidence } from "./proximity.ts";
import { twoYearTrendLabelFromEvidence } from "./two-year-trend.ts";

export {
  SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT,
  areaKindBadge,
  hitBadge,
  hitMapHint,
  hitName,
  mapDisplayName,
  overlapDetailLines,
  overlapLageMapHint,
  overlapLageSentence,
} from "./hit-copy.ts";

export { INACTIVE_HIT_COPY, isInactiveHit } from "./inactive-hit.ts";

/** UX-Gate labels for the Empfehlungen / Trefferliste page (Variante A). */
export const RECOMMENDATION_COPY = {
  title: "Empfehlungen",
  subtitle: "Top 3 in Ihrer Zielregion",
  patternHeading: "Muster der Bestandsstandorte",
  shortCriteriaHeading: "Kurzkriterien",
  address: "Adresse",
  rationale: "Begründung",
  details: "Details",
  empty: "Keine passenden Standorte in der Zielregion.",
  emptyPlural: "Keine passenden Standorte in den Zielregionen.",
  /** Not used on Trefferliste. The heading is always singular for the marked region. */
  subtitlePlural: "Top 3 in Ihren Zielregionen",
  thin: "Die Zielregion ist dünn besetzt.",
  compute: "Empfehlungen berechnen",
  running: "Empfehlungen werden ermittelt …",
  analysisRunning: "Analyse läuft …",
  loading: "Wird geladen …",
  analysisFailed: "Analyse fehlgeschlagen.",
  loadFailed: "Der Stand konnte gerade nicht geladen werden.",
  retryLoad: "Erneut versuchen",
  analysisDeadline: "Analyse fehlgeschlagen: Die Berechnung hat zu lange gedauert.",
  missingRun: "Für diese Zielregion liegt noch kein Analyselauf vor.",
  startAnalysis: "Musteranalyse starten",
  restartAnalysis: "Erneut starten",
  legacySet: "Diese Analyse stammt aus einer älteren Version. Bitte neu berechnen.",
  missingGeometry: "Die Fläche kann noch nicht gezeichnet werden.",
  missingValue: "liegt nicht vor",
  toAnalysis: "Zur Musteranalyse",
  noneYet: "Es liegen noch keine Empfehlungen vor. Bitte zuerst Empfehlungen berechnen.",
} as const;

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

const AREA_RANK: Record<string, number> = {
  address: 0,
  grid100: 1,
  lor: 2,
  quartier: 2,
  ortsteil: 3,
  stadtteil: 3,
  plz: 4,
  plz5: 4,
  plz8: 4,
  bezirk: 5,
  stadtbezirk: 5,
  gemeinde: 6,
  ags: 6,
  kreis: 7,
  ags5: 7,
  land: 8,
};

const SERIES_LEVEL_BADGE: Record<SeriesLevel, string> = {
  address: "Adresse",
  grid100: "100-m-Raster",
  lor: "Planungsraum",
  quartier: "Quartier",
  plz: "PLZ",
  bezirk: "Bezirk",
  stadtbezirk: "Bezirk",
  stadtteil: "Ortsteil",
  ortsteil: "Ortsteil",
  gemeinde: "Gemeinde",
  kreis: "Kreis",
  land: "Land",
};

export interface SparkPoint {
  period: string;
  value: number | null;
}

export interface TrefferYearDetail {
  period: string;
  normalized: string;
  raw: string | null;
  baseline: string | null;
}

export interface TrefferCriterionRow {
  key: string;
  label: string;
  inherited: boolean;
  inheritedLabel: string | null;
  missing: boolean;
  coverage: "series" | "single" | "none";
  direction: "up" | "down" | "flat" | null;
  series: SparkPoint[];
  patternSeries: SparkPoint[];
  patternMissing: boolean;
  stichtagValue: string | null;
  stichtagYear: string | null;
  baselineLabel: string | null;
  levelBadge: string | null;
  methodLabel: string | null;
  /** German band from `criteriaEvidence[].proximity`, or null when inherited/neutral/inactive. */
  proximityLabel: string | null;
  /** „Trend aus 2 Jahren“ when official `trendYears` is 2 or `trendFromTwoYears`; otherwise null. */
  twoYearTrendLabel: string | null;
  details: {
    rawValue: string | null;
    evidence: string;
    years: TrefferYearDetail[];
  };
}

export interface TrefferCardView {
  id: string;
  rank: number;
  name: string;
  badge: string;
  parentLabel: string | null;
  intersection: string | null;
  /** Lage-Satz from clipped `overlaps`. Last header line; not Begründung. */
  lage: string | null;
  /** Full overlap list for Details: `[Name]: [x] %`. */
  overlapDetails: string[];
  /** `Stichtag [Jahr]` from `items[].dataAsOf`. Omitted when the field is missing. */
  stichtagLabel: string | null;
  trendSummary: string | null;
  rationale: string;
  criteria: TrefferCriterionRow[];
  inherited: TrefferCriterionRow[];
  /**
   * No 0.19.5 item field names nAktiv. True when no `criteriaEvidence`
   * has own Verlauf (local trend / series).
   */
  inactive: boolean;
  /** Card-level copy for inactive hits; null on a normal hit. */
  inactiveHint: string | null;
  geometryMissing: boolean;
  geometryHint: string | null;
}

export interface PatternProfileRow {
  key: string;
  label: string;
  levelBadge: string;
  baselineLabel: string;
  methodLabel: string | null;
  coverage: "series" | "single" | "none";
  series: SparkPoint[];
  missing: boolean;
  stichtagValue: string | null;
  stichtagYear: string | null;
}

/**
 * Variante A is always singular and names the marked Zielregion.
 * A numeric argument is the older region-count helper and stays singular.
 */
export function recommendationSubtitle(region: string | number | null | undefined): string | null {
  if (typeof region === "number") {
    return region <= 0 ? null : RECOMMENDATION_COPY.subtitle;
  }
  const name = typeof region === "string" ? region.trim() : "";
  if (!name) return null;
  return `${RECOMMENDATION_COPY.subtitle} ${name}`;
}

export function trefferStatusCopy(input: {
  pageLoading: boolean;
  bindLoading: boolean;
  runStatus: "idle" | "queued" | "running" | "failed" | "deadline";
}): { text: string | null; tone: "loading" | "running" | "error" | null } {
  if (input.pageLoading || input.bindLoading) {
    return { text: RECOMMENDATION_COPY.loading, tone: "loading" };
  }
  if (input.runStatus === "queued" || input.runStatus === "running") {
    return { text: RECOMMENDATION_COPY.analysisRunning, tone: "running" };
  }
  if (input.runStatus === "deadline") {
    return { text: RECOMMENDATION_COPY.analysisDeadline, tone: "error" };
  }
  if (input.runStatus === "failed") {
    return { text: null, tone: "error" };
  }
  return { text: null, tone: null };
}

export function recommendationEmptyCopy(regionCount?: number): string | null {
  if (regionCount !== undefined && regionCount <= 0) return null;
  return RECOMMENDATION_COPY.empty;
}

export function top3Heading(regionName: string): string {
  return `${RECOMMENDATION_COPY.subtitle} ${regionName}`.trim();
}

export function rankLabel(rank: number): string {
  return `Rang ${rank}`;
}

export function stichtagCopy(value: string | null, year: string | null): string {
  if (!value) return RECOMMENDATION_COPY.missingValue;
  return year ? `${value} · Stichtag ${year}` : value;
}

/** Card line from `items[].dataAsOf`. Never invented when the field is missing. */
export function stichtagFromDataAsOf(value: string | null | undefined): string | null {
  const year = yearFromDataAsOf(value);
  return year ? `Stichtag ${year}` : null;
}

export { isLegacyTargetRegionSet, targetRegionKeyOf } from "./target-region-key.ts";

export function formatAddress(item: Recommendation): string {
  const title = visiblePlaceText(item.title);
  const name = visiblePlaceText(item.location.name);
  if (name && name !== title) return title ? `${title}, ${name}` : name;
  return title || name;
}

export function formatLocationMeta(item: Recommendation): string {
  const badge = hitBadge(item) || catalogBadge({ ...item.location, grain: item.grain ?? item.location.grain });
  const parent = catalogParentName(item) ?? catalogParentName(item.location);
  return [badge, parent].filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}

export function formatScore(score: number): string {
  const percent = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 }).format(score);
  return `Passung ${percent}`;
}

export function formatWindow(window: RecommendationWindow): string {
  return `${formatWindowStamp(window.from)} – ${formatWindowStamp(window.to)}`;
}

export function shortCriteria(pattern: AnalysisPattern): string[] {
  return pattern.criteria.map(
    (criterion) => `${criterion.label} · ${criterionDirectionLabel(criterion.direction)}`,
  );
}

export function recommendationSourceLabel(source: Recommendation["source"]): string {
  return patternSourceLabel(source);
}

/**
 * Fewer than three matches keep the Backend `reason`. Zero matches still show
 * the UX-Gate empty sentence when that sentence is not already inside `reason`.
 */
export function recommendationStatus(set: RecommendationSet): { empty: boolean; thin: boolean; reason: string | null } {
  const empty = set.items.length === 0;
  const thin = set.items.length > 0 && set.items.length < 3;
  const reason = set.reason?.trim() ? set.reason.trim() : null;
  if (
    empty &&
    reason &&
    (reason.includes(RECOMMENDATION_COPY.empty) || reason.includes(RECOMMENDATION_COPY.emptyPlural))
  ) {
    return { empty: false, thin: false, reason };
  }
  return { empty, thin, reason };
}

export function baselineLabel(baseline: SeriesBaseline | null | undefined): string | null {
  if (baseline === "per_1000_inhabitants") return "je 1.000 Einwohner";
  if (baseline === "per_km2") return "je km²";
  if (baseline === "per_household") return "je Haushalt";
  return null;
}

export function baselineMethodLabel(method: BaselineMethod | null | undefined): string | null {
  if (method === "official" || method === "official_zensus2022_grid") return "amtlich";
  if (method === "estimate_zensus2022_grid_sum" || method === "estimate_lor_sum" || method === "estimate_address") {
    return "geschätzt";
  }
  if (method === "geom" || method === "fixed_grid") return "nach Fläche";
  return null;
}

export function seriesLevelBadge(level: SeriesLevel | null | undefined): string | null {
  if (!level) return null;
  return SERIES_LEVEL_BADGE[level] ?? null;
}

export function isSeriesCoverage(coverage: SeriesCoverage | null | undefined): boolean {
  return coverage === "series" || coverage === "multi";
}

function locationKey(item: Recommendation): string | null {
  const location = item.location;
  return typeof location.geoKey === "string" && location.geoKey.length > 0 ? location.geoKey : null;
}

export function areaRankOf(source: {
  kind?: string | null;
  grain?: string | null;
  level?: string | null;
  geoKey?: string | null;
  id?: string | null;
  ags?: string | null;
}): number {
  const blob = [source.id, source.geoKey].filter((part): part is string => Boolean(part)).join(" ");
  if (/lor:plr:|koeln:sq:/i.test(blob)) return AREA_RANK.lor;
  if (source.kind && source.kind in AREA_RANK) return AREA_RANK[source.kind] ?? 9;
  if (source.level && source.level in AREA_RANK) return AREA_RANK[source.level] ?? 9;
  if (source.grain === "ags" && catalogBadge({ grain: "ags", geoKey: source.geoKey, ags: source.ags, id: source.id }) === "Bezirk") {
    return AREA_RANK.bezirk;
  }
  if (source.grain && source.grain in AREA_RANK) return AREA_RANK[source.grain] ?? 9;
  if (/lor:/i.test(blob)) return AREA_RANK.lor;
  return 9;
}

export function isAddressHit(item: Recommendation): boolean {
  return item.kind === "address" || item.location.grain === "address";
}

export function hasDrawableGeometry(item: Recommendation): boolean {
  return readRegionGeometry(item.geometry) !== null;
}

export function trendSummary(item: Recommendation): string | null {
  const trend = item.trend;
  if (!trend) return null;
  if (trend.direction === "unknown") return null;
  const summary = trend.summary.trim();
  return summary.length > 0 ? summary : null;
}

/**
 * Hits for the marked Zielregion.
 *
 * From OpenAPI 0.19.2, `items[].targetRegionGeoKey` is the backend key
 * (`geoKey` → `ags:{ags}` → `label:{norm}`). Rank is per region from 1.
 * A stored set whose items all lack that field is legacy — callers show
 * the recompute copy instead of mixing regions or the normal empty state.
 */
export function visibleHits(
  items: readonly Recommendation[],
  marked: (PlaceRef & { ags?: unknown }) | null | undefined,
): Recommendation[] {
  const inMarkedRegion = items.filter((item) => itemMatchesMarkedRegion(item, marked));
  const markedRank = marked
    ? areaRankOf({ ...marked, ags: typeof marked.ags === "string" ? marked.ags : null })
    : 9;
  const withoutSelf = inMarkedRegion.filter((item) => {
    if (isAddressHit(item)) return false;
    if (!hitName(item)) return false;
    if (marked && isSameAsMarked(item, marked)) return false;
    if (areaRankOf(hitPlace(item)) >= markedRank) return false;
    return true;
  });
  const finest = dropParentsWhenChildHits(withoutSelf);
  return [...finest].sort((left, right) => left.rank - right.rank);
}

export function topHits(
  items: readonly Recommendation[],
  marked: (PlaceRef & { ags?: unknown }) | null | undefined,
  limit = 3,
): Recommendation[] {
  return visibleHits(items, marked).slice(0, limit);
}

export function inheritedLabel(level: SeriesLevel | null | undefined): string {
  const badge = seriesLevelBadge(level) ?? "Ebene";
  return `vererbt von ${badge}`;
}

export function intersectionLine(item: Recommendation): string | null {
  const parts = item.intersectionOf;
  if (!Array.isArray(parts) || parts.length < 2) return null;
  const names = parts
    .map((part) => visiblePlaceText(part.name))
    .filter((name) => name.length > 0);
  if (names.length < 2) return null;
  const last = names[names.length - 1];
  const rest = names.slice(0, -1).join(", ");
  return `Schnittfläche aus ${rest} und ${last}`;
}

export function buildTrefferCard(
  item: Recommendation,
  patternByDataset: PatternDatasetProfile[] | undefined,
  marked?: PlaceRef | null,
): TrefferCardView {
  const inactive = isInactiveHit(item);
  const rows = buildCriterionRows(item, patternByDataset, marked, inactive);
  const local = rows.filter((row) => !row.inherited);
  const inherited = rows.filter((row) => row.inherited);
  const missingGeometry = !hasDrawableGeometry(item);
  return {
    id: item.id,
    rank: item.rank,
    name: hitName(item),
    badge: hitBadge(item),
    parentLabel: catalogParentName(item) ?? catalogParentName(item.location),
    intersection: intersectionLine(item),
    lage: overlapLageSentence(item.overlaps),
    overlapDetails: overlapDetailLines(item.overlaps),
    stichtagLabel: stichtagFromDataAsOf(item.dataAsOf),
    trendSummary: trendSummary(item),
    rationale: visibleRationale(item.rationale),
    criteria: local,
    inherited,
    inactive,
    inactiveHint: inactive ? INACTIVE_HIT_COPY : null,
    geometryMissing: missingGeometry,
    geometryHint: missingGeometry ? RECOMMENDATION_COPY.missingGeometry : null,
  };
}

export function buildPatternProfile(patternByDataset: PatternDatasetProfile[] | undefined): PatternProfileRow[] {
  if (!patternByDataset) return [];
  return patternByDataset.map((profile) => {
    const coverage = normalizeCoverage(profile.yearlySeries.coverage, profile.criterion.coverage, profile.criterion.kind);
    const series = sparkFromPoints(profile.yearlySeries.points);
    const points = profile.yearlySeries.points ?? [];
    const stichtagValue =
      coverage === "single" ? stichtagValueOf(points, profile.criterion.normalizedValue) : null;
    const stichtagYear = coverage === "single" ? stichtagYearOf(points) : null;
    const missing =
      coverage === "none" ||
      (coverage === "series" && !series.some((point) => point.value != null)) ||
      (coverage === "single" && stichtagValue == null);
    return {
      key: profile.metricId,
      label: profile.criterion.label,
      levelBadge: seriesLevelBadge(profile.sourceLevel) ?? "",
      baselineLabel: baselineLabel(profile.baseline) ?? RECOMMENDATION_COPY.missingValue,
      methodLabel: baselineMethodLabel(profile.baselineMethod ?? profile.criterion.baselineMethod),
      coverage,
      series,
      missing,
      stichtagValue: coverage === "single" && !missing ? stichtagValue : null,
      stichtagYear: coverage === "single" && !missing ? stichtagYear : null,
    };
  });
}

export function buildTrefferlisteCards(
  set: RecommendationSet | null,
  marked: (PlaceRef & { level?: unknown; grain?: unknown; ags?: unknown }) | null | undefined,
): TrefferCardView[] {
  if (!set) return [];
  return topHits(set.items, marked).map((item) => buildTrefferCard(item, set.patternByDataset, marked));
}

/**
 * Trefferliste heading: always `Top 3 in Ihrer Zielregion [markierte Region]`.
 * Singular, and always the currently marked Zielregion — never the run's
 * first/latest region and never `X (Stadt) + N weitere`. That collapsed
 * run label belongs only on the Stand line.
 */
export function headingForMarkedRegion(
  region: (TargetRegion & { level?: unknown; grain?: unknown; ags?: unknown }) | null | undefined,
): string | null {
  if (!region) return null;
  const name = standRegionLabel(region);
  return name ? top3Heading(name) : RECOMMENDATION_COPY.subtitle;
}

function buildCriterionRows(
  item: Recommendation,
  patternByDataset: PatternDatasetProfile[] | undefined,
  marked: PlaceRef | null | undefined,
  inactive: boolean,
): TrefferCriterionRow[] {
  const profiles = patternByDataset ?? [];
  const rows: TrefferCriterionRow[] = [];
  const seen = new Set<string>();

  for (const profile of profiles) {
    const key = profileMetricId(profile) || profile.criterion.key;
    seen.add(key);
    const evidence = evidenceForProfile(item.criteriaEvidence, profile);
    if (evidence?.metricId) seen.add(evidence.metricId);
    if (evidence?.key) seen.add(evidence.key);
    rows.push(toCriterionRow(key, evidence, profile, marked, inactive));
  }

  for (const evidence of item.criteriaEvidence) {
    const key = evidence.metricId ?? evidence.key;
    if (seen.has(key) || seen.has(evidence.key)) continue;
    seen.add(key);
    const profile = profiles.find((row) => evidenceMatchesProfileMetric(evidence, row));
    rows.push(toCriterionRow(key, evidence, profile, marked, inactive));
  }

  const local = rows.filter((row) => !row.inherited);
  const inherited = rows.filter((row) => row.inherited);
  return [...local, ...inherited];
}

function toCriterionRow(
  key: string,
  evidence: RecommendationEvidence | undefined,
  profile: PatternDatasetProfile | undefined,
  marked: PlaceRef | null | undefined,
  inactive: boolean,
): TrefferCriterionRow {
  const coverage = normalizeCoverage(evidence?.coverage, evidence?.kind, profile?.yearlySeries.coverage);
  const inherited = isInherited(evidence, marked);
  const points = evidence?.points ?? [];
  const series = sparkFromPoints(points);
  const missingValue =
    coverage === "none" ||
    evidence?.kind === "absent" ||
    evidence?.status === "absent" ||
    evidence?.baselineMethod === "missing" ||
    (coverage !== "single" && coverage !== "series" && evidence?.normalizedValue == null && !series.some((point) => point.value != null)) ||
    evidence == null;

  const patternMissing = !hasMatchingPattern(evidence, profile);
  const patternSeries = patternMissing ? [] : sparkFromPoints(profile?.yearlySeries.points ?? []);
  const direction = arrowDirection(evidence);
  const stichtagYear = coverage === "single" ? stichtagYearOf(points) : null;
  const value =
    coverage === "single" && evidence?.normalizedValue != null ? formatNumber(evidence.normalizedValue) : null;
  const missing = missingValue || (coverage === "single" && value == null);
  const shownCoverage: "series" | "single" | "none" = missing && coverage !== "single" ? "none" : coverage;

  return {
    key,
    label: evidence?.label ?? profile?.criterion.label ?? key,
    inherited,
    inheritedLabel: inherited ? inheritedLabel(evidence?.sourceLevel ?? profile?.sourceLevel) : null,
    missing,
    coverage: shownCoverage,
    direction: shownCoverage === "series" && !missing ? direction : null,
    series: shownCoverage === "series" && !missing ? series : [],
    patternSeries,
    patternMissing,
    stichtagValue: coverage === "single" && !missing ? value : null,
    stichtagYear: coverage === "single" && !missing ? stichtagYear : null,
    baselineLabel: baselineLabel(evidence?.baseline ?? profile?.baseline),
    levelBadge: seriesLevelBadge(evidence?.sourceLevel ?? profile?.sourceLevel),
    methodLabel: baselineMethodLabel(evidence?.baselineMethod ?? profile?.baselineMethod ?? profile?.criterion.baselineMethod),
    proximityLabel: inactive ? null : proximityLabelFromEvidence(evidence),
    twoYearTrendLabel: inactive ? null : twoYearTrendLabelFromEvidence(evidence),
    details: {
      rawValue: evidence?.rawValue != null ? `Rohwert ${formatNumber(evidence.rawValue)}` : null,
      evidence: visibleEvidence(evidence?.evidence ?? profile?.criterion.evidence ?? ""),
      years: yearDetails(points, evidence?.baseline ?? profile?.baseline),
    },
  };
}

function normalizeCoverage(
  ...values: Array<SeriesCoverage | RecommendationEvidence["kind"] | undefined>
): "series" | "single" | "none" {
  for (const value of values) {
    if (value === "series" || value === "multi") return "series";
    if (value === "single" || value === "stichtag") return "single";
    if (value === "none" || value === "absent") return "none";
  }
  return "none";
}

function sparkFromPoints(points: readonly SeriesPoint[]): SparkPoint[] {
  return points.map((point) => ({
    period: point.period,
    value: point.status === "present" && point.normalizedValue != null ? point.normalizedValue : null,
  }));
}

function yearDetails(points: readonly SeriesPoint[], baseline: SeriesBaseline | undefined): TrefferYearDetail[] {
  return points.map((point) => ({
    period: yearOf(point.period),
    normalized:
      point.status === "present" && point.normalizedValue != null
        ? formatNumber(point.normalizedValue)
        : RECOMMENDATION_COPY.missingValue,
    raw: point.status === "present" && point.value != null ? formatNumber(point.value) : null,
    baseline: baselineLabel(baseline),
  }));
}

function hasMatchingPattern(
  evidence: RecommendationEvidence | undefined,
  profile: PatternDatasetProfile | undefined,
): boolean {
  if (!profile || !evidence) return false;
  if (!evidenceMatchesProfileMetric(evidence, profile)) return false;
  if (evidence.baselineMatch === false || profile.baselineMatch === false) return false;
  if (evidence.baseline && profile.baseline && evidence.baseline !== profile.baseline) return false;
  if (evidence.sourceLevel && profile.sourceLevel && evidence.sourceLevel !== profile.sourceLevel) return false;
  return true;
}

function profileMetricId(profile: PatternDatasetProfile): string {
  return profile.metricId || profile.yearlySeries.metricId;
}

function evidenceForProfile(
  evidence: readonly RecommendationEvidence[],
  profile: PatternDatasetProfile,
): RecommendationEvidence | undefined {
  const metricId = profileMetricId(profile);
  return (
    evidence.find((row) => row.metricId === metricId) ??
    evidence.find((row) => !row.metricId && (row.key === metricId || row.key === profile.criterion.key))
  );
}

function evidenceMatchesProfileMetric(
  evidence: RecommendationEvidence,
  profile: PatternDatasetProfile,
): boolean {
  const metricId = profileMetricId(profile);
  if (evidence.metricId) return evidence.metricId === metricId;
  return evidence.key === metricId || evidence.key === profile.criterion.key;
}

function yearFromDataAsOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const year = value.trim().slice(0, 4);
  return /^[0-9]{4}$/.test(year) ? year : null;
}

function isInherited(evidence: RecommendationEvidence | undefined, marked?: PlaceRef | null): boolean {
  if (evidence?.scope === "inherited") return true;
  if (!evidence?.sourceLevel || !marked) return false;
  return AREA_RANK[evidence.sourceLevel] >= areaRankOf(marked);
}

function arrowDirection(evidence: RecommendationEvidence | undefined): "up" | "down" | "flat" | null {
  if (!evidence) return null;
  if (evidence.direction === "up" || evidence.direction === "down" || evidence.direction === "flat") {
    return evidence.direction;
  }
  return null;
}

function stichtagYearOf(points: readonly SeriesPoint[]): string | null {
  const present = points.find((point) => point.status === "present");
  return present ? yearOf(present.period) : null;
}

function stichtagValueOf(points: readonly SeriesPoint[], fallback?: number | null): string | null {
  const present = points.find((point) => point.status === "present" && point.normalizedValue != null);
  const value = present?.normalizedValue ?? fallback ?? null;
  return value != null ? formatNumber(value) : null;
}

function yearOf(period: string): string {
  return period.slice(0, 4);
}

function visibleEvidence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isCatalogKey(trimmed)) return RECOMMENDATION_COPY.missingValue;
  return trimmed;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
}

function visiblePlaceText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || isCatalogKey(trimmed)) return "";
  return trimmed;
}

function hitPlace(item: Recommendation): {
  kind?: string | null;
  grain?: string | null;
  level?: string | null;
  geoKey?: string | null;
  id?: string | null;
} {
  return {
    kind: item.kind,
    grain: item.grain ?? item.location.grain,
    level: item.location.level,
    geoKey: locationKey(item),
    id: item.id,
  };
}

function isSameAsMarked(item: Recommendation, marked: PlaceRef): boolean {
  return samePlace({ id: item.id, geoKey: locationKey(item), label: item.location.name ?? item.title }, marked);
}

function dropParentsWhenChildHits(items: readonly Recommendation[]): Recommendation[] {
  return items.filter((item) => {
    const itemRank = areaRankOf(hitPlace(item));
    const itemName = hitName(item);
    return !items.some((other) => {
      if (other.id === item.id) return false;
      const otherRank = areaRankOf(hitPlace(other));
      if (otherRank >= itemRank) return false;
      const parent = catalogParentName(other.location) ?? catalogParentName(other);
      if (parent && parent === itemName) return true;
      const itemKey = locationKey(item);
      const otherKey = locationKey(other);
      if (itemKey && otherKey && otherKey !== itemKey && otherKey.includes(itemKey)) return true;
      return false;
    });
  });
}

function formatWindowStamp(stamp: string): string {
  const [year, month] = stamp.split("-");
  if (!month) return year ?? stamp;
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : stamp;
}
