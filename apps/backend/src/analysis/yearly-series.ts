import { placeKeys } from "../address-pair/address-pair.service";
import {
  EXTRA_SERIES_METRICS,
  EXCLUDED_FEATURE_GRAINS,
  GEMEINDE_TOPIC_IDS,
  KREIS_TOPIC_IDS,
  LAND_TOPIC_IDS,
  SeriesMetricId,
  TopicLevel,
  grainMatchesTopic,
  themeMatchesTopic,
} from "../address-pair/topics";
import { storedRowValue } from "../address-pair/value";
import {
  CatalogLevel,
  catalogLevelForPlace,
  isCatalogLevel,
  officialAgsKey,
  parentMunicipalityAgs,
} from "../geo/geo-catalog";
import { canonicalBerlinBezirkAgs, isOfficialBerlinBezirkAgs, regionalstatistikBerlinBezirkAgs } from "../geo/bezirk-ags";
import { roundCountMetricValue } from "./count-metrics";

export interface SeriesRegionInput {
  grain?: string | null;
  geoKey?: string | null;
  level?: string | null;
  ags?: string | null;
  plz?: string | null;
}

export type SeriesLevel = CatalogLevel | "kreis" | "land";
export type SeriesGranularity = "month" | "year";
export type SeriesCoverage = "none" | "single" | "multi";
export type SeriesPointStatus = "present" | "absent";

export interface SeriesPoint {
  period: string;
  status: SeriesPointStatus;
  value?: number;
}

export interface YearlySeries {
  metricId: string;
  requestedLevel: SeriesLevel;
  requestedGeoKey: string;
  sourceLevel: SeriesLevel;
  sourceGeoKey: string;
  granularity: SeriesGranularity;
  coverage: SeriesCoverage;
  valueKey?: string;
  points: SeriesPoint[];
}

export interface SeriesFeatureRow {
  source_theme: string | null;
  grain: string | null;
  geo_key: string | null;
  metadata: unknown;
  ref_period: string | null;
}

export interface ParsedPeriod {
  year: number;
  month: number | null;
  yearStamp: string;
  monthStamp: string | null;
}

export interface RegionSourceKeys {
  requestedLevel: SeriesLevel;
  requestedGeoKey: string;
  requested: string[];
  bezirk: string[];
  plz: string[];
  gemeinde: string[];
  kreis: string[];
  land: string[];
  gemeindeKey: string | null;
  kreisKey: string | null;
  landKey: string | null;
  bezirkKey: string | null;
  bezirkRsKey: string | null;
}

const SKIP_VALUE_KEYS = new Set([
  "gemeinde_name",
  "geo_ags",
  "geo_ags5",
  "geo_land",
  "geo_land_name",
  "geo_key",
  "grain",
  "name",
  "title",
  "ref_period",
  "lon",
  "lat",
  "id",
  "source_theme",
  "source_tables",
  "ba_schluessel",
  "gemeinde_schluessel",
  "kreis_schluessel",
  "ags",
  "ags5",
  "rs",
]);

const NESTED_VALUE_BAGS = ["values", "werte", "indicators"] as const;

const KBA_ELEKTRO_COUNT_KEYS = new Set(["pkw_elektro", "pkw_insgesamt", "pkw_bev", "pkw_phev"]);

const PREFERRED_VALUE_KEYS = [
  "value",
  "count",
  "anzahl",
  "personen",
  "einwohner",
  "ewz",
  "arbeitslose",
  "insgesamt",
  "svb_wohnort",
  "bev_insgesamt",
  "wohnungen",
  "kfz",
  "gesamt",
  "pkw_elektro",
  "pkw_insgesamt",
  "kfz_insgesamt",
  "unfaelle_gesamt",
  "zuzuege",
  "saldo",
  "einw",
];

const METRIC_VALUE_KEYS: Partial<Record<string, readonly string[]>> = {
  bevoelkerung: ["insgesamt", "personen", "einwohner"],
  wanderungen: ["saldo", "zuzuege"],
  pendler: ["svb_wohnort", "count", "einpendler"],
  destatis: ["bev_insgesamt", "personen"],
  destatis_wohnungen: ["wohnungen"],
  destatis_kfz_bestand: ["kfz", "pkw"],
  destatis_bevoelkerung_alter: ["gesamt", "personen"],
  kba: ["pkw", "kfz_insgesamt"],
  kba_elektro_pkw: ["pkw_elektro", "pkw_insgesamt"],
  arbeitsmarkt: ["arbeitslose_insgesamt", "arbeitslose"],
  ba_sgb2: [
    "bedarfsgemeinschaften",
    "bg",
    "BG",
    "personen_sgb2",
    "pers",
    "PERS",
    "personen",
    "erwerbsfaehige_leistungsberechtigte",
    "elb",
    "ELB",
    "nicht_erwerbsfaehige_leistungsberechtigte",
    "nef",
    "NEF",
    "regelleistungsberechtigte",
    "rlb",
    "RLB",
  ],
  kba_neuzulassungen: ["kfz_insgesamt", "pkw"],
  kba_bestand: ["kfz_insgesamt", "pkw"],
  baugenehmigungen: ["wohnungen", "bauten", "value"],
  unfallatlas: ["unfaelle_gesamt", "count"],
  vgrdl: ["einw"],
  gerda: ["value", "count", "personen"],
};

const GEMEINDE_SET = new Set<string>(GEMEINDE_TOPIC_IDS);
const KREIS_SET = new Set<string>(KREIS_TOPIC_IDS);

/** Unique topic ids already used by address-pair, then extra Brain series themes. Finest native level first. */
export const SERIES_METRICS: ReadonlyArray<{ id: SeriesMetricId; homeLevel: TopicLevel }> = [
  ...GEMEINDE_TOPIC_IDS.map((id) => ({ id, homeLevel: "gemeinde" as const })),
  ...KREIS_TOPIC_IDS.filter((id) => !GEMEINDE_SET.has(id)).map((id) => ({ id, homeLevel: "kreis" as const })),
  ...LAND_TOPIC_IDS.filter((id) => !GEMEINDE_SET.has(id) && !KREIS_SET.has(id)).map((id) => ({
    id,
    homeLevel: "land" as const,
  })),
  ...EXTRA_SERIES_METRICS.map((metric) => ({ id: metric.id, homeLevel: metric.homeLevel })),
];

export function isSeriesLevel(value: unknown): value is SeriesLevel {
  return isCatalogLevel(value) || value === "kreis" || value === "land";
}

/**
 * Grain `ags5` and a 5-digit AGS (Köln `05315`) are Kreis.
 * CatalogLevel has no `kreis`; do not invent Gemeinde.
 */
export function isKreisPlace(region: SeriesRegionInput): boolean {
  const grain = region.grain ?? null;
  if (grain === "plz5" || grain === "plz8" || grain === "other") return false;
  const rawKey = region.geoKey ?? region.ags ?? "";
  if (/^(plz5|plz8|stadtteil|ortsteil|bezirk|stadtbezirk):/i.test(rawKey.trim())) return false;
  if (grain === "ags5") return true;
  return kreisAgsKey(region.geoKey) != null || kreisAgsKey(region.ags) != null;
}

export function requestedLevelOf(region: SeriesRegionInput): SeriesLevel | null {
  if (isSeriesLevel(region.level)) return region.level;
  const catalog = catalogLevelForPlace({
    grain: region.grain,
    geoKey: region.geoKey,
    ags: region.ags,
    level: region.level,
  });
  if (catalog) return catalog;
  if (isKreisPlace(region)) return "kreis";
  return null;
}

export function requestedGeoKeyOf(region: SeriesRegionInput): string | null {
  const key = emptyToNull(region.geoKey) ?? emptyToNull(region.ags) ?? emptyToNull(region.plz);
  return key;
}

export function parseRefPeriod(raw: string | null | undefined): ParsedPeriod | null {
  if (!raw) return null;
  const stamp = raw.trim().split("|")[0]?.trim() ?? "";
  const quarter = /^([0-9]{4})-Q([1-4])$/i.exec(stamp);
  if (quarter) {
    return { year: Number(quarter[1]), month: null, yearStamp: quarter[1]!, monthStamp: null };
  }
  const yearMonth = /^([0-9]{4})-([0-9]{2})$/.exec(stamp);
  if (yearMonth) {
    const month = Number(yearMonth[2]);
    if (month < 1 || month > 12) return null;
    return {
      year: Number(yearMonth[1]),
      month,
      yearStamp: yearMonth[1]!,
      monthStamp: `${yearMonth[1]}-${yearMonth[2]}`,
    };
  }
  const yearOnly = /^([0-9]{4})$/.exec(stamp);
  if (yearOnly) {
    return { year: Number(yearOnly[1]), month: null, yearStamp: yearOnly[1]!, monthStamp: null };
  }
  return null;
}

export function yearWindow(asOf: Date, availableYears: number[] = []): string[] {
  const asOfYear = asOf.getUTCFullYear();
  const latest = availableYears.length > 0 ? Math.max(...availableYears) : asOfYear;
  const end = latest < asOfYear && latest >= asOfYear - 2 ? latest : asOfYear;
  return [String(end - 2), String(end - 1), String(end)];
}

export function monthWindow(asOf: Date, availableMonths: string[] = []): string[] {
  const asOfStamp = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}`;
  const latest = [...availableMonths].filter(Boolean).sort().at(-1) ?? asOfStamp;
  const end =
    monthsBetween(latest, asOfStamp) === 1
      ? monthDate(latest)
      : new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const out: string[] = [];
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 35, 1));
  for (let i = 0; i < 36; i += 1) {
    const stamp = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    out.push(`${stamp.getUTCFullYear()}-${String(stamp.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function coverageOf(points: SeriesPoint[]): SeriesCoverage {
  const present = points.filter((point) => point.status === "present").length;
  if (present === 0) return "none";
  if (present === 1) return "single";
  return "multi";
}

/**
 * One stored numeric cell. A real 0 is a value. Missing, unreadable, or
 * placeholder cells are null — never coerced to 0 or {}. Geo identifiers
 * (`ba_schluessel`, `geo_ags`, …) are not metric numbers. Count-like keys
 * (wohnungen, ewz, SGB2 BG/PERS, …) are rounded; rates stay fractional.
 */
export function seriesNumber(metadata: unknown, metricId?: string): { value: number; key?: string } | null {
  if (typeof metadata === "number" && Number.isFinite(metadata)) {
    return { value: roundCountMetricValue("", metadata, metricId) };
  }
  if (typeof metadata === "string") {
    const numeric = asFiniteNumber(metadata);
    return numeric === null ? null : { value: roundCountMetricValue("", numeric, metricId) };
  }
  if (!isRecord(metadata)) return null;
  const cleaned = storedRowValue(metadata);
  if (!isRecord(cleaned)) return null;

  const numeric = collectNumericFields(cleaned);
  if (numeric.length === 0) return null;
  const preferred = [...(metricId ? (METRIC_VALUE_KEYS[metricId] ?? []) : []), ...PREFERRED_VALUE_KEYS];
  let hit: { key: string; value: number } | null = null;
  for (const key of preferred) {
    const found = numeric.find((item) => item.key === key);
    if (found) {
      hit = found;
      break;
    }
  }
  if (!hit && numeric.length === 1) hit = numeric[0]!;
  if (!hit) return null;
  return finalizeSeriesNumber(hit, numeric, metricId);
}

export function detectGranularity(periods: ParsedPeriod[]): SeriesGranularity {
  const monthsByYear = new Map<number, Set<number>>();
  for (const period of periods) {
    if (period.month == null) continue;
    const months = monthsByYear.get(period.year) ?? new Set<number>();
    months.add(period.month);
    monthsByYear.set(period.year, months);
  }
  for (const months of monthsByYear.values()) {
    if (months.size >= 2) return "month";
  }
  return "year";
}

export function municipalityAgsFrom(region: SeriesRegionInput): string | null {
  const key = officialAgsKey(region.geoKey) ?? officialAgsKey(region.ags);
  if (!key) return null;
  if (isOfficialBerlinBezirkAgs(key)) return "11000000";
  if (key.endsWith("000")) return key;
  return parentMunicipalityAgs(key);
}

export function parentsFromGemeinde(gemeindeAgs: string): { kreis: string; land: string | null } {
  const digits = gemeindeAgs.replace(/\D/g, "");
  const kreis = digits.length >= 5 ? digits.slice(0, 5) : digits;
  const land = digits.length >= 2 ? padDigits(digits.slice(0, 2), 2) : null;
  return { kreis, land };
}

/** 5-digit Kreis AGS. Not an 8-digit Gemeinde and not a PLZ. */
export function kreisAgsKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const stripped = stripPrefixedKey(value);
  return /^[0-9]{5}$/.test(stripped) ? stripped : null;
}

export function kreisAgsFrom(region: SeriesRegionInput): string | null {
  const fromFive = kreisAgsKey(region.geoKey) ?? kreisAgsKey(region.ags);
  if (fromFive) return fromFive;
  if (region.grain === "ags5") {
    const raw = emptyToNull(region.geoKey) ?? emptyToNull(region.ags);
    const digitsOnly = raw ? stripPrefixedKey(raw).replace(/\D/g, "") : "";
    if (digitsOnly.length >= 5) return padDigits(digitsOnly.slice(0, 5), 5);
  }
  const gemeinde = municipalityAgsFrom(region);
  return gemeinde ? parentsFromGemeinde(gemeinde).kreis : null;
}

export function keysForResolvedPlace(
  requestedLevel: SeriesLevel,
  requestedGeoKey: string,
  gemeindeAgs: string | null,
  kreisAgs: string | null,
  landAgs: string | null,
  extras: { bezirkOfficial?: string | null; plz?: string | null } = {},
): RegionSourceKeys {
  const resolvedKreis =
    kreisAgs ??
    (gemeindeAgs ? parentsFromGemeinde(gemeindeAgs).kreis : null) ??
    (requestedLevel === "kreis" ? kreisAgsKey(requestedGeoKey) ?? kreisAgsFrom({ grain: "ags5", geoKey: requestedGeoKey }) : null);
  const resolvedLand =
    landAgs ??
    (gemeindeAgs ? parentsFromGemeinde(gemeindeAgs).land : null) ??
    (resolvedKreis ? parentsFromGemeinde(resolvedKreis).land : null);
  const place = placeKeys(gemeindeAgs, resolvedKreis, resolvedLand);
  const bezirkOfficial =
    extras.bezirkOfficial ?? berlinOfficialFromRequested(requestedLevel, requestedGeoKey);
  const bezirkRs = bezirkOfficial ? regionalstatistikBerlinBezirkAgs(bezirkOfficial) : null;
  const landKey = resolvedLand ? (resolvedLand.startsWith("land:") ? resolvedLand : `land:${resolvedLand}`) : null;
  return {
    requestedLevel,
    requestedGeoKey,
    requested: requestedKeyVariants(requestedLevel, requestedGeoKey),
    bezirk: unique([
      bezirkOfficial,
      bezirkOfficial ? `bezirk:${bezirkOfficial}` : null,
      bezirkOfficial ? `ags:${bezirkOfficial}` : null,
    ]),
    plz: extras.plz ? requestedKeyVariants("plz", extras.plz) : requestedLevel === "plz" ? requestedKeyVariants("plz", requestedGeoKey) : [],
    gemeinde: place.gemeinde,
    kreis: place.kreis,
    land: unique([...place.land, landKey, resolvedLand]),
    gemeindeKey: gemeindeAgs,
    kreisKey: resolvedKreis,
    landKey: landKey ?? resolvedLand,
    bezirkKey: bezirkOfficial,
    bezirkRsKey: bezirkRs,
  };
}

export function requestedKeyVariants(level: SeriesLevel, geoKey: string): string[] {
  if (level === "plz") {
    const plz = geoKey.replace(/^(?:plz5|plz8):/i, "");
    return unique([plz, `plz5:${plz}`, geoKey]);
  }
  if (level === "land") {
    const land = geoKey.replace(/^(?:land|ags):/i, "");
    return unique([land, `land:${land}`, geoKey]);
  }
  const ags = officialAgsKey(geoKey);
  const kreis = level === "kreis" ? kreisAgsKey(geoKey) : null;
  const prefixes =
    level === "stadtteil" || level === "ortsteil"
      ? [level]
      : level === "bezirk" || level === "stadtbezirk"
        ? ["ags", "stadtbezirk", "bezirk"]
        : level === "kreis"
          ? ["ags", "ags5"]
          : ["ags"];
  const base = unique([geoKey, ags, kreis, stripPrefixedKey(geoKey)]);
  const prefixed = prefixes.flatMap((prefix) =>
    base.flatMap((value) => (value ? [`${prefix}:${value}`, value] : [])),
  );
  return unique([...base, ...prefixed]);
}

export function buildMetricSeries(input: {
  metricId: SeriesMetricId;
  homeLevel: TopicLevel;
  region: RegionSourceKeys;
  docs: SeriesFeatureRow[];
  asOf: Date;
}): YearlySeries {
  const chosen = pickSource(input.metricId, input.homeLevel, input.region, input.docs);
  const parsed = chosen.rows
    .map((row) => ({ row, period: parseRefPeriod(row.ref_period) }))
    .filter((item): item is { row: SeriesFeatureRow; period: ParsedPeriod } => item.period !== null);
  const granularity = detectGranularity(parsed.map((item) => item.period));
  const availableYears = parsed.map((item) => item.period.year);
  const availableMonths = parsed
    .map((item) => item.period.monthStamp)
    .filter((stamp): stamp is string => Boolean(stamp));
  const window = granularity === "month" ? monthWindow(input.asOf, availableMonths) : yearWindow(input.asOf, availableYears);
  const byPeriod = valuesByPeriod(input.metricId, parsed, granularity);

  const points: SeriesPoint[] = window.map((period) => {
    const found = byPeriod.get(period);
    if (!found) return { period, status: "absent" };
    return { period, status: "present", value: found.value };
  });

  const valueKeys = [...new Set([...byPeriod.values()].map((item) => item.key).filter((key): key is string => Boolean(key)))];
  const series: YearlySeries = {
    metricId: input.metricId,
    requestedLevel: input.region.requestedLevel,
    requestedGeoKey: input.region.requestedGeoKey,
    sourceLevel: chosen.level,
    sourceGeoKey: chosen.geoKey,
    granularity,
    coverage: coverageOf(points),
    points,
  };
  if (valueKeys.length === 1) series.valueKey = valueKeys[0];
  return series;
}

export function asOfFrom(capturedAt: string | undefined): Date {
  if (!capturedAt) return new Date();
  const parsed = new Date(capturedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function pickSource(
  metricId: SeriesMetricId,
  homeLevel: TopicLevel,
  region: RegionSourceKeys,
  docs: SeriesFeatureRow[],
): { level: SeriesLevel; geoKey: string; rows: SeriesFeatureRow[] } {
  const attempts: Array<{ level: SeriesLevel; keys: string[]; match: "topic" | "requested" }> = [];
  if (isSmallArea(region.requestedLevel) && region.requested.length > 0) {
    attempts.push({ level: region.requestedLevel, keys: region.requested, match: "requested" });
  }
  if (region.bezirk.length > 0) {
    attempts.push({
      level: region.requestedLevel === "plz" ? "bezirk" : isSmallArea(region.requestedLevel) ? "bezirk" : region.requestedLevel,
      keys: region.bezirk,
      match: "requested",
    });
  }
  if (region.plz.length > 0 && region.requestedLevel !== "plz") {
    attempts.push({ level: "plz", keys: region.plz, match: "requested" });
  }
  if (region.bezirkRsKey && grainMatchesTopic(null, metricId, "gemeinde")) {
    attempts.push({
      level: "gemeinde",
      keys: unique([region.bezirkRsKey, `ags:${region.bezirkRsKey}`]),
      match: "topic",
    });
  }
  if (grainMatchesTopic(null, metricId, "gemeinde")) {
    attempts.push({ level: "gemeinde", keys: region.gemeinde, match: "topic" });
  }
  if (grainMatchesTopic(null, metricId, "kreis")) {
    attempts.push({ level: "kreis", keys: region.kreis, match: "topic" });
  }
  if (grainMatchesTopic(null, metricId, "land")) {
    attempts.push({ level: "land", keys: region.land, match: "topic" });
  }
  if (attempts.length === 0) {
    attempts.push({
      level: homeLevel,
      keys: region[homeLevel],
      match: "topic",
    });
  }

  for (const attempt of attempts) {
    if (attempt.keys.length === 0) continue;
    const rows = docs.filter((row) => rowMatches(row, metricId, attempt));
    if (rows.length === 0) continue;
    const usable = rows.some((row) => parseRefPeriod(row.ref_period) && seriesNumber(row.metadata, metricId));
    if (!usable && !rows.some((row) => parseRefPeriod(row.ref_period))) continue;
    return {
      level: attempt.level,
      geoKey: storedGeoKey(rows) ?? canonicalSourceKey(attempt.level, region),
      rows,
    };
  }

  return { level: homeLevel, geoKey: canonicalSourceKey(homeLevel, region), rows: [] };
}

function valuesByPeriod(
  metricId: SeriesMetricId,
  parsed: Array<{ row: SeriesFeatureRow; period: ParsedPeriod }>,
  granularity: SeriesGranularity,
): Map<string, { value: number; key?: string }> {
  const grouped = new Map<string, SeriesFeatureRow[]>();
  for (const item of parsed) {
    const stamp = granularity === "month" ? item.period.monthStamp : item.period.yearStamp;
    if (!stamp) continue;
    const rows = grouped.get(stamp) ?? [];
    rows.push(item.row);
    grouped.set(stamp, rows);
  }

  const out = new Map<string, { value: number; key?: string }>();
  for (const [period, rows] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const metadata = metricId === "zensus2022" ? mergeMetadata(rows) : storedRowValue(pickLatest(rows).metadata);
    const numeric = seriesNumber(metadata, metricId);
    if (!numeric) continue;
    out.set(period, numeric);
  }
  return out;
}

function rowMatches(
  row: SeriesFeatureRow,
  metricId: SeriesMetricId,
  attempt: { level: SeriesLevel; keys: string[]; match: "topic" | "requested" },
): boolean {
  const theme = row.source_theme?.trim() ?? "";
  if (!theme || !themeMatchesTopic(theme, metricId)) return false;
  if (attempt.match === "requested") {
    if (isExcludedGrain(row.grain)) return false;
    if (row.grain === "ags" || row.grain === "ags5") return false;
    return rowKeyHits(row, attempt.keys);
  }
  if (attempt.level !== "gemeinde" && attempt.level !== "kreis" && attempt.level !== "land") return false;
  if (!grainMatchesTopic(row.grain, metricId, attempt.level)) return false;
  return rowKeyHits(row, attempt.keys);
}

function rowKeyHits(row: SeriesFeatureRow, keys: string[]): boolean {
  const wanted = new Set(keys);
  if (wanted.size === 0) return false;
  const candidates = [
    row.geo_key,
    metadataText(row.metadata, "geo_ags"),
    metadataText(row.metadata, "geo_ags5"),
    metadataText(row.metadata, "geo_land"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (wanted.has(candidate)) return true;
    const stripped = stripPrefixedKey(candidate);
    if (wanted.has(stripped)) return true;
    const digitsOnly = digits(stripped);
    if (digitsOnly && (wanted.has(digitsOnly) || wanted.has(padDigits(digitsOnly, digitsOnly.length)))) {
      return true;
    }
  }
  return false;
}

function canonicalSourceKey(level: SeriesLevel, region: RegionSourceKeys): string {
  if (level === "gemeinde") return region.bezirkRsKey ?? region.gemeindeKey ?? region.requestedGeoKey;
  if (level === "kreis") return region.kreisKey ?? region.requestedGeoKey;
  if (level === "land") return region.landKey ?? region.requestedGeoKey;
  if (level === "bezirk") return region.bezirkKey ?? region.requestedGeoKey;
  if (level === "plz") return region.plz[0] ?? region.requestedGeoKey;
  return region.requestedGeoKey;
}

function storedGeoKey(rows: SeriesFeatureRow[]): string | null {
  const ordered = [...rows].sort((left, right) => comparePeriod(right.ref_period, left.ref_period));
  const key = emptyToNull(ordered[0]?.geo_key);
  return key;
}

function pickLatest(rows: SeriesFeatureRow[]): SeriesFeatureRow {
  return [...rows].sort((left, right) => {
    const period = comparePeriod(right.ref_period, left.ref_period);
    if (period !== 0) return period;
    return (left.geo_key ?? "").localeCompare(right.geo_key ?? "");
  })[0]!;
}

function mergeMetadata(rows: SeriesFeatureRow[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const row of rows) {
    const cleaned = storedRowValue(row.metadata);
    if (!isRecord(cleaned)) continue;
    Object.assign(merged, cleaned);
  }
  return merged;
}

function comparePeriod(left: string | null, right: string | null): number {
  return (left ?? "").localeCompare(right ?? "");
}

function isSmallArea(level: SeriesLevel): boolean {
  return level === "plz" || level === "bezirk" || level === "stadtbezirk" || level === "stadtteil" || level === "ortsteil";
}

function isExcludedGrain(grain: string | null): boolean {
  return grain != null && (EXCLUDED_FEATURE_GRAINS as readonly string[]).includes(grain);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function metadataText(metadata: unknown, key: string): string | null {
  if (!isRecord(metadata)) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripPrefixedKey(value: string): string {
  const match = /^(?:ags|ags5|land|plz5|plz8|stadtteil|ortsteil|stadtbezirk|bezirk):(.+)$/i.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function berlinOfficialFromRequested(level: SeriesLevel, geoKey: string): string | null {
  if (level !== "bezirk" && level !== "stadtbezirk") return null;
  const bare = officialAgsKey(geoKey) ?? digits(stripPrefixedKey(geoKey));
  if (!bare) return null;
  const official = canonicalBerlinBezirkAgs(bare);
  return isOfficialBerlinBezirkAgs(official) ? official : null;
}

function collectNumericFields(row: Record<string, unknown>): Array<{ key: string; value: number }> {
  const numeric: Array<{ key: string; value: number }> = [];
  const bags: Record<string, unknown>[] = [row];
  for (const nested of NESTED_VALUE_BAGS) {
    if (isRecord(row[nested])) bags.push(row[nested]);
  }
  for (const bag of bags) {
    for (const [key, value] of Object.entries(bag)) {
      if (isSkippedValueKey(key) || isNestedValueBag(key)) continue;
      const parsed = asFiniteNumber(value);
      if (parsed === null) continue;
      numeric.push({ key, value: parsed });
    }
  }
  return numeric;
}

function isSkippedValueKey(key: string): boolean {
  if (SKIP_VALUE_KEYS.has(key)) return true;
  if (/schluessel$/i.test(key)) return true;
  if (/^geo_/i.test(key)) return true;
  if (/^source_/i.test(key)) return true;
  return false;
}

function isNestedValueBag(key: string): boolean {
  return (NESTED_VALUE_BAGS as readonly string[]).includes(key);
}

function finalizeSeriesNumber(
  hit: { key: string; value: number },
  numeric: Array<{ key: string; value: number }>,
  metricId?: string,
): { value: number; key?: string } | null {
  if (isSuppressedKbaElektroZero(hit, numeric, metricId)) return null;
  return { key: hit.key, value: roundCountMetricValue(hit.key, hit.value, metricId) };
}

function isSuppressedKbaElektroZero(
  hit: { key: string; value: number },
  numeric: Array<{ key: string; value: number }>,
  metricId?: string,
): boolean {
  if (metricId && metricId !== "kba_elektro_pkw") return false;
  if (!KBA_ELEKTRO_COUNT_KEYS.has(hit.key) || hit.value !== 0) return false;
  const anteil = numeric.find((item) => item.key === "pkw_elektro_anteil" || /anteil/i.test(item.key));
  if (anteil != null && anteil.value > 0) return true;
  const elektro = numeric.find((item) => item.key === "pkw_elektro");
  const insgesamt = numeric.find((item) => item.key === "pkw_insgesamt");
  return Boolean(elektro && insgesamt && elektro.value === 0 && insgesamt.value === 0);
}

function digits(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[0-9]+$/.test(trimmed) ? trimmed : null;
}

function padDigits(value: string, width: number): string {
  return value.length >= width ? value : value.padStart(width, "0");
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function monthDate(stamp: string): Date {
  const [year, month] = stamp.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 1));
}

function monthsBetween(earlier: string, later: string): number {
  const start = monthDate(earlier);
  const end = monthDate(later);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
}
