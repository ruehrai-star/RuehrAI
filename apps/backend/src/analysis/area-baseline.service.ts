import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService, featuresReadQuery } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isGeoRefQuartierUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import {
  AREA_BASELINE_SQL,
  AreaBaselineRow,
  AreaBaselineSqlRow,
  BASELINE_METRIC_CATALOG_SQL,
  MetricCatalogEntry,
  MetricCatalogSqlRow,
  QUARTIER_GEOM_AREA_SQL,
  collectAreaLookupKeys,
  parseAreaBaselineRow,
  parseMetricCatalogRow,
  quartierGeomLookupKeys,
} from "./area-baseline";
import { attachNormalizedValues } from "./series-baseline";
import { YearlySeries } from "./yearly-series";

@Injectable()
export class AreaBaselineService {
  private readonly logger = new Logger(AreaBaselineService.name);
  private catalog: Map<string, MetricCatalogEntry> | null = null;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Baselined yearly series from `geo.area_baseline` + `geo.baseline_metric_catalog`
   * when those tables are readable. Missing table/role → series unchanged
   * (feature-derived fallback in `attachNormalizedValues`).
   */
  async normalize(series: YearlySeries[]): Promise<YearlySeries[]> {
    if (series.length === 0) return series;
    const catalog = await this.loadCatalog();
    const keys = collectAreaLookupKeys(series.flatMap((item) => [item.sourceGeoKey, item.requestedGeoKey]));
    const rows = keys.length === 0 ? [] : await this.loadRows(keys);
    return attachNormalizedValues(series, { catalog, rows });
  }

  async loadCatalog(): Promise<Map<string, MetricCatalogEntry>> {
    if (this.catalog) return this.catalog;
    const map = new Map<string, MetricCatalogEntry>();
    try {
      const result = await featuresReadQuery(this.db)<MetricCatalogSqlRow>(BASELINE_METRIC_CATALOG_SQL, []);
      for (const row of result.rows) {
        const entry = parseMetricCatalogRow(row);
        if (entry) map.set(entry.sourceTheme, entry);
      }
      this.catalog = map;
    } catch (error) {
      if (isCatalogMiss(error)) {
        this.logger.log(`Baseline-metric catalog read missed (${messageOf(error)}).`);
        this.catalog = map;
      } else {
        throw error;
      }
    }
    return map;
  }

  async loadRows(geoKeys: string[]): Promise<AreaBaselineRow[]> {
    if (geoKeys.length === 0) return [];
    try {
      const result = await featuresReadQuery(this.db)<AreaBaselineSqlRow>(AREA_BASELINE_SQL, [geoKeys]);
      const rows = result.rows.map(parseAreaBaselineRow).filter((row): row is AreaBaselineRow => row !== null);
      return this.withQuartierGeomArea(rows, geoKeys);
    } catch (error) {
      if (isCatalogMiss(error)) {
        this.logger.log(`Area-baseline read missed (${messageOf(error)}).`);
        return [];
      }
      throw error;
    }
  }

  /**
   * When `area_baseline` has no `flaeche_km2` for `koeln:sq:*`, use
   * `ST_Area(geo.geo_ref_quartier.geom)/1e6` (EPSG:3035). Official fill of
   * `area_baseline.flaeche_km2` remains the Data-Engineer task.
   */
  private async withQuartierGeomArea(rows: AreaBaselineRow[], geoKeys: string[]): Promise<AreaBaselineRow[]> {
    const quartierKeys = quartierGeomLookupKeys(geoKeys);
    if (quartierKeys.length === 0) return rows;
    const covered = new Set(
      rows.filter((row) => row.flaecheKm2 != null && row.flaecheKm2 > 0 && row.flaecheMethod !== "missing").map((row) => row.geoKey),
    );
    const missing = quartierKeys.filter((key) => !covered.has(key));
    if (missing.length === 0) return rows;
    try {
      const result = await featuresReadQuery(this.db)<AreaBaselineSqlRow>(QUARTIER_GEOM_AREA_SQL, [missing]);
      const extra = result.rows.map(parseAreaBaselineRow).filter((row): row is AreaBaselineRow => row !== null);
      if (extra.length === 0) return rows;
      const extraByKey = new Map(extra.map((row) => [row.geoKey, row]));
      const patched = rows.map((row) => {
        if (row.flaecheKm2 != null && row.flaecheKm2 > 0 && row.flaecheMethod !== "missing") return row;
        const geom = extraByKey.get(row.geoKey);
        if (!geom || geom.flaecheKm2 == null || !(geom.flaecheKm2 > 0)) return row;
        return { ...row, flaecheKm2: geom.flaecheKm2, flaecheMethod: geom.flaecheMethod ?? "geom" };
      });
      const covered = new Set(
        patched
          .filter((row) => row.flaecheKm2 != null && row.flaecheKm2 > 0 && row.flaecheMethod !== "missing")
          .map((row) => row.geoKey),
      );
      return [...patched, ...extra.filter((row) => !covered.has(row.geoKey))];
    } catch (error) {
      if (isCatalogMiss(error) || isGeoRefQuartierUnavailable(error)) {
        this.logger.log(`Quartier geom-area fallback missed (${messageOf(error)}).`);
        return rows;
      }
      throw error;
    }
  }
}

function isCatalogMiss(error: unknown): boolean {
  return isGeoCatalogUnavailable(error) || isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
