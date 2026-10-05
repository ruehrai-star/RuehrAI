import { AnalysisRegion } from "../analysis/types";
import { isKreisPlace, kreisAgsFrom, municipalityAgsFrom } from "../analysis/yearly-series";
import { catalogLevelFromGeoKey, officialAgsKey } from "../geo/geo-catalog";
import { Grain } from "../target-region/dto";

/** Cap the geo_ref / feature-doc read. Ranking still returns every loaded Teilfläche. */
export const AREA_CANDIDATE_LIMIT = 200;

export const AREA_KINDS = [
  "address",
  "grid100",
  "ortsteil",
  "stadtteil",
  "lor",
  "plz",
  "bezirk",
  "stadtbezirk",
  "gemeinde",
] as const;

export type AreaKind = (typeof AREA_KINDS)[number];

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

export interface ParentMembership {
  grains: string[];
  ids: string[];
}

/**
 * Finest → coarsest. Address is skipped when Brain has 0 docs.
 * Berlin LOR sits between Ortsteil and PLZ/Bezirk. Only the finest rank
 * with hits is returned; parents stay off the list.
 */
export function areaKindRank(kind: AreaKind): number {
  if (kind === "address") return 0;
  if (kind === "grid100") return 1;
  if (kind === "ortsteil" || kind === "stadtteil") return 2;
  if (kind === "lor") return 3;
  if (kind === "plz") return 4;
  if (kind === "bezirk" || kind === "stadtbezirk") return 5;
  if (kind === "gemeinde") return 6;
  return 7;
}

export function isAreaKind(value: string | null | undefined): value is AreaKind {
  return Boolean(value && (AREA_KINDS as readonly string[]).includes(value));
}

export function selectFinestHits(
  candidates: AreaCandidate[],
  regions: Array<Pick<AnalysisRegion, "geoKey" | "grain" | "ags" | "plz">>,
): AreaCandidate[] {
  const withoutAnchor = candidates.filter(
    (candidate) => !regions.some((region) => isRegionAnchor(candidate, region)),
  );
  if (withoutAnchor.length === 0) return [];
  const finest = Math.min(...withoutAnchor.map((candidate) => areaKindRank(candidate.kind)));
  return withoutAnchor.filter((candidate) => areaKindRank(candidate.kind) === finest);
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

export function parentMemberships(region: AnalysisRegion): ParentMembership {
  const grains: string[] = [];
  const ids: string[] = [];
  const add = (grain: string, raw: string | null | undefined) => {
    const id = raw?.trim();
    if (!id) return;
    grains.push(grain);
    ids.push(id);
    const bare = bareKey(id);
    if (bare !== id) {
      grains.push(grain);
      ids.push(bare);
    }
  };

  const geoKey = region.geoKey?.trim() || null;
  const ags = region.ags?.trim() || officialAgsKey(geoKey);
  const plz = region.plz?.trim() || null;
  const kreis = kreisAgsFrom(region);
  const gemeinde = municipalityAgsFrom(region);
  const fromKey = catalogLevelFromGeoKey(geoKey);

  if (isKreisPlace(region) && kreis) {
    add("kreis", kreis);
    add("ags5", kreis);
    add("kreis", geoKey);
  }
  if (gemeinde) {
    add("gemeinde", gemeinde);
    add("ags", gemeinde);
    add("gemeinde", geoKey);
  }
  if (ags && ags.length === 8 && ags !== gemeinde) {
    add("gemeinde", ags);
    add("ags", ags);
  }
  if (plz) {
    add("plz5", plz);
    add("plz", plz);
  }
  if (fromKey === "ortsteil" || fromKey === "stadtteil" || /^hamburg_stadtteil:/i.test(geoKey ?? "")) {
    add("ortsteil", geoKey);
    add("stadtteil", geoKey);
    add("hamburg_stadtteil", geoKey);
  }
  if (/^lor:/i.test(geoKey ?? "")) {
    add("lor", geoKey);
  }
  if (fromKey === "bezirk" || fromKey === "stadtbezirk") {
    add("bezirk", geoKey);
    add("stadtbezirk", geoKey);
  }
  if (geoKey && grains.length === 0) {
    add("gemeinde", geoKey);
    add("kreis", geoKey);
    add("plz5", geoKey);
  }
  return { grains, ids };
}

export function excludeKeys(region: AnalysisRegion): string[] {
  return unique(
    [region.geoKey, region.ags, region.plz]
      .map((value) => value?.trim() || null)
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * Parent→child membership from Brain STAGE (`geo.geo_ref_zielregion_teil`).
 * Admin centroids use `geom_4326` / `geom_display` (EPSG:4326). `geom` is 3035.
 *
 * $1 parent_grain[]  $2 parent_id[]  $3 exclude geoKey[]
 */
export function buildTeilCatalogSql(adminMode: "prefer" | "legacy" = "prefer"): string {
  const adminGeom = adminGeom4326("a", adminMode);
  return `
  WITH parents AS (
    SELECT parent_grain, parent_id
      FROM unnest($1::text[], $2::text[]) AS t(parent_grain, parent_id)
  ),
  children AS (
    SELECT DISTINCT t.child_grain, t.child_id
      FROM geo.geo_ref_zielregion_teil t
      INNER JOIN parents p
        ON p.parent_grain = t.parent_grain
       AND p.parent_id = t.parent_id
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
    FROM children c
    JOIN geo.geo_ref_ortsteil o
      ON o.geo_ortsteil_id::text = c.child_id
      OR (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) = c.child_id
    WHERE lower(btrim(c.child_grain)) IN ('ortsteil', 'stadtteil', 'hamburg_stadtteil')
      AND ${hasArea("o")}
      AND lower(btrim(o.kind)) IN ('stadtteil', 'ortsteil')
      AND NULLIF(btrim(o.name), '') IS NOT NULL

    UNION ALL

    SELECT
      CASE
        WHEN c.child_id LIKE 'lor:%' THEN c.child_id
        ELSE 'lor:' || c.child_id
      END AS geo_key,
      'other'::text AS grain,
      'lor'::text AS kind,
      COALESCE(
        NULLIF(btrim(c.child_id), ''),
        CASE WHEN c.child_id LIKE 'lor:%' THEN c.child_id ELSE 'lor:' || c.child_id END
      ) AS name,
      NULL::text AS ags,
      NULL::text AS plz,
      NULL::float8 AS lon,
      NULL::float8 AS lat
    FROM children c
    WHERE lower(btrim(c.child_grain)) = 'lor'
      AND NULLIF(btrim(c.child_id), '') IS NOT NULL

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
    FROM children c
    JOIN geo.geo_ref_bezirk b
      ON b.geo_bezirk_id::text = c.child_id
      OR ('stadtbezirk:' || b.geo_bezirk_id::text) = c.child_id
      OR ('bezirk:' || b.geo_bezirk_id::text) = c.child_id
    WHERE lower(btrim(c.child_grain)) IN ('bezirk', 'stadtbezirk')
      AND ${hasArea("b")}
      AND NULLIF(btrim(b.name), '') IS NOT NULL

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
    FROM children c
    JOIN geo.geo_ref_plz p
      ON p.geo_plz5::text = c.child_id
      OR ('plz5:' || p.geo_plz5::text) = c.child_id
    WHERE lower(btrim(c.child_grain)) IN ('plz5', 'plz')
      AND ${hasArea("p")}
      AND NULLIF(btrim(p.geo_plz5::text), '') IS NOT NULL

    UNION ALL

    SELECT
      a.geo_ags::text AS geo_key,
      CASE WHEN char_length(btrim(a.geo_ags::text)) = 5 THEN 'ags5' ELSE 'ags' END AS grain,
      'gemeinde'::text AS kind,
      NULLIF(btrim(a.name), '') AS name,
      a.geo_ags::text AS ags,
      NULL::text AS plz,
      ST_X(ST_PointOnSurface(${adminGeom})) AS lon,
      ST_Y(ST_PointOnSurface(${adminGeom})) AS lat
    FROM children c
    JOIN geo.geo_ref_admin a
      ON a.geo_ags::text = c.child_id
      OR ('ags:' || a.geo_ags::text) = c.child_id
    WHERE lower(btrim(c.child_grain)) IN ('gemeinde', 'ags')
      AND NULLIF(btrim(a.geo_ags::text), '') IS NOT NULL
      AND char_length(btrim(a.geo_ags::text)) = 8
      AND ${adminGeom} IS NOT NULL
      AND NOT ST_IsEmpty(${adminGeom})
  )
  SELECT geo_key, grain, kind, name, ags, plz, lon, lat
    FROM hits
   WHERE geo_key IS NOT NULL
     AND NOT (geo_key = ANY($3::text[]))
   ORDER BY
     CASE kind
       WHEN 'address' THEN 0
       WHEN 'grid100' THEN 1
       WHEN 'ortsteil' THEN 2
       WHEN 'stadtteil' THEN 2
       WHEN 'lor' THEN 3
       WHEN 'plz' THEN 4
       WHEN 'bezirk' THEN 5
       WHEN 'stadtbezirk' THEN 5
       WHEN 'gemeinde' THEN 6
       ELSE 7
     END,
     name ASC NULLS LAST,
     geo_key ASC
   LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * 100-m Raster cells (`breitband_gitter`) inside the Zielregion.
 * Filter by metadata AGS / Kreis prefix or point-in-polygon. No embeddings.
 *
 * $1 geometry GeoJSON (nullable)
 * $2 ags (nullable)
 * $3 Kreis AGS5 prefix (nullable)
 * $4 exclude geoKey[]
 */
export function buildGrid100CandidateSql(): string {
  return `
  WITH region_geom AS (
    SELECT ${regionGeomExpr()} AS geom
  )
  SELECT
    d.geo_key::text AS geo_key,
    'grid100'::text AS grain,
    'grid100'::text AS kind,
    COALESCE(NULLIF(btrim(d.title), ''), d.geo_key::text) AS name,
    NULLIF(btrim(COALESCE(d.metadata->>'ags', d.metadata->>'geo_ags')), '') AS ags,
    NULLIF(btrim(COALESCE(d.metadata->>'plz', d.metadata->>'geo_plz5')), '') AS plz,
    d.lon::float8 AS lon,
    d.lat::float8 AS lat
  FROM features.location_feature_docs d, region_geom g
  WHERE d.grain = 'grid100'
    AND d.source_theme = 'breitband_gitter'
    AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
    AND NOT (d.geo_key = ANY($4::text[]))
    AND (
      ($2::text IS NOT NULL AND (
        d.metadata->>'ags' = $2
        OR d.metadata->>'geo_ags' = $2
        OR d.metadata->>'ags' LIKE $2 || '%'
      ))
      OR ($3::text IS NOT NULL AND (
        d.metadata->>'ags' LIKE $3 || '%'
        OR d.metadata->>'geo_ags' LIKE $3 || '%'
        OR d.metadata->>'geo_ags5' = $3
      ))
      OR (g.geom IS NOT NULL AND d.lon IS NOT NULL AND d.lat IS NOT NULL
          AND ST_Intersects(g.geom, ST_SetSRID(ST_MakePoint(d.lon::float8, d.lat::float8), 4326)))
    )
  ORDER BY d.geo_key ASC
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * Address grain. Brain currently has 0 docs — skip gracefully when empty.
 *
 * $1 geometry GeoJSON (nullable)
 * $2 ags (nullable)
 * $3 Kreis AGS5 prefix (nullable)
 * $4 exclude geoKey[]
 */
export function buildAddressCandidateSql(): string {
  return `
  WITH region_geom AS (
    SELECT ${regionGeomExpr()} AS geom
  )
  SELECT
    d.geo_key::text AS geo_key,
    'address'::text AS grain,
    'address'::text AS kind,
    COALESCE(NULLIF(btrim(d.title), ''), d.geo_key::text) AS name,
    NULLIF(btrim(COALESCE(d.metadata->>'ags', d.metadata->>'geo_ags')), '') AS ags,
    NULLIF(btrim(COALESCE(d.metadata->>'plz', d.metadata->>'geo_plz5')), '') AS plz,
    d.lon::float8 AS lon,
    d.lat::float8 AS lat
  FROM features.location_feature_docs d, region_geom g
  WHERE d.grain = 'address'
    AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
    AND NOT (d.geo_key = ANY($4::text[]))
    AND (
      ($2::text IS NOT NULL AND (d.metadata->>'ags' = $2 OR d.metadata->>'geo_ags' = $2))
      OR ($3::text IS NOT NULL AND (d.metadata->>'ags' LIKE $3 || '%' OR d.metadata->>'geo_ags5' = $3))
      OR (g.geom IS NOT NULL AND d.lon IS NOT NULL AND d.lat IS NOT NULL
          AND ST_Intersects(g.geom, ST_SetSRID(ST_MakePoint(d.lon::float8, d.lat::float8), 4326)))
    )
  ORDER BY d.geo_key ASC
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * Fallback when `geo_ref_zielregion_teil` is missing: polygon intersect + AGS prefix.
 * Admin map coordinates still use geom_4326 / geom_display, never raw 3035 `geom`.
 *
 * $1 geometry GeoJSON (nullable)
 * $2 ags (nullable)
 * $3 plz (nullable)
 * $4 geoKey (nullable)
 * $5 Kreis AGS5 prefix (nullable)
 * $6 include Gemeinden (Kreis Zielregion)
 */
export function buildAreaCandidateSql(adminMode: "prefer" | "legacy" = "prefer"): string {
  const adminGeom = adminGeom4326("a", adminMode);
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
      ST_X(ST_PointOnSurface(${adminGeom})) AS lon,
      ST_Y(ST_PointOnSurface(${adminGeom})) AS lat
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
       WHEN 'lor' THEN 1
       WHEN 'plz' THEN 2
       WHEN 'bezirk' THEN 3
       WHEN 'stadtbezirk' THEN 3
       WHEN 'gemeinde' THEN 4
       ELSE 5
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

export function featureCandidateParams(
  region: AnalysisRegion,
): [string | null, string | null, string | null, string[]] {
  const geometry = region.geometry ? JSON.stringify(region.geometry) : null;
  const ags = municipalityAgsFrom(region) ?? region.ags?.trim() ?? null;
  const kreis = kreisAgsFrom(region);
  return [geometry, ags, kreis, excludeKeys(region)];
}

/**
 * Berlin LOR keys inside the Zielregion. No invented polygons: lon/lat come
 * from the feature doc when stored, otherwise null. Mapping uses
 * `metadata.geo_bezirk_id` or parent AGS, not a LOR geo_ref table.
 *
 * $1 ags (nullable)
 * $2 exclude geoKey[]
 * $3 bezirk id variants[]
 */
export function buildLorFeatureCandidateSql(): string {
  return `
  SELECT DISTINCT ON (d.geo_key)
    d.geo_key::text AS geo_key,
    'other'::text AS grain,
    'lor'::text AS kind,
    COALESCE(NULLIF(btrim(d.title), ''), d.geo_key::text) AS name,
    NULLIF(btrim(COALESCE(d.metadata->>'ags', d.metadata->>'geo_ags')), '') AS ags,
    NULL::text AS plz,
    d.lon::float8 AS lon,
    d.lat::float8 AS lat
  FROM features.location_feature_docs d
  WHERE d.source_theme = 'berlin_lor_ewr_bevoelkerung'
    AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
    AND d.geo_key LIKE 'lor:%'
    AND NOT (d.geo_key = ANY($2::text[]))
    AND (
      ($3::text[] IS NOT NULL AND cardinality($3::text[]) > 0 AND (
        NULLIF(btrim(d.metadata->>'geo_bezirk_id'), '') = ANY($3::text[])
        OR ('bezirk:' || NULLIF(btrim(d.metadata->>'geo_bezirk_id'), '')) = ANY($3::text[])
        OR ('stadtbezirk:' || NULLIF(btrim(d.metadata->>'geo_bezirk_id'), '')) = ANY($3::text[])
        OR NULLIF(btrim(d.metadata->>'geo_ags'), '') = ANY($3::text[])
      ))
      OR ($1::text IS NOT NULL AND (
        $1 = '11000000'
        OR $1 LIKE '11000%'
        OR d.metadata->>'geo_ags' = $1
        OR d.metadata->>'geo_ags' LIKE $1 || '%'
        OR d.metadata->>'geo_bezirk_id' = $1
        OR d.metadata->>'geo_bezirk_id' LIKE $1 || '%'
      ))
    )
  ORDER BY d.geo_key ASC, d.ref_period DESC NULLS LAST
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * Hamburg Ortsteil fallback keys (`hamburg_stadtteil:{id}`) that are not in
 * geo_ref_ortsteil. Prefer `ortsteil:{id}` from the catalog when it exists.
 *
 * $1 ags (nullable)
 * $2 exclude geoKey[]
 */
export function buildHamburgStadtteilFallbackSql(): string {
  return `
  SELECT DISTINCT ON (d.geo_key)
    d.geo_key::text AS geo_key,
    'other'::text AS grain,
    'ortsteil'::text AS kind,
    COALESCE(NULLIF(btrim(d.title), ''), d.geo_key::text) AS name,
    NULLIF(btrim(COALESCE(d.metadata->>'ags', d.metadata->>'geo_ags')), '') AS ags,
    NULL::text AS plz,
    d.lon::float8 AS lon,
    d.lat::float8 AS lat
  FROM features.location_feature_docs d
  WHERE d.source_theme = 'hamburg_stadtteil_regionalstatistik'
    AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
    AND d.geo_key LIKE 'hamburg_stadtteil:%'
    AND NOT (d.geo_key = ANY($2::text[]))
    AND $1::text IS NOT NULL
    AND (
      $1 = '02000000'
      OR $1 LIKE '02%'
      OR d.metadata->>'geo_ags' = $1
      OR d.metadata->>'ags' = $1
    )
  ORDER BY d.geo_key ASC, d.ref_period DESC NULLS LAST
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

export function lorCandidateParams(region: AnalysisRegion): [string | null, string[], string[]] {
  const ags = municipalityAgsFrom(region) ?? region.ags?.trim() ?? null;
  return [ags, excludeKeys(region), bezirkIdVariants(region)];
}

export function hamburgFallbackParams(region: AnalysisRegion): [string | null, string[]] {
  const ags = municipalityAgsFrom(region) ?? region.ags?.trim() ?? null;
  return [ags, excludeKeys(region)];
}

function bezirkIdVariants(region: AnalysisRegion): string[] {
  const values: string[] = [];
  const membership = parentMemberships(region);
  for (let index = 0; index < membership.grains.length; index += 1) {
    const grain = membership.grains[index];
    const id = membership.ids[index];
    if (!grain || !id) continue;
    if (grain === "bezirk" || grain === "stadtbezirk") values.push(id);
  }
  const geoKey = region.geoKey?.trim();
  if (geoKey && /^(?:bezirk|stadtbezirk):/i.test(geoKey)) values.push(geoKey, bareKey(geoKey));
  const ags = region.ags?.trim();
  if (ags && /^110000(0[1-9]|1[0-2])$/.test(ags)) values.push(ags, `bezirk:${ags}`);
  return unique(values);
}

function geom4326(alias: string): string {
  return `
    CASE
      WHEN ST_SRID(${alias}.geom) IN (0, 4326) THEN ST_SetSRID(${alias}.geom, 4326)
      ELSE ST_Transform(${alias}.geom, 4326)
    END
  `;
}

/**
 * `geo.geo_ref_admin.geom` is EPSG:3035. Map / API lon-lat must use 4326 columns.
 */
export function adminGeom4326(alias: string, mode: "prefer" | "legacy"): string {
  if (mode === "prefer") {
    return `COALESCE(${alias}.geom_4326, ${alias}.geom_display)`;
  }
  return `
    CASE
      WHEN ${alias}.geom IS NULL OR ST_IsEmpty(${alias}.geom) THEN NULL::geometry
      WHEN ST_SRID(${alias}.geom) = 4326 THEN ${alias}.geom
      WHEN ST_SRID(${alias}.geom) = 0 THEN ST_Transform(ST_SetSRID(${alias}.geom, 3035), 4326)
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

function regionGeomExpr(): string {
  return `
    CASE
      WHEN $1::text IS NULL OR btrim($1::text) = '' THEN NULL::geometry
      ELSE ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)
    END
  `;
}

function sameCatalogKey(left: string, right: string): boolean {
  return left === right || bareKey(left) === bareKey(right);
}

function bareKey(value: string): string {
  const match =
    /^(?:ags|ags5|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|grid100|address|lor|hamburg_stadtteil):(.+)$/i.exec(
      value.trim(),
    );
  return match?.[1] ?? value.trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
