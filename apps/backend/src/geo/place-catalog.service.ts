import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { LonLat } from "./region-geometry";

export interface RegionLookup {
  grain: string | null;
  geoKey: string | null;
  ags: string | null;
  plz: string | null;
}

export interface RegionCatalogHit {
  /**
   * Polygon or MultiPolygon from `app.map_features`, when one matches.
   * Search hits are place ids, not outlines. A place that is not stored here
   * as a polygon has no catalog map area (Location-Guide supplies official
   * outlines). Point-only rows are not an outline.
   */
  geometry: unknown | null;
  /** WGS84 point from `app.search_places`, or a Point feature when the catalog has no place row. */
  point: LonLat | null;
}

interface GeometryRow {
  geometry: { type?: string; coordinates?: unknown } | null;
}

interface PointRow {
  plz?: string;
  lon: number | string | null;
  lat: number | string | null;
}

@Injectable()
export class PlaceCatalogService {
  constructor(private readonly db: DatabaseService) {}

  /** PLZ5 centroid. `search_places` first, then a Point in `map_features`. */
  async plzCentroids(postalCodes: string[]): Promise<Map<string, LonLat>> {
    const codes = [...new Set(postalCodes.filter((code) => code.length > 0))];
    const found = new Map<string, LonLat>();
    if (codes.length === 0) return found;

    const places = await this.db.query<PointRow>(
      `SELECT DISTINCT ON (plz) plz, lon, lat
       FROM app.search_places
       WHERE plz = ANY($1::text[])
         AND lon IS NOT NULL
         AND lat IS NOT NULL
       ORDER BY plz,
         CASE grain
           WHEN 'plz5' THEN 0
           WHEN 'plz8' THEN 1
           WHEN 'address' THEN 2
           ELSE 3
         END,
         id`,
      [codes],
    );
    for (const row of places.rows) {
      const point = toPoint(row.lon, row.lat);
      if (row.plz && point) found.set(row.plz, point);
    }

    const missing = codes.filter((code) => !found.has(code));
    if (missing.length === 0) return found;

    const featureIds = missing.flatMap((code) => [`plz5:${code}`, `plz8:${code}`]);
    const features = await this.db.query<PointRow>(
      `SELECT DISTINCT ON (plz) plz, lon, lat
       FROM (
         SELECT COALESCE(NULLIF(properties->>'plz', ''), substring(id from '([0-9]{5})$')) AS plz,
                (geometry->'coordinates'->>0)::double precision AS lon,
                (geometry->'coordinates'->>1)::double precision AS lat,
                id
         FROM app.map_features
         WHERE geometry->>'type' = 'Point'
           AND (
             properties->>'plz' = ANY($1::text[])
             OR id = ANY($2::text[])
           )
       ) AS points
       WHERE plz = ANY($1::text[])
         AND lon IS NOT NULL
         AND lat IS NOT NULL
       ORDER BY plz, id`,
      [missing, featureIds],
    );
    for (const row of features.rows) {
      const point = toPoint(row.lon, row.lat);
      if (row.plz && point && !found.has(row.plz)) found.set(row.plz, point);
    }
    return found;
  }

  async lookupRegion(input: RegionLookup): Promise<RegionCatalogHit> {
    const ids = regionFeatureIds(input);
    if (ids.length === 0 && !input.ags && !input.plz) {
      return { geometry: null, point: null };
    }

    const [features, places] = await Promise.all([
      this.db.query<GeometryRow>(
        `SELECT geometry
         FROM app.map_features
         WHERE id = ANY($1::text[])
            OR (
              $2::text IS NOT NULL
              AND properties->>'ags' = $2
              AND geometry->>'type' IN ('Polygon', 'MultiPolygon')
            )
            OR (
              $3::text IS NOT NULL
              AND properties->>'plz' = $3
              AND geometry->>'type' IN ('Polygon', 'MultiPolygon')
            )
         ORDER BY
           CASE WHEN geometry->>'type' IN ('Polygon', 'MultiPolygon') THEN 0 ELSE 1 END,
           CASE WHEN id = ANY($1::text[]) THEN 0 ELSE 1 END,
           id
         LIMIT 1`,
        [ids, input.ags, input.plz],
      ),
      this.db.query<PointRow>(
        `SELECT lon, lat
         FROM app.search_places
         WHERE lon IS NOT NULL
           AND lat IS NOT NULL
           AND (
             id = ANY($1::text[])
             OR ($2::text IS NOT NULL AND ags = $2 AND grain IN ('ags', 'ags5'))
             OR ($3::text IS NOT NULL AND plz = $3)
           )
         ORDER BY
           CASE WHEN id = ANY($1::text[]) THEN 0 ELSE 1 END,
           CASE grain
             WHEN 'ags' THEN 0
             WHEN 'ags5' THEN 1
             WHEN 'plz5' THEN 2
             WHEN 'plz8' THEN 3
             WHEN 'address' THEN 4
             ELSE 5
           END,
           id
         LIMIT 1`,
        [ids, input.ags, input.plz],
      ),
    ]);

    const raw = features.rows[0]?.geometry ?? null;
    const geometry =
      raw && (raw.type === "Polygon" || raw.type === "MultiPolygon") ? raw : null;
    const place = places.rows[0];
    const point =
      (place ? toPoint(place.lon, place.lat) : null) ??
      (raw?.type === "Point" ? pointFromCoordinates(raw.coordinates) : null);
    return { geometry, point };
  }
}

export function regionFeatureIds(input: RegionLookup): string[] {
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (!id || ids.includes(id)) return;
    ids.push(id);
  };
  add(input.geoKey);
  if (input.ags) add(`ags:${input.ags}`);
  if (input.plz) {
    add(`plz5:${input.plz}`);
    add(`plz8:${input.plz}`);
  }
  if (input.grain && input.geoKey && !input.geoKey.includes(":")) {
    add(`${input.grain}:${input.geoKey}`);
  }
  return ids;
}

function toPoint(lon: number | string | null | undefined, lat: number | string | null | undefined): LonLat | null {
  if (lon == null || lat == null) return null;
  const lonNumber = typeof lon === "number" ? lon : Number(lon);
  const latNumber = typeof lat === "number" ? lat : Number(lat);
  if (!Number.isFinite(lonNumber) || !Number.isFinite(latNumber)) return null;
  return { lon: lonNumber, lat: latNumber };
}

function pointFromCoordinates(value: unknown): LonLat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return toPoint(value[0] as number | string | null, value[1] as number | string | null);
}
