import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import {
  AREA_BASELINE_SQL,
  AreaBaselineRow,
  AreaBaselineSqlRow,
  BASELINE_METRIC_CATALOG_SQL,
  MetricCatalogEntry,
  MetricCatalogSqlRow,
  collectAreaLookupKeys,
  parseAreaBaselineRow,
  parseMetricCatalogRow,
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
      const result = await this.db.queryReadingFeatures<MetricCatalogSqlRow>(BASELINE_METRIC_CATALOG_SQL, []);
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
      const result = await this.db.queryReadingFeatures<AreaBaselineSqlRow>(AREA_BASELINE_SQL, [geoKeys]);
      return result.rows.map(parseAreaBaselineRow).filter((row): row is AreaBaselineRow => row !== null);
    } catch (error) {
      if (isCatalogMiss(error)) {
        this.logger.log(`Area-baseline read missed (${messageOf(error)}).`);
        return [];
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
