import {
  displayMetricLabel,
  formatMetricNumber,
} from "./count-metrics";
import {
  attachNormalizedValues,
  baselineForMetric,
  baselineNoun,
  isPopulationMetric,
  latestBaselineMethod,
  latestNormalizedValue,
  latestRawValue,
  presentNormalizedPoints,
  SeriesBaseline,
} from "./series-baseline";
import {
  CriterionDirection,
  PatternCriterion,
} from "./types";
import {
  SeriesCoverage,
  SeriesLevel,
  SeriesPoint,
  YearlySeries,
} from "./yearly-series";

export type CriterionKind = "trend" | "stichtag";

const MAX_CRITERIA = 5;
const FLAT_BAND = 0.01;

const TREND_METRIC_ORDER = [
  "hamburg_stadtteil_regionalstatistik",
  "muenchen_indikatorenatlas",
  "berlin_lor_ewr_bevoelkerung",
  "koeln_statistischer_datenkatalog",
  "leipzig_lis_ortsteil",
  "duesseldorf_bevoelkerung_stadtteile",
  "essen_bevoelkerung_stadtteile",
  "frankfurt_demographie_stadtteile",
  "unfallatlas",
  "bevoelkerung",
  "wanderungen",
  "pendler",
  "kba_elektro_pkw",
  "destatis",
  "destatis_bevoelkerung_alter",
  "destatis_wohnungen",
  "destatis_kfz_bestand",
  "ba_sgb2",
  "vgrdl",
  "arbeitsmarkt",
] as const;

const STICHTAG_METRIC_ORDER = [
  "zensus2022",
  "breitband",
  "gerda",
  "gemeindeverzeichnis",
  "bundestagswahl",
  "rwi-redx",
  "wwk",
  "boris",
  "pks",
] as const;

const METRIC_LABELS: Record<string, string> = {
  unfallatlas: "Unfälle",
  bevoelkerung: "Bevölkerung",
  wanderungen: "Wanderungen",
  pendler: "Pendler",
  kba_elektro_pkw: "Elektro-Pkw",
  destatis: "Bevölkerung (Destatis)",
  destatis_bevoelkerung_alter: "Bevölkerung nach Alter",
  destatis_wohnungen: "Wohnungen",
  destatis_kfz_bestand: "Kfz-Bestand",
  ba_sgb2: "SGB II",
  vgrdl: "Einkommen",
  arbeitsmarkt: "Arbeitsmarkt",
  zensus2022: "Zensus 2022",
  breitband: "Breitband",
  gerda: "GERDA",
  gemeindeverzeichnis: "Gemeindeverzeichnis",
  bundestagswahl: "Bundestagswahl",
  "rwi-redx": "Kaufkraft",
  wwk: "WWK",
  boris: "Bodenrichtwert",
  pks: "Polizeiliche Kriminalstatistik",
  hamburg_stadtteil_regionalstatistik: "Bevölkerung (Hamburg Ortsteil)",
  muenchen_indikatorenatlas: "Indikatorenatlas (Stadtbezirk)",
  berlin_lor_ewr_bevoelkerung: "Bevölkerung (LOR)",
  koeln_statistischer_datenkatalog: "Statistischer Datenkatalog (Köln)",
  leipzig_lis_ortsteil: "Bevölkerung (Leipzig Ortsteil)",
  duesseldorf_bevoelkerung_stadtteile: "Bevölkerung (Düsseldorf Stadtteil)",
  essen_bevoelkerung_stadtteile: "Bevölkerung (Essen Stadtteil)",
  frankfurt_demographie_stadtteile: "Demographie (Frankfurt Stadtteil)",
};

const LEVEL_RANK: Record<string, number> = {
  address: 0,
  grid100: 1,
  lor: 2,
  quartier: 2,
  ortsteil: 3,
  stadtteil: 3,
  plz: 4,
  bezirk: 5,
  stadtbezirk: 5,
  gemeinde: 6,
  kreis: 7,
  land: 8,
};

/** Signal keys from older heuristic runs → yearlySeries metricId. */
const METRIC_ALIASES: Record<string, string[]> = {
  einwohner: [
    "bevoelkerung",
    "destatis",
    "hamburg_stadtteil_regionalstatistik",
    "berlin_lor_ewr_bevoelkerung",
    "koeln_statistischer_datenkatalog",
    "leipzig_lis_ortsteil",
    "duesseldorf_bevoelkerung_stadtteile",
    "essen_bevoelkerung_stadtteile",
    "frankfurt_demographie_stadtteile",
  ],
  einwohnerzahl: ["bevoelkerung", "destatis"],
  ewz: ["bevoelkerung", "destatis", "zensus2022"],
  bev_insgesamt: ["destatis", "bevoelkerung"],
  bevoelkerung: ["bevoelkerung", "destatis"],
  unfaelle: ["unfallatlas"],
  unfaelle_gesamt: ["unfallatlas"],
  unfallatlas: ["unfallatlas"],
  wohnungen: ["destatis_wohnungen"],
  haushalte: ["zensus2022", "bevoelkerung"],
};

export function metricIdsForCriterion(key: string): string[] {
  const trimmed = key.trim();
  if (!trimmed) return [];
  const aliased = METRIC_ALIASES[trimmed] ?? METRIC_ALIASES[trimmed.toLowerCase()];
  if (aliased) return aliased;
  return [trimmed];
}

export function presentPoints(points: SeriesPoint[]): Array<SeriesPoint & { value: number }> {
  return points.filter(
    (point): point is SeriesPoint & { value: number } =>
      point.status === "present" && typeof point.value === "number" && Number.isFinite(point.value),
  );
}

export function directionFromPoints(points: SeriesPoint[], field: "value" | "normalizedValue" = "value"): CriterionDirection {
  if (field === "normalizedValue") {
    const present = presentNormalizedPoints(points);
    if (present.length < 2) return "unknown";
    return directionBetween(present[0]!.normalizedValue, present[present.length - 1]!.normalizedValue);
  }
  const present = presentPoints(points);
  if (present.length < 2) return "unknown";
  return directionBetween(present[0]!.value, present[present.length - 1]!.value);
}

function directionBetween(first: number, last: number): CriterionDirection {
  const scale = Math.max(Math.abs(first), 1);
  if (Math.abs(last - first) / scale < FLAT_BAND) return "flat";
  return last > first ? "up" : "down";
}

export function kindFromCoverage(coverage: SeriesCoverage): CriterionKind | null {
  if (coverage === "multi" || coverage === "series") return "trend";
  if (coverage === "single") return "stichtag";
  return null;
}

export function metricLabel(metricId: string, sourceLevel?: SeriesLevel): string {
  const base = METRIC_LABELS[metricId] ?? displayMetricLabel(metricId);
  const noun = frameNoun(sourceLevel);
  return noun ? `${base} (${noun})` : base;
}

export function frameNoun(level: SeriesLevel | string | undefined): string | null {
  if (level === "kreis") return "Kreis";
  if (level === "land") return "Land";
  if (level === "gemeinde") return "Gemeinde";
  if (level === "plz") return "PLZ";
  if (level === "ortsteil" || level === "stadtteil") return "Ortsteil";
  if (level === "lor") return "LOR";
  if (level === "quartier") return "Quartier";
  if (level === "bezirk" || level === "stadtbezirk") return "Bezirk";
  if (level === "grid100") return "100-m-Raster";
  if (level === "address") return "Adresse";
  return null;
}

/**
 * Pattern criteria from store-surrounding yearly series.
 * Prefers three-year trends; leftover slots can be Stichtag snapshots.
 * Coverage `none` is skipped. Absent cells never become 0.
 */
export function criteriaFromYearlySeries(series: YearlySeries[]): PatternCriterion[] {
  const picked = pickSeriesForPattern(attachNormalizedValues(series));
  return picked.map((item) => toCriterion(item));
}

export function seriesEvidence(
  series: YearlySeries,
  direction: CriterionDirection,
  baseline?: SeriesBaseline,
): string {
  const label = metricLabel(series.metricId, series.sourceLevel);
  const present = presentPoints(series.points);
  if (present.length === 0) return `${label} liegt nicht vor.`;
  const usedBaseline = baseline ?? baselineForMetric(series.metricId, series.valueKey);
  const noun = baselineNoun(usedBaseline);
  const normalized = presentNormalizedPoints(series.points);
  if (normalized.length === 0) {
    return `${label} Rohwert liegt vor, Bezugsgröße (${noun}) liegt nicht vor.`;
  }
  const rendered = normalized
    .slice(0, 4)
    .map((point) => {
      const raw = formatMetricNumber(series.valueKey ?? series.metricId, point.value, series.metricId);
      const norm = formatMetricNumber(series.valueKey ?? series.metricId, point.normalizedValue, series.metricId);
      return `${point.period}: ${raw} Roh / ${norm} ${noun}`;
    })
    .join("; ");
  if (normalized.length < 2 || direction === "unknown") {
    return `${label} liegt als Stichtag vor (${rendered}). Eine Dreijahresrichtung ist daraus nicht ableitbar.`;
  }
  const word = direction === "up" ? "steigt" : direction === "down" ? "fällt" : "bleibt nahezu gleich";
  return `${label} ${word} im Dreijahresverlauf ${noun} (${rendered}).`;
}

export function absentEvidence(key: string, label: string): string {
  return `${label || displayMetricLabel(key)} liegt nicht vor.`;
}

function pickSeriesForPattern(series: YearlySeries[]): YearlySeries[] {
  const usable = series.filter((item) => item.coverage !== "none" && presentPoints(item.points).length > 0);
  const finest = new Map<string, YearlySeries>();
  for (const item of usable) {
    if (item.sourceLevel === "land") continue;
    if (isPopulationMetric(item.metricId)) continue;
    const current = finest.get(item.metricId);
    if (!current || preferSeries(item, current)) {
      finest.set(item.metricId, item);
    }
  }

  const chosen: YearlySeries[] = [];
  const take = (ids: readonly string[], coverage: SeriesCoverage) => {
    for (const id of ids) {
      if (chosen.length >= MAX_CRITERIA) return;
      const item = finest.get(id);
      if (!item || item.coverage !== coverage) continue;
      if (chosen.some((entry) => entry.metricId === id)) continue;
      chosen.push(item);
    }
  };

  take(TREND_METRIC_ORDER, "series");
  take(TREND_METRIC_ORDER, "multi");
  if (chosen.length < MAX_CRITERIA) {
    for (const item of [...finest.values()].sort(compareSeries)) {
      if (chosen.length >= MAX_CRITERIA) break;
      if (item.coverage !== "multi" && item.coverage !== "series") continue;
      if (chosen.some((entry) => entry.metricId === item.metricId)) continue;
      chosen.push(item);
    }
  }
  take(STICHTAG_METRIC_ORDER, "single");
  if (chosen.length < MAX_CRITERIA) {
    for (const item of [...finest.values()].sort(compareSeries)) {
      if (chosen.length >= MAX_CRITERIA) break;
      if (item.coverage !== "single") continue;
      if (chosen.some((entry) => entry.metricId === item.metricId)) continue;
      chosen.push(item);
    }
  }
  return chosen;
}

function toCriterion(series: YearlySeries): PatternCriterion {
  const baseline = baselineForMetric(series.metricId, series.valueKey);
  const normalized = presentNormalizedPoints(series.points);
  const direction =
    normalized.length >= 2 ? directionFromPoints(series.points, "normalizedValue") : "unknown";
  const kind =
    normalized.length >= 2
      ? "trend"
      : kindFromCoverage(series.coverage) ?? (direction === "unknown" ? "stichtag" : "trend");
  const label = metricLabel(series.metricId, series.sourceLevel);
  return {
    key: series.metricId,
    metricId: series.metricId,
    label,
    direction: kind === "stichtag" || normalized.length < 2 ? "unknown" : direction,
    evidence: seriesEvidence(series, kind === "stichtag" || normalized.length < 2 ? "unknown" : direction, baseline),
    kind: normalized.length >= 2 ? "trend" : kind,
    coverage: series.coverage,
    sourceLevel: series.sourceLevel,
    sourceGeoKey: series.sourceGeoKey,
    baseline,
    rawValue: latestRawValue(series.points),
    normalizedValue: latestNormalizedValue(series.points),
    baselineMethod: latestBaselineMethod(series.points),
  };
}

function preferSeries(item: YearlySeries, current: YearlySeries): boolean {
  const itemNorm = presentNormalizedPoints(item.points).length;
  const currentNorm = presentNormalizedPoints(current.points).length;
  if (itemNorm > 0 && currentNorm === 0) return true;
  if (itemNorm === 0 && currentNorm > 0) return false;
  return seriesLevelRank(item.sourceLevel) < seriesLevelRank(current.sourceLevel);
}

function compareSeries(left: YearlySeries, right: YearlySeries): number {
  const byLevel = seriesLevelRank(left.sourceLevel) - seriesLevelRank(right.sourceLevel);
  if (byLevel !== 0) return byLevel;
  return left.metricId.localeCompare(right.metricId);
}

export function seriesLevelRank(level: SeriesLevel | string): number {
  return LEVEL_RANK[level] ?? 9;
}
