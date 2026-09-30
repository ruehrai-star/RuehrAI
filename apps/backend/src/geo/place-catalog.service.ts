import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { DataScoutService } from "../database/data-scout.service";
import { canonicalRegionKeys, isOfficialBerlinBezirkAgs } from "./bezirk-ags";
import { queryAdminOutline, queryBezirkOutline } from "./region-outline-lookup";
import { LonLat } from "./region-geometry";

export interface RegionLookup {
  grain: string | null;
  geoKey: string | null;
  ags: string | null;
  plz: string | null;
}

export interface RegionCatalogHit {
  /**
   * Polygon or MultiPolygon. Brain `app.map_features` wins. When that misses,
   * Data-Scout `geo_ref_bezirk` (Berlin Bezirk) or `geo_ref_admin`
   * (Gemeinde, Kreis, Land, transformed to WGS84).
   */
  geometry: unknown | null;
  /** WGS84 point from `app.search_places`, a Point feature, or the Data-Scout centroid. */
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
  constructor(
    private readonly db: DatabaseService,
    private readonly scout?: DataScoutService,
  ) {}

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
    const keys = canonicalRegionKeys({ geoKey: input.geoKey, ags: input.ags });
    const normalized: RegionLookup = { ...input, geoKey: keys.geoKey, ags: keys.ags };
    const ids = regionFeatureIds(normalized);
    if (ids.length === 0 && !normalized.ags && !normalized.plz) {
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
        [ids, normalized.ags, normalized.plz],
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
        [ids, normalized.ags, normalized.plz],
      ),
    ]);

    const raw = features.rows[0]?.geometry ?? null;
    let geometry: unknown | null =
      raw && (raw.type === "Polygon" || raw.type === "MultiPolygon") ? raw : null;
    let point =
      (places.rows[0] ? toPoint(places.rows[0].lon, places.rows[0].lat) : null) ??
      (raw?.type === "Point" ? pointFromCoordinates(raw.coordinates) : null);
    if (!geometry) {
      const scoutHit = await this.scoutOutline(normalized);
      if (scoutHit?.geometry) {
        geometry = scoutHit.geometry;
        point = point ?? scoutHit.point;
      }
    }
    return { geometry, point };
  }

  /**
   * Brain has no polygon. Berlin Bezirke read `geo_ref_bezirk` (4326).
   * Any other Gemeinde, Kreis, or Land AGS reads `geo_ref_admin`.
   * A disabled or failed Data-Scout pool leaves the Brain result in place.
   */
  private async scoutOutline(input: RegionLookup): Promise<RegionCatalogHit | null> {
    if (!this.scout?.enabled) return null;
    const ags = outlineAgs(input);
    if (!ags) return null;
    const query = (text: string, params: unknown[]) => this.scout!.query(text, params);
    if (isOfficialBerlinBezirkAgs(ags)) {
      const bezirk = await queryBezirkOutline(query, ags);
      if (bezirk?.geometry) return bezirk;
      const admin = await queryAdminOutline(query, ags);
      if (admin?.geometry) return admin;
      return bezirk ?? admin;
    }
    return queryAdminOutline(query, ags);
  }
}

/** AGS used for Data-Scout outlines. PLZ grains are not admin keys. */
function outlineAgs(input: RegionLookup): string | null {
  if (input.ags && /^[0-9]{2,8}$/.test(input.ags)) return input.ags;
  if (
    input.grain === "plz5" ||
    input.grain === "plz8" ||
    input.grain === "address" ||
    input.grain === "grid100"
  ) {
    return null;
  }
  const geoKey = input.geoKey;
  if (!geoKey) return null;
  const bare = geoKey.startsWith("ags:") ? geoKey.slice(4) : geoKey;
  return /^[0-9]{2}$|^[0-9]{5}$|^[0-9]{8}$/.test(bare) ? bare : null;
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
