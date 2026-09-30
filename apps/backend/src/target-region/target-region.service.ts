import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { emptyToNull, normalizeCoordPair, toCoord, toIso } from "../customer/values";
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
  ags: string | null;
  plz: string | null;
  lon: number | null;
  lat: number | null;
  bounds: LonLatBounds | null;
  geometry: RegionGeometry | null;
  updatedAt: string;
}

interface TargetRegionRow {
  label: string;
  grain: Grain | null;
  geo_key: string | null;
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

/** Successful PUT must not persist a null overlay. Shown to the client as-is. */
export const TARGET_REGION_NO_MAP_AREA =
  "Diese Region hat keine Kartenfläche im Katalog. Bitte Geometrie oder Grenzen mitschicken, oder einen Ort wählen, der im Katalog hinterlegt ist.";

const SELECT_REGION = `
  SELECT label, grain, geo_key, ags, plz, lon, lat,
         bounds_west, bounds_south, bounds_east, bounds_north, geometry, updated_at
  FROM app.target_regions
`;

@Injectable()
export class TargetRegionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: PlaceCatalogService,
  ) {}

  async get(userId: string): Promise<TargetRegion> {
    const result = await this.db.query<TargetRegionRow>(
      `${SELECT_REGION} WHERE user_id = $1::bigint`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Target region is not set");
    }
    return this.withMap(toRegion(row));
  }

  async put(userId: string, dto: TargetRegionWriteDto): Promise<TargetRegion> {
    const coords = normalizeCoordPair(dto.lon, dto.lat);
    const geometry = dto.geometry == null ? null : parseRegionGeometry(dto.geometry);
    const bounds = dto.bounds == null ? null : parseBounds(dto.bounds);
    const grain = dto.grain ?? null;
    const geoKey = emptyToNull(dto.geoKey);
    const ags = emptyToNull(dto.ags);
    const plz = emptyToNull(dto.plz);
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
      throw new BadRequestException(TARGET_REGION_NO_MAP_AREA);
    }

    const result = await this.db.query<TargetRegionRow>(
      `INSERT INTO app.target_regions (
         user_id, label, grain, geo_key, ags, plz, lon, lat,
         bounds_west, bounds_south, bounds_east, bounds_north, geometry
       )
       VALUES (
         $1::bigint, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13::jsonb
       )
       ON CONFLICT (user_id) DO UPDATE SET
         label = EXCLUDED.label,
         grain = EXCLUDED.grain,
         geo_key = EXCLUDED.geo_key,
         ags = EXCLUDED.ags,
         plz = EXCLUDED.plz,
         lon = EXCLUDED.lon,
         lat = EXCLUDED.lat,
         bounds_west = EXCLUDED.bounds_west,
         bounds_south = EXCLUDED.bounds_south,
         bounds_east = EXCLUDED.bounds_east,
         bounds_north = EXCLUDED.bounds_north,
         geometry = EXCLUDED.geometry,
         updated_at = now()
       RETURNING label, grain, geo_key, ags, plz, lon, lat,
                 bounds_west, bounds_south, bounds_east, bounds_north, geometry, updated_at`,
      [
        userId,
        dto.label.trim(),
        grain,
        geoKey,
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
      throw new NotFoundException("Target region is not set");
    }
    return toRegion(row);
  }

  async delete(userId: string): Promise<void> {
    await this.db.query(`DELETE FROM app.target_regions WHERE user_id = $1::bigint`, [
      userId,
    ]);
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
    if (!input.geometry && !input.bounds) {
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
}

function toRegion(row: TargetRegionRow): TargetRegion {
  return {
    label: row.label,
    grain: row.grain,
    geoKey: row.geo_key,
    ags: row.ags,
    plz: row.plz,
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
    bounds: boundsFromRow(row),
    geometry: geometryFromUnknown(row.geometry),
    updatedAt: toIso(row.updated_at),
  };
}
