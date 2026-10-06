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

interface GeoKeyRow {
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
  /** `unknown` until probed; `skip` when no usable address key exists. */
  private addressLookup: "unknown" | "skip" | AddressLookupPlan = "unknown";

  constructor(private readonly db: DatabaseService) {}

  /**
   * Spiegelbildlich to Zielregion analysis: Adresse → Raster → LOR/Quartier
   * → Ortsteil → PLZ5 → Bezirk → Gemeinde, Kreis as Rahmen. Never the
   * caller's Zielregion. Address / missing catalogs are skipped, never invented.
   */
  async resolve(stores: AnalysisStoreInput[]): Promise<StoreSurroundings> {
    const postalCodes = unique(
      stores.map((store) => store.postalCode?.trim()).filter((code): code is string => Boolean(code && /^[0-9]{5}$/.test(code))),
    );
    const points = stores.filter(
      (store) => store.lon != null && store.lat != null && Number.isFinite(store.lon) && Number.isFinite(store.lat),
    );
    const plzRows = await this.readPlz(postalCodes);
    const addressRows = await this.readAddressAtPoints(points);
    const gridRows = await this.readGridAtPoints(points);
    const ortsteilRows = await this.readOrtsteilAtPoints(points);
    const bezirkRows = await this.readBezirkAtPoints(points);
    const lorRows = await this.readLorNearPoints(points);
    const quartierRows = await this.readQuartierNearPoints(koelnPoints(points, postalCodes, plzRows));

    const regions: SeriesRegionInput[] = [];
    const keys: string[] = [];

    for (const row of addressRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, { grain: "address", geoKey: row.geo_key, ags: row.geo_ags, level: "address" });
    }
    for (const row of gridRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, { grain: "grid100", geoKey: row.geo_key, ags: row.geo_ags, level: "grid100" });
    }
    for (const row of lorRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, { grain: "other", geoKey: row.geo_key, ags: row.geo_ags, level: "lor" });
    }
    for (const row of quartierRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, { grain: "other", geoKey: row.geo_key, ags: row.geo_ags, level: "quartier" });
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
    for (const row of bezirkRows) {
      if (!row.geo_key) continue;
      pushRegion(regions, keys, {
        grain: row.geo_key.startsWith("bezirk:") || row.geo_key.startsWith("stadtbezirk:") ? "other" : "ags",
        geoKey: row.geo_key,
        ags: row.geo_ags,
        level: row.geo_key.startsWith("stadtbezirk:") ? "stadtbezirk" : "bezirk",
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

  /**
   * Official address at the store point (`geo.geo_ref_address`). Skip when
   * the table/columns are missing or empty — never invent an address.
   * STAGE may lack `geo_key`; probe information_schema and use `geo_addr_id`
   * (or skip to Raster/LOR/Ortsteil) without per-store error logs.
   */
  private async readAddressAtPoints(stores: AnalysisStoreInput[]): Promise<GeoKeyRow[]> {
    if (stores.length === 0) return [];
    const plan = await this.resolveAddressLookup();
    if (!plan) return [];
    const rows: GeoKeyRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<GeoKeyRow>(
        `SELECT ${plan.selectKey} AS geo_key,
                ${plan.selectAgs} AS geo_ags
           FROM geo.geo_ref_address a
          WHERE ${plan.notNull}
            AND a.geom IS NOT NULL AND NOT ST_IsEmpty(a.geom)
            AND ST_Intersects(
              CASE
                WHEN ST_SRID(a.geom) IN (0, 4326) THEN ST_SetSRID(a.geom, 4326)
                ELSE ST_Transform(a.geom, 4326)
              END,
              ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)
            )
          ORDER BY ${plan.orderBy}
          LIMIT 1`,
        [store.lon, store.lat],
        { onUndefinedColumn: "skip-address" },
      );
      if (this.addressLookup === "skip") return [];
      rows.push(...found);
    }
    return rows;
  }

  private async resolveAddressLookup(): Promise<AddressLookupPlan | null> {
    if (this.addressLookup === "skip") return null;
    if (this.addressLookup !== "unknown") return this.addressLookup;

    const columns = await this.readAddressColumns();
    if (columns && columns.size > 0) {
      const keyColumn = pickAddressKeyColumn(columns);
      if (!keyColumn) {
        this.skipAddress("no key column on geo.geo_ref_address");
        return null;
      }
      this.addressLookup = addressPlan(keyColumn, columns.has("geo_ags"));
      return this.addressLookup;
    }

    this.addressLookup = addressPlan("geo_key", true);
    return this.addressLookup;
  }

  private async readAddressColumns(): Promise<ReadonlySet<string> | null> {
    try {
      const result = await this.db.queryReadingFeatures<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'geo'
            AND table_name = $1`,
        ["geo_ref_address"],
      );
      if (result.rows.length === 0) return null;
      return new Set(result.rows.map((row) => row.column_name));
    } catch (error) {
      if (
        isGeoCatalogUnavailable(error) ||
        isMissingFeaturesRelation(error) ||
        isFeaturesAccessDenied(error) ||
        isUndefinedColumn(error)
      ) {
        return null;
      }
      throw error;
    }
  }

  private skipAddress(reason: string): void {
    if (this.addressLookup === "skip") return;
    this.addressLookup = "skip";
    this.logger.log(`Store-surroundings skip address level (${reason}).`);
  }

  private async readGridAtPoints(stores: AnalysisStoreInput[]): Promise<GeoKeyRow[]> {
    if (stores.length === 0) return [];
    const rows: GeoKeyRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<GeoKeyRow>(
        `SELECT d.geo_key::text AS geo_key,
                NULLIF(btrim(COALESCE(d.metadata->>'ags', d.metadata->>'geo_ags')), '') AS geo_ags
           FROM features.location_feature_docs d
          WHERE d.grain = 'grid100'
            AND d.source_theme = 'breitband_gitter'
            AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
            AND d.lon IS NOT NULL AND d.lat IS NOT NULL
          ORDER BY ST_Distance(
            ST_SetSRID(ST_MakePoint(d.lon::float8, d.lat::float8), 4326)::geography,
            ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)::geography
          )
          LIMIT 1`,
        [store.lon, store.lat],
      );
      rows.push(...found);
    }
    return rows;
  }

  private async readOrtsteilAtPoints(stores: AnalysisStoreInput[]): Promise<GeoKeyRow[]> {
    if (stores.length === 0) return [];
    const rows: GeoKeyRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<GeoKeyRow>(
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

  private async readBezirkAtPoints(stores: AnalysisStoreInput[]): Promise<GeoKeyRow[]> {
    if (stores.length === 0) return [];
    const rows: GeoKeyRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<GeoKeyRow>(
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
   * Nearest Berlin LOR with stored lon/lat. Prefer 2021 PLR (`lor:plr:*`);
   * 2006 `lor:{RAUMID}` is a separate series and is never concatenated.
   */
  private async readLorNearPoints(stores: AnalysisStoreInput[]): Promise<GeoKeyRow[]> {
    if (stores.length === 0) return [];
    const rows: GeoKeyRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<GeoKeyRow>(
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
      const legacy = await this.readCatalog<GeoKeyRow>(
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

  /** Köln Quartiere (`koeln:sq:*`) for stores whose PLZ sits in Köln. */
  private async readQuartierNearPoints(stores: AnalysisStoreInput[]): Promise<GeoKeyRow[]> {
    if (stores.length === 0) return [];
    const rows: GeoKeyRow[] = [];
    for (const store of stores) {
      const found = await this.readCatalog<GeoKeyRow>(
        `SELECT geo_key::text AS geo_key,
                NULLIF(btrim(COALESCE(metadata->>'ags', metadata->>'geo_ags')), '') AS geo_ags
           FROM features.location_feature_docs
          WHERE source_theme = 'koeln_statistischer_datenkatalog'
            AND geo_key LIKE 'koeln:sq:%'
            AND COALESCE(metadata->>'placement', '') IS DISTINCT FROM 'parent_fallback'
            AND lon IS NOT NULL AND lat IS NOT NULL
          ORDER BY ST_Distance(
            ST_SetSRID(ST_MakePoint(lon::float8, lat::float8), 4326)::geography,
            ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)::geography
          )
          LIMIT 1`,
        [store.lon, store.lat],
      );
      rows.push(...found);
    }
    return rows;
  }

  private async readCatalog<T extends object>(
    sql: string,
    params: unknown[],
    options?: { onUndefinedColumn?: "skip-address" },
  ): Promise<T[]> {
    try {
      const result = await this.db.queryReadingFeatures<T>(sql, params);
      return result.rows;
    } catch (error) {
      if (
        options?.onUndefinedColumn === "skip-address" &&
        (isUndefinedColumn(error) || isMissingFeaturesRelation(error) || isGeoCatalogUnavailable(error))
      ) {
        this.skipAddress(messageOf(error));
        return [];
      }
      if (
        isGeoCatalogUnavailable(error) ||
        isMissingFeaturesRelation(error) ||
        isFeaturesAccessDenied(error) ||
        isUndefinedColumn(error)
      ) {
        this.logger.log(`Store-surroundings catalog read missed (${messageOf(error)}).`);
        return [];
      }
      throw error;
    }
  }
}

function koelnPoints(
  points: AnalysisStoreInput[],
  postalCodes: string[],
  plzRows: PlzRow[],
): AnalysisStoreInput[] {
  const koelnPlz = new Set(
    plzRows
      .filter((row) => isKoelnAgs(row.geo_ags) || isKoelnAgs(row.geo_ags5))
      .map((row) => row.plz)
      .filter((plz): plz is string => Boolean(plz)),
  );
  if (koelnPlz.size === 0) return [];
  return points.filter((store) => {
    const plz = store.postalCode?.trim();
    return Boolean(plz && postalCodes.includes(plz) && koelnPlz.has(plz));
  });
}

function isKoelnAgs(ags: string | null | undefined): boolean {
  const value = ags?.trim() ?? "";
  return value === "05315000" || value.startsWith("05315");
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

interface AddressLookupPlan {
  selectKey: string;
  selectAgs: string;
  notNull: string;
  orderBy: string;
}

const ADDRESS_KEY_COLUMNS = ["geo_key", "geo_addr_id", "id"] as const;

function pickAddressKeyColumn(columns: ReadonlySet<string>): (typeof ADDRESS_KEY_COLUMNS)[number] | null {
  for (const column of ADDRESS_KEY_COLUMNS) {
    if (columns.has(column)) return column;
  }
  return null;
}

function addressPlan(keyColumn: (typeof ADDRESS_KEY_COLUMNS)[number], hasAgs: boolean): AddressLookupPlan {
  const selectAgs = hasAgs ? "NULLIF(btrim(a.geo_ags::text), '')" : "NULL::text";
  if (keyColumn === "geo_key") {
    return {
      selectKey: "COALESCE(NULLIF(btrim(a.geo_key::text), ''), 'address:' || a.geo_key::text)",
      selectAgs,
      notNull: "NULLIF(btrim(a.geo_key::text), '') IS NOT NULL",
      orderBy: "a.geo_key ASC",
    };
  }
  return {
    selectKey: `'address:' || a.${keyColumn}::text`,
    selectAgs,
    notNull: `NULLIF(btrim(a.${keyColumn}::text), '') IS NOT NULL`,
    orderBy: `a.${keyColumn} ASC`,
  };
}

function isUndefinedColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "42703";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
