import type { SeriesBaseline } from "./series-baseline";

/** Method of the Bezugsgröße actually used. `missing` means do not normalize. */
export const BASELINE_METHODS = [
  "official",
  "official_zensus2022_grid",
  "estimate_lor_sum",
  "estimate_zensus2022_grid_sum",
  "estimate_address",
  "missing",
  "geom",
  "fixed_grid",
] as const;
export type BaselineMethod = (typeof BASELINE_METHODS)[number];

const ZENSUS_EW_METHODS = new Set<BaselineMethod>(["official_zensus2022_grid", "estimate_zensus2022_grid_sum"]);

export const CATALOG_BASELINE_COLUMNS = ["einwohner", "flaeche_km2", "haushalte"] as const;
export type CatalogBaselineColumn = (typeof CATALOG_BASELINE_COLUMNS)[number];

export const AREA_SNAPSHOT_YEAR = 2026;
export const AREA_ZENSUS_YEAR = 2022;

export interface MetricCatalogEntry {
  sourceTheme: string;
  recommendedBaseline: CatalogBaselineColumn;
  unitHint: string | null;
}

export interface AreaBaselineRow {
  geoKey: string;
  grain: string;
  refYear: number;
  einwohner: number | null;
  flaecheKm2: number | null;
  haushalte: number | null;
  einwohnerMethod: string | null;
  haushalteMethod: string | null;
  flaecheMethod: string | null;
  attrs?: Record<string, unknown> | null;
  agsAliasOf?: string | null;
}

export interface AreaBaselineIndex {
  byKeyYear: Map<string, AreaBaselineRow>;
  byGeoKey: Map<string, AreaBaselineRow[]>;
}

export interface AreaBaselineSqlRow {
  geo_key: string | null;
  grain: string | null;
  ref_year: number | string | null;
  einwohner: number | string | null;
  flaeche_km2: number | string | null;
  haushalte: number | string | null;
  einwohner_method: string | null;
  haushalte_method: string | null;
  flaeche_method: string | null;
  attrs?: unknown;
}

export interface MetricCatalogSqlRow {
  source_theme: string | null;
  recommended_baseline: string | null;
  unit_hint: string | null;
}

/**
 * $1 geo_key[]  $2 ref_year[]
 * PK is (geo_key, grain, ref_year). Keys follow analysis conventions
 * (AGS8 / AGS5 / PLZ5 bare, bezirk:, ortsteil:, koeln:sq:, lor:plr:, …).
 */
export const AREA_BASELINE_SQL = `
  SELECT geo_key::text AS geo_key,
         grain::text AS grain,
         ref_year,
         einwohner,
         flaeche_km2,
         haushalte,
         einwohner_method,
         haushalte_method,
         flaeche_method,
         attrs
    FROM geo.area_baseline
   WHERE geo_key::text = ANY($1::text[])
     AND ref_year = ANY($2::int[])
`;

export const BASELINE_METRIC_CATALOG_SQL = `
  SELECT source_theme::text AS source_theme,
         recommended_baseline::text AS recommended_baseline,
         unit_hint::text AS unit_hint
    FROM geo.baseline_metric_catalog
`;

export function isBaselineMethod(value: unknown): value is BaselineMethod {
  return typeof value === "string" && (BASELINE_METHODS as readonly string[]).includes(value);
}

export function isCatalogBaselineColumn(value: unknown): value is CatalogBaselineColumn {
  return typeof value === "string" && (CATALOG_BASELINE_COLUMNS as readonly string[]).includes(value);
}

export function parseMetricCatalogRow(row: MetricCatalogSqlRow): MetricCatalogEntry | null {
  const sourceTheme = row.source_theme?.trim() ?? "";
  if (!sourceTheme || !isCatalogBaselineColumn(row.recommended_baseline)) return null;
  return {
    sourceTheme,
    recommendedBaseline: row.recommended_baseline,
    unitHint: row.unit_hint?.trim() || null,
  };
}

export function parseAreaBaselineRow(row: AreaBaselineSqlRow): AreaBaselineRow | null {
  const geoKey = row.geo_key?.trim() ?? "";
  const grain = row.grain?.trim() ?? "";
  const refYear = Number(row.ref_year);
  if (!geoKey || !Number.isFinite(refYear)) return null;
  const { attrs, agsAliasOf } = parseAttrs(row.attrs);
  return {
    geoKey,
    grain,
    refYear,
    einwohner: finiteOrNull(row.einwohner),
    flaecheKm2: finiteOrNull(row.flaeche_km2),
    haushalte: finiteOrNull(row.haushalte),
    einwohnerMethod: row.einwohner_method?.trim() || null,
    haushalteMethod: row.haushalte_method?.trim() || null,
    flaecheMethod: row.flaeche_method?.trim() || null,
    attrs,
    agsAliasOf,
  };
}

export function isZensusEinwohnerMethod(method: string | null | undefined): boolean {
  return typeof method === "string" && ZENSUS_EW_METHODS.has(method as BaselineMethod);
}

/** `attrs.preferred_ew` → Zensus year/method. Never invent a year. */
export function parsePreferredEw(attrs: Record<string, unknown> | null | undefined): {
  year: number | null;
  method: string | null;
} {
  if (!attrs) return { year: null, method: null };
  return preferredEwFrom(attrs.preferred_ew ?? attrs.preferredEw);
}

function parseAttrs(raw: unknown): { attrs: Record<string, unknown> | null; agsAliasOf: string | null } {
  const attrs = asAttrRecord(raw);
  if (!attrs) return { attrs: null, agsAliasOf: null };
  const alias = attrs.ags_alias_of ?? attrs.agsAliasOf;
  const agsAliasOf = typeof alias === "string" && alias.trim() ? alias.trim() : null;
  return { attrs, agsAliasOf };
}

function asAttrRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return asAttrRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

function preferredEwFrom(raw: unknown): { year: number | null; method: string | null } {
  if (raw == null || raw === "") return { year: null, method: null };
  if (typeof raw === "number" && Number.isFinite(raw)) return { year: raw, method: null };
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (isZensusEinwohnerMethod(trimmed) || isBaselineMethod(trimmed)) {
      return { year: /zensus2022/i.test(trimmed) ? AREA_ZENSUS_YEAR : null, method: trimmed };
    }
    const year = Number(trimmed);
    if (Number.isFinite(year) && year >= 2000 && year <= 2100) return { year, method: null };
    return { year: null, method: null };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const yearRaw = obj.year ?? obj.ref_year ?? obj.refYear;
    const yearNum = typeof yearRaw === "number" ? yearRaw : Number(yearRaw);
    const year = Number.isFinite(yearNum) && yearNum >= 2000 && yearNum <= 2100 ? yearNum : /zensus2022/i.test(String(obj.method ?? "")) ? AREA_ZENSUS_YEAR : null;
    const methodRaw = obj.method ?? obj.einwohner_method ?? obj.einwohnerMethod;
    const method = typeof methodRaw === "string" && methodRaw.trim() ? methodRaw.trim() : null;
    return { year, method };
  }
  return { year: null, method: null };
}

/** Catalog column + unit_hint → contract baseline and scale. Never scale with 1 as a stand-in for missing EW. */
export function catalogSeriesBaseline(entry: MetricCatalogEntry): { baseline: SeriesBaseline; scale: number } {
  if (entry.recommendedBaseline === "flaeche_km2") return { baseline: "per_km2", scale: 1 };
  if (entry.recommendedBaseline === "haushalte") {
    const perThousand = /1000|je_?1000|per_1000/i.test(entry.unitHint ?? "");
    return { baseline: "per_household", scale: perThousand ? 1000 : 1 };
  }
  const perCapita = /per_capita|je_einwohner/i.test(entry.unitHint ?? "") && !/1000/i.test(entry.unitHint ?? "");
  return { baseline: "per_1000_inhabitants", scale: perCapita ? 1 : 1000 };
}

export function areaKeyAliases(geoKey: string): string[] {
  const trimmed = geoKey.trim();
  if (!trimmed) return [];
  if (/^dwd1km:/i.test(trimmed)) return [trimmed];
  const keys = [trimmed];
  const prefixed =
    /^(ags|ags5|plz5|plz8|bezirk|stadtbezirk|ortsteil|stadtteil|quartier|grid100|address|hamburg_stadtteil):(.+)$/i.exec(
      trimmed,
    );
  if (prefixed?.[2]) {
    keys.push(prefixed[2]);
    if (/^hamburg_stadtteil:/i.test(trimmed)) keys.push(`ortsteil:${prefixed[2]}`);
    if (/^stadtteil:/i.test(trimmed)) keys.push(`ortsteil:${prefixed[2]}`);
    if (/^stadtbezirk:/i.test(trimmed)) keys.push(`bezirk:${prefixed[2]}`);
  }
  if (/^110000(0[1-9]|1[0-2])$/.test(trimmed)) keys.push(`bezirk:${trimmed}`);
  return unique(keys);
}

export function collectAreaLookupKeys(geoKeys: string[]): string[] {
  return unique(geoKeys.flatMap((key) => areaKeyAliases(key)));
}

export function buildAreaBaselineIndex(rows: AreaBaselineRow[]): AreaBaselineIndex {
  const byKeyYear = new Map<string, AreaBaselineRow>();
  const byGeoKey = new Map<string, AreaBaselineRow[]>();
  for (const row of rows) {
    const key = `${row.geoKey}|${row.refYear}`;
    const current = byKeyYear.get(key);
    if (!current || preferAreaRow(row, current)) byKeyYear.set(key, row);
    const list = byGeoKey.get(row.geoKey) ?? [];
    list.push(row);
    byGeoKey.set(row.geoKey, list);
  }
  return { byKeyYear, byGeoKey };
}

/**
 * Exact (geo_key, ref_year). For km², fall back to the 2026 geom snapshot.
 * Einwohner: same-year official wins; otherwise follow `attrs.preferred_ew`
 * to the Zensus row and never silently keep estimate_address when Zensus exists.
 */
export function findAreaBaseline(
  index: AreaBaselineIndex,
  geoKeys: string[],
  year: number,
  column: CatalogBaselineColumn,
): AreaBaselineRow | null {
  const aliases = collectAreaLookupKeys(geoKeys);
  if (column === "einwohner") return findEinwohnerBaseline(index, aliases, year);
  for (const geoKey of aliases) {
    const exact = index.byKeyYear.get(`${geoKey}|${year}`);
    if (exact && usableDivisor(exact, column)) return exact;
  }
  if (column === "flaeche_km2" && year !== AREA_SNAPSHOT_YEAR) {
    for (const geoKey of aliases) {
      const snapshot = index.byKeyYear.get(`${geoKey}|${AREA_SNAPSHOT_YEAR}`);
      if (snapshot && usableDivisor(snapshot, column)) return snapshot;
    }
  }
  for (const geoKey of aliases) {
    const exact = index.byKeyYear.get(`${geoKey}|${year}`);
    if (exact) return exact;
  }
  return null;
}

function findEinwohnerBaseline(index: AreaBaselineIndex, aliases: string[], year: number): AreaBaselineRow | null {
  const exact = firstExact(index, aliases, year);
  const related = rowsForAliases(index, aliases);
  const preferred = resolvePreferredEw(index, aliases, exact, related);
  const zensus = bestZensusRow(related);

  if (exact && usableDivisor(exact, "einwohner") && exact.einwohnerMethod === "official") return exact;
  if (preferred && usableDivisor(preferred, "einwohner")) return preferred;
  if (
    zensus &&
    (!exact || !usableDivisor(exact, "einwohner") || exact.einwohnerMethod === "estimate_address" || exact.einwohnerMethod === "missing")
  ) {
    return zensus;
  }
  if (exact && usableDivisor(exact, "einwohner")) return exact;
  if (exact) return exact;
  return zensus;
}

function firstExact(index: AreaBaselineIndex, aliases: string[], year: number): AreaBaselineRow | null {
  for (const geoKey of aliases) {
    const exact = index.byKeyYear.get(`${geoKey}|${year}`);
    if (exact) return exact;
  }
  return null;
}

function rowsForAliases(index: AreaBaselineIndex, aliases: string[]): AreaBaselineRow[] {
  const out: AreaBaselineRow[] = [];
  const seen = new Set<AreaBaselineRow>();
  for (const geoKey of aliases) {
    for (const row of index.byGeoKey.get(geoKey) ?? []) {
      if (seen.has(row)) continue;
      seen.add(row);
      out.push(row);
    }
  }
  return out;
}

function resolvePreferredEw(
  index: AreaBaselineIndex,
  aliases: string[],
  exact: AreaBaselineRow | null,
  related: AreaBaselineRow[],
): AreaBaselineRow | null {
  const hints = [parsePreferredEw(exact?.attrs), ...related.map((row) => parsePreferredEw(row.attrs))];
  for (const hint of hints) {
    if (hint.year == null && !hint.method) continue;
    const resolved = rowForPreferred(index, aliases, hint);
    if (resolved && usableDivisor(resolved, "einwohner")) return resolved;
  }
  return null;
}

function rowForPreferred(
  index: AreaBaselineIndex,
  aliases: string[],
  hint: { year: number | null; method: string | null },
): AreaBaselineRow | null {
  if (hint.year != null) {
    for (const geoKey of aliases) {
      const row = index.byKeyYear.get(`${geoKey}|${hint.year}`);
      if (!row) continue;
      if (hint.method && row.einwohnerMethod !== hint.method && !isZensusEinwohnerMethod(row.einwohnerMethod)) continue;
      if (usableDivisor(row, "einwohner")) return row;
    }
  }
  if (hint.method) {
    for (const geoKey of aliases) {
      for (const row of index.byGeoKey.get(geoKey) ?? []) {
        if (row.einwohnerMethod === hint.method && usableDivisor(row, "einwohner")) return row;
      }
    }
  }
  return null;
}

function bestZensusRow(rows: AreaBaselineRow[]): AreaBaselineRow | null {
  const usable = rows.filter((row) => isZensusEinwohnerMethod(row.einwohnerMethod) && usableDivisor(row, "einwohner"));
  usable.sort((left, right) => methodRank(left.einwohnerMethod) - methodRank(right.einwohnerMethod) || right.refYear - left.refYear);
  return usable[0] ?? null;
}

/** Method declared on the row. Einwohner/Haushalte never stay a silent NULL. */
export function columnMethod(row: AreaBaselineRow, column: CatalogBaselineColumn): BaselineMethod | null {
  const raw =
    column === "flaeche_km2" ? row.flaecheMethod : column === "haushalte" ? row.haushalteMethod : row.einwohnerMethod;
  if (isBaselineMethod(raw)) return raw;
  if (column !== "flaeche_km2") return "missing";
  return null;
}

export function areaDivisor(
  row: AreaBaselineRow | null,
  column: CatalogBaselineColumn,
): { value: number; method: BaselineMethod } | null {
  if (!row) return null;
  const method = columnMethod(row, column);
  if (method == null || method === "missing") return null;
  const value =
    column === "flaeche_km2" ? row.flaecheKm2 : column === "haushalte" ? row.haushalte : row.einwohner;
  if (value == null || !(value > 0)) return null;
  return { value, method };
}

function usableDivisor(row: AreaBaselineRow, column: CatalogBaselineColumn): boolean {
  return areaDivisor(row, column) != null;
}

function preferAreaRow(candidate: AreaBaselineRow, current: AreaBaselineRow): boolean {
  return methodRank(candidate.einwohnerMethod) < methodRank(current.einwohnerMethod);
}

function methodRank(method: string | null): number {
  if (method === "official") return 0;
  if (method === "official_zensus2022_grid") return 1;
  if (method === "estimate_zensus2022_grid_sum") return 2;
  if (method === "estimate_lor_sum") return 3;
  if (method === "estimate_address") return 4;
  if (method === "geom" || method === "fixed_grid") return 5;
  if (method === "missing") return 7;
  return 6;
}

function finiteOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
