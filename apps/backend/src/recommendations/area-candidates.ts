import { AnalysisRegion } from "../analysis/types";
import { isKreisPlace, kreisAgsFrom } from "../analysis/yearly-series";
import { Grain } from "../target-region/dto";

/** Cap the geo_ref intersect read. Ranking still returns every loaded Teilfläche. */
export const AREA_CANDIDATE_LIMIT = 200;

export type AreaKind = "ortsteil" | "stadtteil" | "bezirk" | "stadtbezirk" | "plz" | "gemeinde";

export interface AreaCandidate {
  id: string;
  geoKey: string;
  grain: Grain;
  kind: AreaKind;
  title: string;
  name: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | null;
  lat: number | null;
}

export interface AreaCandidateSqlRow {
  geo_key: string | null;
  grain: string | null;
  kind: string | null;
  name: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | string | null;
  lat: number | string | null;
}

function geom4326(alias: string): string {
  return `
    CASE
      WHEN ST_SRID(${alias}.geom) IN (0, 4326) THEN ST_SetSRID(${alias}.geom, 4326)
      ELSE ST_Transform(${alias}.geom, 4326)
    END
  `;
}

function hasArea(alias: string): string {
  return `${alias}.geom IS NOT NULL AND NOT ST_IsEmpty(${alias}.geom)`;
}

function polygonHit(alias: string, agsExpr: string): string {
  const geom = geom4326(alias);
  return `(
      (g.geom IS NOT NULL AND ST_Intersects(${geom}, g.geom))
      OR (g.geom IS NULL AND $2::text IS NOT NULL AND (
        ${agsExpr} = $2
        OR ${agsExpr} LIKE $2 || '%'
      ))
      OR (g.geom IS NULL AND $5::text IS NOT NULL AND ${agsExpr} LIKE $5 || '%')
    )`;
}

/**
 * Teilflächen inside the Zielregion. Uses the stored polygon when present,
 * otherwise the PLZ outline from `geo.geo_ref_plz`, otherwise AGS / Kreis-prefix
 * membership (admin polygons are empty in Brain). No embedding filter.
 *
 * $1 geometry GeoJSON (nullable)
 * $2 ags (nullable)
 * $3 plz (nullable)
 * $4 geoKey (nullable)
 * $5 Kreis AGS5 prefix (nullable)
 * $6 include Gemeinden (Kreis Zielregion)
 */
export function buildAreaCandidateSql(): string {
  const plzGeom = geom4326("plz_src");
  return `
  WITH region_geom AS (
    SELECT COALESCE(
      CASE
        WHEN $1::text IS NULL OR btrim($1::text) = '' THEN NULL::geometry
        ELSE ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)
      END,
      (
        SELECT ${plzGeom}
          FROM geo.geo_ref_plz plz_src
         WHERE $3::text IS NOT NULL
           AND plz_src.geo_plz5::text = $3
           AND ${hasArea("plz_src")}
         LIMIT 1
      )
    ) AS geom
  ),
  hits AS (
    SELECT
      (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) AS geo_key,
      'other'::text AS grain,
      lower(btrim(o.kind)) AS kind,
      NULLIF(btrim(o.name), '') AS name,
      NULLIF(btrim(o.geo_ags::text), '') AS ags,
      NULL::text AS plz,
      ST_X(ST_PointOnSurface(${geom4326("o")})) AS lon,
      ST_Y(ST_PointOnSurface(${geom4326("o")})) AS lat
    FROM geo.geo_ref_ortsteil o, region_geom g
    WHERE ${hasArea("o")}
      AND lower(btrim(o.kind)) IN ('stadtteil', 'ortsteil')
      AND NULLIF(btrim(o.name), '') IS NOT NULL
      AND ${polygonHit("o", "o.geo_ags::text")}

    UNION ALL

    SELECT
      CASE
        WHEN b.geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$' THEN b.geo_bezirk_id::text
        ELSE 'stadtbezirk:' || b.geo_bezirk_id::text
      END AS geo_key,
      CASE
        WHEN b.geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$' THEN 'ags'
        ELSE 'other'
      END AS grain,
      CASE
        WHEN b.geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$' THEN 'bezirk'
        ELSE 'stadtbezirk'
      END AS kind,
      NULLIF(btrim(b.name), '') AS name,
      COALESCE(
        NULLIF(btrim(b.geo_ags::text), ''),
        CASE WHEN b.geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$' THEN '11000000' END
      ) AS ags,
      NULL::text AS plz,
      ST_X(ST_PointOnSurface(${geom4326("b")})) AS lon,
      ST_Y(ST_PointOnSurface(${geom4326("b")})) AS lat
    FROM geo.geo_ref_bezirk b, region_geom g
    WHERE ${hasArea("b")}
      AND NULLIF(btrim(b.name), '') IS NOT NULL
      AND ${polygonHit("b", "b.geo_ags::text")}

    UNION ALL

    SELECT
      p.geo_plz5::text AS geo_key,
      'plz5'::text AS grain,
      'plz'::text AS kind,
      p.geo_plz5::text AS name,
      NULLIF(btrim(p.geo_ags::text), '') AS ags,
      p.geo_plz5::text AS plz,
      ST_X(ST_PointOnSurface(${geom4326("p")})) AS lon,
      ST_Y(ST_PointOnSurface(${geom4326("p")})) AS lat
    FROM geo.geo_ref_plz p, region_geom g
    WHERE ${hasArea("p")}
      AND NULLIF(btrim(p.geo_plz5::text), '') IS NOT NULL
      AND ${polygonHit("p", "p.geo_ags::text")}

    UNION ALL

    SELECT
      a.geo_ags::text AS geo_key,
      'ags'::text AS grain,
      'gemeinde'::text AS kind,
      NULLIF(btrim(a.name), '') AS name,
      a.geo_ags::text AS ags,
      NULL::text AS plz,
      NULL::float8 AS lon,
      NULL::float8 AS lat
    FROM geo.geo_ref_admin a
    WHERE $6::boolean
      AND NULLIF(btrim(a.geo_ags::text), '') IS NOT NULL
      AND char_length(btrim(a.geo_ags::text)) = 8
      AND (
        ($5::text IS NOT NULL AND a.geo_ags::text LIKE $5 || '%')
        OR ($2::text IS NOT NULL AND char_length(btrim($2::text)) = 5 AND a.geo_ags::text LIKE $2 || '%')
      )
  )
  SELECT geo_key, grain, kind, name, ags, plz, lon, lat
    FROM hits
   WHERE geo_key IS NOT NULL
     AND ($4::text IS NULL OR geo_key IS DISTINCT FROM $4)
     AND ($2::text IS NULL OR geo_key IS DISTINCT FROM $2)
     AND ($3::text IS NULL OR geo_key IS DISTINCT FROM $3)
   ORDER BY
     CASE kind
       WHEN 'ortsteil' THEN 0
       WHEN 'stadtteil' THEN 0
       WHEN 'bezirk' THEN 1
       WHEN 'stadtbezirk' THEN 1
       WHEN 'plz' THEN 2
       WHEN 'gemeinde' THEN 3
       ELSE 4
     END,
     name ASC NULLS LAST,
     geo_key ASC
   LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

export function areaCandidateParams(
  region: AnalysisRegion,
): [string | null, string | null, string | null, string | null, string | null, boolean] {
  const geometry = region.geometry ? JSON.stringify(region.geometry) : null;
  const ags = region.ags?.trim() || null;
  const plz = region.plz?.trim() || null;
  const geoKey = region.geoKey?.trim() || null;
  const kreis = kreisAgsFrom(region);
  const includeGemeinden = isKreisPlace(region);
  return [geometry, ags, plz, geoKey, includeGemeinden ? kreis : null, includeGemeinden];
}

export function isRegionAnchor(
  candidate: Pick<AreaCandidate, "geoKey" | "grain" | "ags" | "plz">,
  region: Pick<AnalysisRegion, "geoKey" | "grain" | "ags" | "plz">,
): boolean {
  const geoKey = candidate.geoKey.trim();
  if (!geoKey) return true;
  if (region.geoKey && sameCatalogKey(geoKey, region.geoKey)) return true;
  if (region.ags && (candidate.grain === "ags" || candidate.grain === "ags5") && sameCatalogKey(geoKey, region.ags)) {
    return true;
  }
  if (region.plz && (candidate.grain === "plz5" || candidate.grain === "plz8") && sameCatalogKey(geoKey, region.plz)) {
    return true;
  }
  return false;
}

export function areaKindRank(kind: AreaKind): number {
  if (kind === "ortsteil" || kind === "stadtteil") return 0;
  if (kind === "bezirk" || kind === "stadtbezirk") return 1;
  if (kind === "plz") return 2;
  if (kind === "gemeinde") return 3;
  return 4;
}

function sameCatalogKey(left: string, right: string): boolean {
  return left === right || bareKey(left) === bareKey(right);
}

function bareKey(value: string): string {
  const match = /^(?:ags|ags5|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):(.+)$/i.exec(value.trim());
  return match?.[1] ?? value.trim();
}
