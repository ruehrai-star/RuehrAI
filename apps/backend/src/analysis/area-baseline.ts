import type { SeriesBaseline } from "./series-baseline";

/** Method of the Bezugsgröße actually used. `missing` means do not normalize. */
export const BASELINE_METHODS = [
  "official",
  "estimate_lor_sum",
  "estimate_address",
  "missing",
  "geom",
  "fixed_grid",
] as const;
export type BaselineMethod = (typeof BASELINE_METHODS)[number];

export const CATALOG_BASELINE_COLUMNS = ["einwohner", "flaeche_km2", "haushalte"] as const;
export type CatalogBaselineColumn = (typeof CATALOG_BASELINE_COLUMNS)[number];

export const AREA_SNAPSHOT_YEAR = 2026;

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
         flaeche_method
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
  };
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

export function buildAreaBaselineIndex(rows: AreaBaselineRow[]): Map<string, AreaBaselineRow> {
  const index = new Map<string, AreaBaselineRow>();
  for (const row of rows) {
    const key = `${row.geoKey}|${row.refYear}`;
    const current = index.get(key);
    if (!current || preferAreaRow(row, current)) index.set(key, row);
  }
  return index;
}

/**
 * Exact (geo_key, ref_year). For km², fall back to the 2026 geom snapshot
 * when the metric year has no area. Never fall back Einwohner across years.
 */
export function findAreaBaseline(
  index: Map<string, AreaBaselineRow>,
  geoKeys: string[],
  year: number,
  column: CatalogBaselineColumn,
): AreaBaselineRow | null {
  const aliases = collectAreaLookupKeys(geoKeys);
  for (const geoKey of aliases) {
    const exact = index.get(`${geoKey}|${year}`);
    if (exact && usableDivisor(exact, column)) return exact;
  }
  if (column === "flaeche_km2" && year !== AREA_SNAPSHOT_YEAR) {
    for (const geoKey of aliases) {
      const snapshot = index.get(`${geoKey}|${AREA_SNAPSHOT_YEAR}`);
      if (snapshot && usableDivisor(snapshot, column)) return snapshot;
    }
  }
  for (const geoKey of aliases) {
    const exact = index.get(`${geoKey}|${year}`);
    if (exact) return exact;
  }
  return null;
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
  if (method === "estimate_lor_sum") return 1;
  if (method === "estimate_address") return 2;
  if (method === "geom" || method === "fixed_grid") return 3;
  if (method === "missing") return 5;
  return 4;
}

function finiteOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
