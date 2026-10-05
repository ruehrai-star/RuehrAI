import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  isFeaturesAccessDenied,
  isGeoCatalogUnavailable,
  isMissingFeaturesRelation,
} from "../database/pg-error";
import { AnalysisStoreInput } from "./types";
import { SeriesRegionInput } from "./yearly-series";

interface PlzRow {
  plz: string | null;
  geo_ags: string | null;
  geo_ags5: string | null;
}

interface OrtsteilRow {
  geo_key: string | null;
  geo_ags: string | null;
}

interface BezirkRow {
  geo_key: string | null;
  geo_ags: string | null;
}

interface LorRow {
  geo_key: string | null;
  geo_ags: string | null;
}

export interface StoreSurroundings {
  regions: SeriesRegionInput[];
  keys: string[];
}

@Injectable()
export class StoreSurroundingsService {
  private readonly logger = new Logger(StoreSurroundingsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Ortsteil / PLZ near each Bestandstandort, plus that store's Gemeinde
   * and Kreis. Never the caller's Zielregion.
   */
  async resolve(stores: AnalysisStoreInput[]): Promise<StoreSurroundings> {
    const postalCodes = unique(
      stores.map((store) => store.postalCode?.trim()).filter((code): code is string => Boolean(code && /^[0-9]{5}$/.test(code))),
    );
    const points = stores.filter(
      (store) => store.lon != null && store.lat != null && Number.isFinite(store.lon) && Number.isFinite(store.lat),
    );
    const plzRows = await this.readPlz(postalCodes);
    const ortsteilRows = await this.readOrtsteilAtPoints(points);
    const bezirkRows = await this.readBezirkAtPoints(points);
    const lorRows = await this.readLorNearPoints(points);

    const regions: SeriesRegionInput[] = [];
    const keys: string[] = [];

    for (const plz of postalCodes) {
      pushRegion(regions, keys, { grain: "plz5", geoKey: plz, plz, level: "plz" });
      const row = plzRows.find((item) => item.plz === plz);
      if (row?.geo_ags) {
        pushRegion(regions, keys, { grain: "ags", geoKey: row.geo_ags, ags: row.geo_ags, level: "gemeinde" });
      }
      if (row?.geo_ags5) {
        pushRegion(regions, keys, { grain: "ags5", geoKey: row.geo_ags5, ags: row.geo_ags5, level: "kreis" });
      }
    }

    for (const row of ortsteilRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, {
        grain: "other",
        geoKey: row.geo_key,
        ags: row.geo_ags,
        level: row.geo_key.startsWith("stadtteil:") ? "stadtteil" : "ortsteil",
      });
    }

    for (const row of bezirkRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, {
        grain: row.geo_key.startsWith("bezirk:") || row.geo_key.startsWith("stadtbezirk:") ? "other" : "ags",
        geoKey: row.geo_key,
        ags: row.geo_ags,
        level: row.geo_key.startsWith("stadtbezirk:") ? "stadtbezirk" : "bezirk",
      });
    }

    for (const row of lorRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, {
        grain: "other",
        geoKey: row.geo_key,
        ags: row.geo_ags,
        level: "lor",
      });
    }

    return { regions, keys: unique(keys) };
  }

  private async readPlz(postalCodes: string[]): Promise<PlzRow[]> {
    if (postalCodes.length === 0) return [];
    return this.readCatalog<PlzRow>(
      `SELECT geo_plz5::text AS plz,
              NULLIF(btrim(geo_ags::text), '') AS geo_ags,
              NULLIF(btrim(geo_ags5::text), '') AS geo_ags5
         FROM geo.geo_ref_plz
        WHERE geo_plz5::text = ANY($1::text[])`,
      [postalCodes],
    );
  }

  private async readOrtsteilAtPoints(
    stores: AnalysisStoreInput[],
  ): Promise<OrtsteilRow[]> {
    if (stores.length === 0) return [];
    const rows: OrtsteilRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<OrtsteilRow>(
        `SELECT (lower(btrim(kind)) || ':' || geo_ortsteil_id::text) AS geo_key,
                NULLIF(btrim(geo_ags::text), '') AS geo_ags
           FROM geo.geo_ref_ortsteil
          WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
            AND lower(btrim(kind)) IN ('stadtteil', 'ortsteil')
            AND ST_Intersects(
              CASE
                WHEN ST_SRID(geom) IN (0, 4326) THEN ST_SetSRID(geom, 4326)
                ELSE ST_Transform(geom, 4326)
              END,
              ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)
            )
          ORDER BY geo_ortsteil_id ASC
          LIMIT 1`,
        [store.lon, store.lat],
      );
      rows.push(...found);
    }
    return rows;
  }

  private async readBezirkAtPoints(stores: AnalysisStoreInput[]): Promise<BezirkRow[]> {
    if (stores.length === 0) return [];
    const rows: BezirkRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<BezirkRow>(
        `SELECT CASE
                  WHEN geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$' THEN geo_bezirk_id::text
                  ELSE 'stadtbezirk:' || geo_bezirk_id::text
                END AS geo_key,
                NULLIF(btrim(geo_ags::text), '') AS geo_ags
           FROM geo.geo_ref_bezirk
          WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
            AND ST_Intersects(
              CASE
                WHEN ST_SRID(geom) IN (0, 4326) THEN ST_SetSRID(geom, 4326)
                ELSE ST_Transform(geom, 4326)
              END,
              ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)
            )
          ORDER BY geo_bezirk_id ASC
          LIMIT 1`,
        [store.lon, store.lat],
      );
      rows.push(...found);
    }
    return rows;
  }

  /**
   * Nearest Berlin LOR with stored lon/lat. No invented polygons; skip when
   * the feature docs have no coordinates.
   */
  private async readLorNearPoints(stores: AnalysisStoreInput[]): Promise<LorRow[]> {
    if (stores.length === 0) return [];
    const rows: LorRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<LorRow>(
        `SELECT geo_key::text AS geo_key,
                NULLIF(btrim(COALESCE(metadata->>'ags', metadata->>'geo_ags')), '') AS geo_ags
           FROM features.location_feature_docs
          WHERE source_theme = 'berlin_lor_ewr_bevoelkerung'
            AND geo_key LIKE 'lor:plr:%'
            AND lon IS NOT NULL AND lat IS NOT NULL
          ORDER BY ST_Distance(
            ST_SetSRID(ST_MakePoint(lon::float8, lat::float8), 4326)::geography,
            ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)::geography
          )
          LIMIT 1`,
        [store.lon, store.lat],
      );
      if (found.length > 0) {
        rows.push(...found);
        continue;
      }
      const legacy = await this.readCatalog<LorRow>(
        `SELECT geo_key::text AS geo_key,
                NULLIF(btrim(COALESCE(metadata->>'ags', metadata->>'geo_ags')), '') AS geo_ags
           FROM features.location_feature_docs
          WHERE source_theme = 'berlin_lor_ewr_bevoelkerung'
            AND geo_key LIKE 'lor:%'
            AND geo_key NOT LIKE 'lor:plr:%'
            AND lon IS NOT NULL AND lat IS NOT NULL
          ORDER BY ST_Distance(
            ST_SetSRID(ST_MakePoint(lon::float8, lat::float8), 4326)::geography,
            ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)::geography
          )
          LIMIT 1`,
        [store.lon, store.lat],
      );
      rows.push(...legacy);
    }
    return rows;
  }

  private async readCatalog<T extends object>(sql: string, params: unknown[]): Promise<T[]> {
    try {
      const result = await this.db.queryReadingFeatures<T>(sql, params);
      return result.rows;
    } catch (error) {
      if (isGeoCatalogUnavailable(error) || isMissingFeaturesRelation(error) || isFeaturesAccessDenied(error)) {
        this.logger.log(`Store-surroundings catalog read missed (${messageOf(error)}).`);
        return [];
      }
      throw error;
    }
  }
}

function pushRegion(regions: SeriesRegionInput[], keys: string[], region: SeriesRegionInput): void {
  const geoKey = region.geoKey?.trim();
  if (!geoKey) return;
  if (regions.some((item) => item.geoKey === geoKey && item.grain === region.grain)) return;
  regions.push(region);
  keys.push(geoKey);
  if (region.ags) keys.push(region.ags);
  if (region.plz) keys.push(region.plz);
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
