import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { emptyToNull, normalizeCoordPair, toCoord, toIso } from "../customer/values";
import { fillMissingCatalogDisplay, catalogPlaceQuery } from "../geo/catalog-display";
import { CatalogLevel, isCatalogLevel, persistedCatalogLevel } from "../geo/geo-catalog";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { canonicalRegionKeys } from "../geo/bezirk-ags";
import { PlaceCatalogService } from "../geo/place-catalog.service";
import {
  LonLatBounds,
  RegionGeometry,
  boundsFromGeometry,
  boundsFromRow,
  centroid,
  geometryFromUnknown,
  parseBounds,
  parseRegionGeometry,
  resolveRegionMap,
} from "../geo/region-geometry";
import { Grain, TargetRegionWriteDto } from "./dto";

export interface TargetRegion {
  label: string;
  grain: Grain | null;
  geoKey: string | null;
  level: CatalogLevel | null;
  parentLabel: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | null;
  lat: number | null;
  bounds: LonLatBounds | null;
  geometry: RegionGeometry | null;
  updatedAt: string;
}

export interface TargetRegionList {
  items: TargetRegion[];
}

interface TargetRegionRow {
  label: string;
  grain: Grain | null;
  geo_key: string | null;
  level?: string | null;
  parent_label?: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | string | null;
  lat: number | string | null;
  bounds_west?: number | string | null;
  bounds_south?: number | string | null;
  bounds_east?: number | string | null;
  bounds_north?: number | string | null;
  geometry?: unknown;
  updated_at: Date | string;
}

const SELECT_REGION = `
  SELECT label, grain, geo_key, level, parent_label, ags, plz, lon, lat,
         bounds_west, bounds_south, bounds_east, bounds_north, geometry, updated_at
  FROM app.target_regions
`;

/**
 * Add refuses this case. A successful write always stores a polygon.
 * GET may still return a previously stored null outline.
 */
export const TARGET_REGION_NO_MAP_AREA =
  "Region has no map area in the catalog. Supply geometry or bounds, or choose a place whose polygon is in the catalog.";

/** Additive 0.19.6. Stable code on POST /target-region when the catalog has no polygon. */
export const TARGET_REGION_WITHOUT_GEOMETRY = "TARGET_REGION_WITHOUT_GEOMETRY";

export const TARGET_REGION_PLACE_REQUIRED =
  "Name the catalog place with geoKey, ags, or plz. A free-text label is not enough to add or remove an item.";

@Injectable()
export class TargetRegionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: PlaceCatalogService,
    private readonly geoCatalog: GeoCatalogService,
  ) {}

  async list(userId: string): Promise<TargetRegionList> {
    const result = await this.db.query<TargetRegionRow>(
      `${SELECT_REGION}
       WHERE user_id = $1::bigint
       ORDER BY created_at DESC, id DESC`,
      [userId],
    );
    const items = await Promise.all(result.rows.map((row) => this.hydrate(toRegion(row))));
    return { items };
  }

  async add(
    userId: string,
    dto: TargetRegionWriteDto,
  ): Promise<{ item: TargetRegion; created: boolean }> {
    const coords = normalizeCoordPair(dto.lon, dto.lat);
    const geometry = dto.geometry == null ? null : parseRegionGeometry(dto.geometry);
    const bounds = dto.bounds == null ? null : parseBounds(dto.bounds);
    const grain = dto.grain ?? null;
    const plz = emptyToNull(dto.plz);
    const canonical = canonicalRegionKeys({
      geoKey: emptyToNull(dto.geoKey),
      ags: emptyToNull(dto.ags),
    });
    const geoKey = canonical.geoKey ?? plz;
    const ags = canonical.ags;
    if (!geoKey && !ags && !plz) {
      throw new BadRequestException(TARGET_REGION_PLACE_REQUIRED);
    }
    const resolved = await this.resolveMap({
      grain,
      geoKey,
      ags,
      plz,
      lon: coords.lon,
      lat: coords.lat,
      bounds,
      geometry,
    });
    if (!resolved.geometry || !resolved.bounds) {
      throw new BadRequestException({
        statusCode: 400,
        message: TARGET_REGION_NO_MAP_AREA,
        error: "Bad Request",
        code: TARGET_REGION_WITHOUT_GEOMETRY,
      });
    }
    const display = await this.catalogDisplay({
      grain,
      geoKey,
      ags,
      plz,
      label: dto.label.trim(),
    });
    const storedKey = geoKey ?? ags ?? plz;
    const existing = await this.findByKeys(userId, [storedKey, geoKey, ags, plz]);
    if (existing) {
      return { item: await this.hydrate(existing), created: false };
    }

    const result = await this.db.query<TargetRegionRow>(
      `INSERT INTO app.target_regions (
         user_id, label, grain, geo_key, level, parent_label, ags, plz, lon, lat,
         bounds_west, bounds_south, bounds_east, bounds_north, geometry
       )
       VALUES (
         $1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15::jsonb
       )
       ON CONFLICT (user_id, geo_key) WHERE geo_key IS NOT NULL DO NOTHING
       RETURNING label, grain, geo_key, level, parent_label, ags, plz, lon, lat,
                 bounds_west, bounds_south, bounds_east, bounds_north, geometry, updated_at`,
      [
        userId,
        display.label,
        grain,
        storedKey,
        display.level,
        display.parentLabel,
        ags,
        plz,
        resolved.lon,
        resolved.lat,
        resolved.bounds.west,
        resolved.bounds.south,
        resolved.bounds.east,
        resolved.bounds.north,
        JSON.stringify(resolved.geometry),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      const again = await this.findByKeys(userId, [storedKey, geoKey, ags, plz]);
      if (!again) {
        throw new BadRequestException(TARGET_REGION_PLACE_REQUIRED);
      }
      return { item: await this.hydrate(again), created: false };
    }
    return { item: await this.hydrate(toRegion(row)), created: true };
  }

  async remove(userId: string, geoKey: string): Promise<void> {
    const keys = identityKeys(geoKey);
    if (keys.length === 0) return;
    await this.db.query(
      `DELETE FROM app.target_regions
       WHERE user_id = $1::bigint
         AND (
           geo_key = ANY($2::text[])
           OR ags = ANY($2::text[])
           OR plz = ANY($2::text[])
         )`,
      [userId, keys],
    );
  }

  async clear(userId: string): Promise<void> {
    await this.db.query(`DELETE FROM app.target_regions WHERE user_id = $1::bigint`, [userId]);
  }

  /** Outline from the stored row or catalog, then missing level / parentLabel. */
  private async hydrate(region: TargetRegion): Promise<TargetRegion> {
    return fillMissingCatalogDisplay(
      await this.withMap(region),
      (query) => this.geoCatalog.search(query),
      (keys) => this.geoCatalog.lookupAdminNames(keys),
    );
  }

  /** Fill bounds, geometry, and a missing point from the stored row or the local catalog. */
  private async withMap(region: TargetRegion): Promise<TargetRegion> {
    if (region.geometry && !region.bounds) {
      region = { ...region, bounds: boundsFromGeometry(region.geometry) };
    }
    if (region.geometry && (region.lon === null || region.lat === null)) {
      const point = centroid(region.geometry);
      region = { ...region, lon: point.lon, lat: point.lat };
    }
    if (region.geometry && region.bounds && region.lon !== null && region.lat !== null) {
      return region;
    }
    return {
      ...region,
      ...(await this.resolveMap(region)),
    };
  }

  private async resolveMap(input: {
    grain: string | null;
    geoKey: string | null;
    ags: string | null;
    plz: string | null;
    lon: number | null;
    lat: number | null;
    bounds: LonLatBounds | null;
    geometry: RegionGeometry | null;
  }) {
    let catalogGeometry: RegionGeometry | null = null;
    let catalogPoint: { lon: number; lat: number } | null = null;
    if (!input.geometry) {
      const hit = await this.catalog.lookupRegion({
        grain: input.grain,
        geoKey: input.geoKey,
        ags: input.ags,
        plz: input.plz,
      });
      catalogGeometry = geometryFromUnknown(hit.geometry);
      catalogPoint = hit.point;
    }
    return resolveRegionMap({
      grain: input.grain,
      lon: input.lon,
      lat: input.lat,
      bounds: input.geometry ? null : input.bounds,
      geometry: input.geometry,
      catalogGeometry,
      catalogPoint,
    });
  }

  private async catalogDisplay(input: {
    grain: string | null;
    geoKey: string | null;
    ags: string | null;
    plz: string | null;
    label: string;
  }): Promise<{ label: string; level: CatalogLevel | null; parentLabel: string | null }> {
    const query = catalogPlaceQuery(input);
    if (!query) {
      return { label: input.label, level: null, parentLabel: null };
    }
    const hits = await this.geoCatalog.search(query);
    const hit = hits[0];
    return {
      label: hit?.label?.trim() || input.label,
      level: persistedCatalogLevel(hit?.level),
      parentLabel: hit?.parentLabel ?? null,
    };
  }

  private async findByKeys(userId: string, rawKeys: Array<string | null>): Promise<TargetRegion | null> {
    const keys = [...new Set(rawKeys.flatMap((key) => (key ? identityKeys(key) : [])))];
    if (keys.length === 0) return null;
    const result = await this.db.query<TargetRegionRow>(
      `${SELECT_REGION}
       WHERE user_id = $1::bigint
         AND (
           geo_key = ANY($2::text[])
           OR ags = ANY($2::text[])
           OR plz = ANY($2::text[])
         )
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId, keys],
    );
    const row = result.rows[0];
    return row ? toRegion(row) : null;
  }
}

function toRegion(row: TargetRegionRow): TargetRegion {
  return {
    label: row.label,
    grain: row.grain,
    geoKey: row.geo_key,
    level: isCatalogLevel(row.level) ? row.level : null,
    parentLabel: emptyToNull(row.parent_label ?? null),
    ags: row.ags,
    plz: row.plz,
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
    bounds: boundsFromRow(row),
    geometry: geometryFromUnknown(row.geometry),
    updatedAt: toIso(row.updated_at),
  };
}

function identityKeys(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const canonical = canonicalRegionKeys({ geoKey: trimmed, ags: null });
  const keys = new Set<string>([trimmed]);
  if (canonical.geoKey) keys.add(canonical.geoKey);
  if (canonical.ags) keys.add(canonical.ags);
  const prefixed = /^(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):(.+)$/i.exec(trimmed);
  if (prefixed?.[1]) {
    keys.add(prefixed[1]);
    const inner = canonicalRegionKeys({ geoKey: prefixed[1], ags: null });
    if (inner.geoKey) keys.add(inner.geoKey);
    if (inner.ags) keys.add(inner.ags);
  }
  return [...keys];
}
