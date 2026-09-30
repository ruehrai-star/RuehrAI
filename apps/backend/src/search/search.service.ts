import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { isMissingFeaturesRelation } from "../database/pg-error";
import { SearchQueryDto } from "./search.dto";
import { toContainsPattern } from "./search.util";

/**
 * Place id for search pickers that call `PUT /target-region`. Not an overlay
 * polygon. The write copies a Polygon or MultiPolygon from `app.map_features`
 * for this grain and geoKey. Catalog rows that are missing those polygons
 * need them from Location-Guide (official outlines). A point still anchors
 * the interim stub rectangle; without a point, geometry, or bounds, PUT is 400
 * and does not clear a previously stored polygon.
 */
export interface SearchHit {
  id: string;
  label: string;
  grain: string;
  geoKey: string | null;
  lon: number | null;
  lat: number | null;
}

interface HitRow {
  id: string;
  label: string;
  grain: string;
  geo_key: string | null;
  lon: number | string | null;
  lat: number | string | null;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private fallbackNoted = false;

  constructor(private readonly db: DatabaseService) {}

  async search(query: SearchQueryDto): Promise<{ hits: SearchHit[] }> {
    const fromView = await this.searchFeatureView(query);
    if (fromView) return { hits: fromView };
    return { hits: await this.searchSeed(query) };
  }

  private async searchFeatureView(query: SearchQueryDto): Promise<SearchHit[] | null> {
    try {
      const probe = await this.db.queryReadingFeatures<{ has_rows: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM features.v_location_search) AS has_rows",
      );
      if (!probe.rows[0]?.has_rows) {
        this.noteFallback("features.v_location_search is empty");
        return null;
      }
      const result = await this.db.queryReadingFeatures<HitRow>(
        FEATURE_SEARCH_SQL,
        filterParams(query),
      );
      return result.rows.map(toHit);
    } catch (error) {
      if (isMissingFeaturesRelation(error)) {
        this.noteFallback("features.v_location_search is not installed");
        return null;
      }
      throw error;
    }
  }

  private async searchSeed(query: SearchQueryDto): Promise<SearchHit[]> {
    const result = await this.db.query<HitRow>(SEED_SEARCH_SQL, filterParams(query));
    return result.rows.map(toHit);
  }

  private noteFallback(reason: string): void {
    if (this.fallbackNoted) return;
    this.fallbackNoted = true;
    this.logger.log(`GET /search is using app.search_places (${reason}).`);
  }
}

function filterParams(query: SearchQueryDto): unknown[] {
  return [
    query.ags ?? null,
    query.plz ?? null,
    query.address ? toContainsPattern(query.address) : null,
    query.q ? toContainsPattern(query.q) : null,
    query.type ?? null,
    query.geoKey ?? null,
    query.grain ?? null,
  ];
}

function toHit(row: HitRow): SearchHit {
  return {
    id: row.id,
    label: row.label,
    grain: row.grain,
    geoKey: row.geo_key ?? null,
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
  };
}

function toCoord(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const TEXT_MATCH = `
  name ILIKE $4 ESCAPE '\\'
  OR title ILIKE $4 ESCAPE '\\'
  OR geo_key ILIKE $4 ESCAPE '\\'
`;

/** Equality on geo_key uses the Brain btree. Leading-wildcard ILIKE stays a sequential scan at this size. */
const FEATURE_SEARCH_SQL = `
  SELECT id::text AS id,
         COALESCE(
           NULLIF(btrim(name), ''),
           NULLIF(btrim(title), ''),
           NULLIF(btrim(geo_key), ''),
           id::text
         ) AS label,
         grain,
         geo_key,
         lon,
         lat
  FROM features.v_location_search
  WHERE ($1::text IS NULL OR (grain = 'ags' AND geo_key = $1))
    AND ($2::text IS NULL OR (grain IN ('plz5', 'plz8') AND geo_key = $2))
    AND (
      $3::text IS NULL
      OR name ILIKE $3 ESCAPE '\\'
      OR title ILIKE $3 ESCAPE '\\'
      OR geo_key ILIKE $3 ESCAPE '\\'
    )
    AND ($6::text IS NULL OR geo_key = $6)
    AND ($7::text IS NULL OR grain = $7)
    AND (
      $4::text IS NULL
      OR (
        $5::text = 'ags'
        AND grain = 'ags'
        AND (${TEXT_MATCH})
      )
      OR (
        $5::text = 'plz'
        AND grain IN ('plz5', 'plz8')
        AND (${TEXT_MATCH})
      )
      OR (
        $5::text = 'address'
        AND grain = 'address'
        AND (${TEXT_MATCH})
      )
      OR (
        $5::text IS NULL
        AND (${TEXT_MATCH})
      )
    )
  ORDER BY label ASC, id ASC
  LIMIT 50
`;

const SEED_SEARCH_SQL = `
  SELECT id,
         label,
         grain,
         CASE
           WHEN grain IN ('plz5', 'plz8') THEN plz
           WHEN grain IN ('ags', 'ags5') THEN ags
           ELSE id
         END AS geo_key,
         lon,
         lat
  FROM app.search_places
  WHERE ($1::text IS NULL OR ags = $1)
    AND ($2::text IS NULL OR plz = $2)
    AND (
      $3::text IS NULL
      OR address ILIKE $3 ESCAPE '\\'
      OR label ILIKE $3 ESCAPE '\\'
    )
    AND ($6::text IS NULL OR id = $6 OR ags = $6 OR plz = $6)
    AND ($7::text IS NULL OR grain = $7)
    AND (
      $4::text IS NULL
      OR ($5::text = 'ags' AND ags ILIKE $4 ESCAPE '\\')
      OR ($5::text = 'plz' AND plz ILIKE $4 ESCAPE '\\')
      OR (
        $5::text = 'address'
        AND (
          address ILIKE $4 ESCAPE '\\'
          OR label ILIKE $4 ESCAPE '\\'
        )
      )
      OR (
        $5::text IS NULL
        AND (
          label ILIKE $4 ESCAPE '\\'
          OR COALESCE(ags, '') ILIKE $4 ESCAPE '\\'
          OR COALESCE(plz, '') ILIKE $4 ESCAPE '\\'
          OR COALESCE(address, '') ILIKE $4 ESCAPE '\\'
        )
      )
    )
  ORDER BY label ASC, id ASC
  LIMIT 50
`;
