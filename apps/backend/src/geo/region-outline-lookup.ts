import { toCoord } from "../customer/values";
import { isOfficialBerlinBezirkAgs } from "./bezirk-ags";
import { LonLat } from "./region-geometry";

export interface OutlineQuery {
  (
    text: string,
    params: unknown[],
  ): Promise<{ rows: Array<{ geometry?: unknown; lon?: unknown; lat?: unknown }> } | null>;
}

export interface OutlineHit {
  geometry: unknown | null;
  point: LonLat | null;
}

/**
 * `geo_ref_bezirk.geom` is a MultiPolygon in EPSG:4326. SRID 0 is treated as
 * 4326. Any other SRID is transformed. `lon` / `lat` are the loaded centroid.
 */
export const BEZIRK_OUTLINE_SQL = `
  SELECT ST_AsGeoJSON(
           CASE
             WHEN ST_SRID(geom) IN (0, 4326) THEN ST_SetSRID(geom, 4326)
             ELSE ST_Transform(geom, 4326)
           END
         )::json AS geometry,
         lon,
         lat
  FROM public.geo_ref_bezirk
  WHERE geo_bezirk_id = $1
  LIMIT 1
`;

/**
 * `geo_ref_admin.geom` is VG250, usually EPSG:3035. SRID 0 is read as 3035.
 * The outline and a point-on-surface are returned in EPSG:4326.
 */
export const ADMIN_OUTLINE_SQL = `
  SELECT ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json AS geometry,
         ST_X(ST_Transform(ST_PointOnSurface(g.geom), 4326)) AS lon,
         ST_Y(ST_Transform(ST_PointOnSurface(g.geom), 4326)) AS lat
  FROM (
    SELECT CASE
             WHEN ST_SRID(geom) = 4326 THEN geom
             WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 3035)
             ELSE geom
           END AS geom
    FROM public.geo_ref_admin
    WHERE geo_ags = $1
    LIMIT 1
  ) AS g
`;

export async function queryBezirkOutline(
  query: OutlineQuery,
  ags: string,
): Promise<OutlineHit | null> {
  if (!isOfficialBerlinBezirkAgs(ags)) return null;
  const result = await query(BEZIRK_OUTLINE_SQL, [ags]);
  return outlineFrom(result?.rows[0]);
}

export async function queryAdminOutline(
  query: OutlineQuery,
  ags: string,
): Promise<OutlineHit | null> {
  if (!/^[0-9]{2}$|^[0-9]{5}$|^[0-9]{8}$/.test(ags)) return null;
  const result = await query(ADMIN_OUTLINE_SQL, [ags]);
  return outlineFrom(result?.rows[0]);
}

function outlineFrom(
  row: { geometry?: unknown; lon?: unknown; lat?: unknown } | undefined,
): OutlineHit | null {
  if (!row) return null;
  const geometry = outlineGeometry(row.geometry);
  const lon = toCoord(row.lon as number | string | null | undefined);
  const lat = toCoord(row.lat as number | string | null | undefined);
  const point = lon !== null && lat !== null ? { lon, lat } : null;
  if (!geometry && !point) return null;
  return { geometry, point };
}

function outlineGeometry(value: unknown): unknown | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const type = (parsed as { type?: unknown }).type;
  if (type !== "Polygon" && type !== "MultiPolygon") return null;
  return parsed;
}
