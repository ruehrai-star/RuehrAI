import { Injectable, Logger } from "@nestjs/common";
import { toCoord } from "../customer/values";
import { DatabaseService } from "../database/database.service";
import { isGeoCatalogUnavailable, isMissingFeaturesRelation } from "../database/pg-error";
import { SearchQueryDto } from "../search/search.dto";
import { searchFilterParams } from "../search/search.util";
import {
  CatalogHitRow,
  CatalogSearchHit,
  GEO_BEZIRK_OUTLINE_SQL,
  GEO_CATALOG_SEARCH_SQL,
  GEO_CATALOG_SEARCH_SQL_NO_ADMIN,
  GEO_ORTSTEIL_OUTLINE_SQL,
  GEO_PLZ_OUTLINE_SQL,
  catalogLookupPlan,
  toCatalogHit,
} from "./geo-catalog";
import { LonLat } from "./region-geometry";

export interface GeoOutlineHit {
  geometry: unknown | null;
  point: LonLat | null;
}

interface OutlineRow {
  geometry?: unknown;
  lon?: unknown;
  lat?: unknown;
}

@Injectable()
export class GeoCatalogService {
  private readonly logger = new Logger(GeoCatalogService.name);
  private skipAdminJoin = false;
  private unavailableNoted = false;

  constructor(private readonly db: DatabaseService) {}

  async search(query: SearchQueryDto): Promise<CatalogSearchHit[]> {
    const params = searchFilterParams(query);
    try {
      return await this.runSearch(this.skipAdminJoin ? GEO_CATALOG_SEARCH_SQL_NO_ADMIN : GEO_CATALOG_SEARCH_SQL, params);
    } catch (error) {
      if (!this.skipAdminJoin && isMissingAdmin(error)) {
        this.skipAdminJoin = true;
        this.logger.log("GET /search reads geo.* without geo.geo_ref_admin; parentLabel is filled only for Berlin.");
        return this.runSearch(GEO_CATALOG_SEARCH_SQL_NO_ADMIN, params);
      }
      if (isGeoCatalogUnavailable(error)) {
        this.noteUnavailable(error);
        return [];
      }
      throw error;
    }
  }

  async lookupOutline(input: {
    grain: string | null;
    geoKey: string | null;
    ags: string | null;
    plz: string | null;
  }): Promise<GeoOutlineHit | null> {
    const plan = catalogLookupPlan(input);
    const attempts: Array<Promise<GeoOutlineHit | null>> = [];
    if (plan.plz) attempts.push(this.queryOutline(GEO_PLZ_OUTLINE_SQL, plan.plz));
    if (plan.bezirkId) attempts.push(this.queryOutline(GEO_BEZIRK_OUTLINE_SQL, plan.bezirkId));
    if (plan.ortsteilId) attempts.push(this.queryOutline(GEO_ORTSTEIL_OUTLINE_SQL, plan.ortsteilId));
    if (attempts.length === 0) return null;
    const hits = await Promise.all(attempts);
    return hits.find((hit) => hit?.geometry) ?? hits.find((hit) => hit) ?? null;
  }

  private async runSearch(sql: string, params: unknown[]): Promise<CatalogSearchHit[]> {
    const result = await this.db.queryReadingFeatures<CatalogHitRow>(sql, params);
    return result.rows.map(toCatalogHit).filter((hit): hit is CatalogSearchHit => hit !== null);
  }

  private async queryOutline(sql: string, key: string): Promise<GeoOutlineHit | null> {
    try {
      const result = await this.db.queryReadingFeatures<OutlineRow>(sql, [key]);
      return outlineFrom(result.rows[0]);
    } catch (error) {
      if (isGeoCatalogUnavailable(error)) {
        this.noteUnavailable(error);
        return null;
      }
      throw error;
    }
  }

  private noteUnavailable(error: unknown): void {
    if (this.unavailableNoted) return;
    this.unavailableNoted = true;
    const message = error instanceof Error ? error.message : "unknown error";
    this.logger.log(`Brain geo catalog is unavailable (${message}).`);
  }
}

function isMissingAdmin(error: unknown): boolean {
  if (!isMissingFeaturesRelation(error) && !isGeoCatalogUnavailable(error)) return false;
  const message = error instanceof Error ? error.message : "";
  return /geo_ref_admin/i.test(message);
}

function outlineFrom(row: OutlineRow | undefined): GeoOutlineHit | null {
  if (!row) return null;
  let geometry: unknown = row.geometry;
  if (typeof geometry === "string") {
    try {
      geometry = JSON.parse(geometry) as unknown;
    } catch {
      geometry = null;
    }
  }
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
    geometry = null;
  } else {
    const type = (geometry as { type?: unknown }).type;
    if (type !== "Polygon" && type !== "MultiPolygon") geometry = null;
  }
  const lon = toCoord(row.lon as number | string | null | undefined);
  const lat = toCoord(row.lat as number | string | null | undefined);
  const point: LonLat | null = lon !== null && lat !== null ? { lon, lat } : null;
  if (!geometry && !point) return null;
  return { geometry, point };
}
