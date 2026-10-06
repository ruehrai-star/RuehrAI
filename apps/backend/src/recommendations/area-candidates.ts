import { AnalysisRegion } from "../analysis/types";
import { RegionGeometry } from "../geo/region-geometry";
import { isKreisPlace, kreisAgsFrom, municipalityAgsFrom } from "../analysis/yearly-series";
import { catalogLevelFromGeoKey, municipalityAgsFromDisplayName, officialAgsKey } from "../geo/geo-catalog";
import { Grain } from "../target-region/dto";
import { minNumber } from "../common/safe-array";

/** Cap the geo_ref / feature-doc read. Ranking still returns every loaded Teilfläche. */
export const AREA_CANDIDATE_LIMIT = 200;

export const AREA_KINDS = [
  "address",
  "grid100",
  "lor",
  "quartier",
  "ortsteil",
  "stadtteil",
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
  /** Gemeinde display name from geo_ref_admin / AGS-prefix fallbacks. */
  municipalityName?: string | null;
  /**
   * Zielregion this candidate was loaded for (`AnalysisRegion.geoKey`).
   * Cap, rank, geometry clip, and overlaps stay bound to this key — never
   * inferred from `ags`/`plz`. A Fläche in two Zielregionen is two candidates.
   */
  targetRegionGeoKey?: string;
  /** Clipped hit outline (EPSG:4326), when Brain geom ∩ Zielregion is available. */
  geometry?: RegionGeometry | null;
  geometryUnavailableReason?: string | null;
}

/** Separates `{grain}:{geoKey}` from the Zielregion in set-unique item ids. */
export const TARGET_REGION_ID_SEPARATOR = "@";

/**
 * Set-unique candidate id. Same Fläche in two Zielregionen → two ids:
 * `{grain}:{geoKey}@{targetRegionGeoKey}`.
 */
export function areaCandidateId(
  grain: Grain | string,
  geoKey: string,
  targetRegionGeoKey?: string | null,
): string {
  const base = `${grain}:${geoKey}`;
  const region = targetRegionGeoKey?.trim();
  return region ? `${base}${TARGET_REGION_ID_SEPARATOR}${region}` : base;
}

export function stampCandidateTargetRegion(
  candidate: AreaCandidate,
  targetRegionGeoKey: string,
): AreaCandidate {
  const key = targetRegionGeoKey.trim();
  return {
    ...candidate,
    targetRegionGeoKey: key,
    id: areaCandidateId(candidate.grain, candidate.geoKey, key),
  };
}

export type TargetRegionKeySource = "geoKey" | "ags" | "label";

export interface ResolvedTargetRegionKey {
  key: string;
  source: TargetRegionKeySource;
}

/** Trim, collapse whitespace, lowercase — used in `label:{…}` fallback keys. */
export function normalizeTargetRegionLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}

/**
 * Contract key for a Zielregion: `geoKey` → `ags:{ags}` → `label:{normalized label}`.
 * Always returns a key so the region is never silently dropped.
 */
export function resolveTargetRegionKey(
  region: Pick<AnalysisRegion, "geoKey" | "ags" | "label">,
): ResolvedTargetRegionKey {
  const geoKey = region.geoKey?.trim();
  if (geoKey) return { key: geoKey, source: "geoKey" };
  const ags = region.ags?.trim();
  if (ags) return { key: `ags:${ags}`, source: "ags" };
  return { key: `label:${normalizeTargetRegionLabel(region.label ?? "")}`, source: "label" };
}

export function targetRegionKeyOf(region: Pick<AnalysisRegion, "geoKey" | "ags" | "label">): string {
  return resolveTargetRegionKey(region).key;
}

export interface RecommendationTargetRegionRef {
  geoKey: string;
  label: string;
}

/** Snapshot-order list of keys actually used as `items[].targetRegionGeoKey`. */
export function targetRegionsFromAnalysis(
  regions: Array<Pick<AnalysisRegion, "geoKey" | "ags" | "label">>,
): RecommendationTargetRegionRef[] {
  return regions.map((region) => ({
    geoKey: targetRegionKeyOf(region),
    label: region.label,
  }));
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
  /** GeoJSON text from ST_AsGeoJSON of clipped outline. */
  geometry_geojson?: string | null;
}

export interface ParentMembership {
  grains: string[];
  ids: string[];
}

/**
 * Finest → coarsest. Address is skipped when geo_ref_address / Brain has 0 docs.
 * LOR Planungsraum and Köln-Quartier sit **above** Ortsteil (finer).
 * Catalog load keeps every kind (minus anchors); dataset ranking picks the
 * native Fläche. `selectFinestHits` remains a fallback for a single grain.
 */
export function areaKindRank(kind: AreaKind): number {
  if (kind === "address") return 0;
  if (kind === "grid100") return 1;
  if (kind === "lor" || kind === "quartier") return 2;
  if (kind === "ortsteil" || kind === "stadtteil") return 3;
  if (kind === "plz") return 4;
  if (kind === "bezirk" || kind === "stadtbezirk") return 5;
  if (kind === "gemeinde") return 6;
  return 7;
}

export function isAreaKind(value: string | null | undefined): value is AreaKind {
  return Boolean(value && (AREA_KINDS as readonly string[]).includes(value));
}

export function isLorPlrKey(value: string | null | undefined): boolean {
  return /^lor:plr:/i.test(value?.trim() ?? "");
}

export function isKoelnQuartierKey(value: string | null | undefined): boolean {
  return /^koeln:sq:/i.test(value?.trim() ?? "");
}

const COARSE_REGION_LEVELS = new Set(["bezirk", "stadtbezirk"]);

/**
 * Address and 100-m grid scans are skipped for Bezirk / Stadtbezirk /
 * Kreis Zielregionen. Stufe-1 hits are the finest named sub-areas, not
 * 200 arbitrary addresses. Gemeinde still reads address/grid when present.
 */
export function skipAddressAndGridForRegion(
  region: Pick<AnalysisRegion, "level" | "grain" | "geoKey">,
): boolean {
  const level = region.level?.trim().toLowerCase();
  if (level && COARSE_REGION_LEVELS.has(level)) return true;
  if (region.grain === "ags5") return true;
  const geoKey = region.geoKey?.trim() ?? "";
  if (/^(?:bezirk|stadtbezirk):/i.test(geoKey)) return true;
  return false;
}

function finestKindOrderSql(): string {
  return `CASE kind
       WHEN 'address' THEN 0
       WHEN 'grid100' THEN 1
       WHEN 'lor' THEN 2
       WHEN 'quartier' THEN 2
       WHEN 'ortsteil' THEN 3
       WHEN 'stadtteil' THEN 3
       WHEN 'plz' THEN 4
       WHEN 'bezirk' THEN 5
       WHEN 'stadtbezirk' THEN 5
       WHEN 'gemeinde' THEN 6
       ELSE 7
     END`;
}

export function selectCatalogHits(
  candidates: AreaCandidate[],
  regions: Array<Pick<AnalysisRegion, "geoKey" | "grain" | "ags" | "plz">>,
): AreaCandidate[] {
  return dropLor2006WhenPlrExists(
    candidates.filter((candidate) => !regions.some((region) => isRegionAnchor(candidate, region))),
  );
}

export function selectFinestHits(
  candidates: AreaCandidate[],
  regions: Array<Pick<AnalysisRegion, "geoKey" | "grain" | "ags" | "plz">>,
): AreaCandidate[] {
  const withoutAnchor = dropLor2006WhenPlrExists(
    candidates.filter((candidate) => !regions.some((region) => isRegionAnchor(candidate, region))),
  );
  if (withoutAnchor.length === 0) return [];
  const finest = minNumber(withoutAnchor.map((candidate) => areaKindRank(candidate.kind)));
  return withoutAnchor.filter((candidate) => areaKindRank(candidate.kind) === finest);
}

/** 2021 PLR (`lor:plr:*`) and 2006 LOR are separate; skip 2006 hits when PLR exists. */
function dropLor2006WhenPlrExists(candidates: AreaCandidate[]): AreaCandidate[] {
  const hasPlr = candidates.some((candidate) => candidate.kind === "lor" && isLorPlrKey(candidate.geoKey));
  if (!hasPlr) return candidates;
  return candidates.filter((candidate) => candidate.kind !== "lor" || isLorPlrKey(candidate.geoKey));
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
    if (isLorPlrKey(geoKey)) add("lor_plr", geoKey);
  }
  if (isKoelnQuartierKey(geoKey)) {
    add("quartier", geoKey);
    add("koeln_quartier", geoKey);
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
 * $4 Zielregion GeoJSON (nullable) for clipped hit outlines
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
  region_geom AS (
    SELECT ${regionGeomFromParam("$4")} AS geom
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
      ST_Y(ST_PointOnSurface(${geom4326("o")})) AS lat,
      ${clippedHitGeoJsonSql(geom4326("o"))} AS geometry_geojson
    FROM children c
    JOIN geo.geo_ref_ortsteil o
      ON o.geo_ortsteil_id::text = c.child_id
      OR (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) = c.child_id
    CROSS JOIN region_geom g
    WHERE lower(btrim(c.child_grain)) IN ('ortsteil', 'stadtteil', 'hamburg_stadtteil')
      AND ${hasArea("o")}
      AND lower(btrim(o.kind)) IN ('stadtteil', 'ortsteil')
      AND NULLIF(btrim(o.name), '') IS NOT NULL

    UNION ALL

    SELECT
      ${lorGeoKeyExpr("l", "c.child_id")} AS geo_key,
      'other'::text AS grain,
      'lor'::text AS kind,
      NULLIF(btrim(l.name), '') AS name,
      NULLIF(btrim(l.geo_ags::text), '') AS ags,
      NULL::text AS plz,
      ST_X(ST_PointOnSurface(${geom4326("l")})) AS lon,
      ST_Y(ST_PointOnSurface(${geom4326("l")})) AS lat,
      ${clippedHitGeoJsonSql(geom4326("l"))} AS geometry_geojson
    FROM children c
    JOIN geo.geo_ref_lor l
      ON ${lorJoinOnChild("l", "c.child_id")}
    CROSS JOIN region_geom g
    WHERE lower(btrim(c.child_grain)) IN ('lor', 'lor_plr')
      AND NULLIF(btrim(c.child_id), '') IS NOT NULL
      AND ${lorPlanungsraumFilter("l")}
      AND ${hasArea("l")}

    UNION ALL

    SELECT
      ${koelnQuartierKeyExpr("c.child_id")} AS geo_key,
      'other'::text AS grain,
      'quartier'::text AS kind,
      NULLIF(btrim(q.title), '') AS name,
      COALESCE(
        NULLIF(btrim(q.metadata->>'ags'), ''),
        NULLIF(btrim(q.metadata->>'geo_ags'), ''),
        '05315000'
      ) AS ags,
      NULL::text AS plz,
      q.lon::float8 AS lon,
      q.lat::float8 AS lat,
      NULL::text AS geometry_geojson
    FROM children c
    LEFT JOIN LATERAL (
      SELECT d.title, d.metadata, d.lon, d.lat
        FROM features.location_feature_docs d
       WHERE d.source_theme = 'koeln_statistischer_datenkatalog'
         AND d.geo_key = ${koelnQuartierKeyExpr("c.child_id")}
         AND COALESCE(d.metadata->>'placement', '') IS DISTINCT FROM 'parent_fallback'
       ORDER BY d.ref_period DESC NULLS LAST
       LIMIT 1
    ) q ON true
    WHERE lower(btrim(c.child_grain)) IN ('quartier', 'koeln_quartier')
      AND NULLIF(btrim(c.child_id), '') IS NOT NULL

    UNION ALL

    SELECT
      CASE
        WHEN c.child_id LIKE 'address:%' THEN c.child_id
        ELSE 'address:' || c.child_id
      END AS geo_key,
      'address'::text AS grain,
      'address'::text AS kind,
      COALESCE(NULLIF(btrim(c.child_id), ''), 'address:' || c.child_id) AS name,
      NULL::text AS ags,
      NULL::text AS plz,
      NULL::float8 AS lon,
      NULL::float8 AS lat,
      NULL::text AS geometry_geojson
    FROM children c
    WHERE lower(btrim(c.child_grain)) = 'address'
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
      ST_Y(ST_PointOnSurface(${geom4326("b")})) AS lat,
      ${clippedHitGeoJsonSql(geom4326("b"))} AS geometry_geojson
    FROM children c
    JOIN geo.geo_ref_bezirk b
      ON b.geo_bezirk_id::text = c.child_id
      OR ('stadtbezirk:' || b.geo_bezirk_id::text) = c.child_id
      OR ('bezirk:' || b.geo_bezirk_id::text) = c.child_id
    CROSS JOIN region_geom g
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
      ST_Y(ST_PointOnSurface(${geom4326("p")})) AS lat,
      ${clippedHitGeoJsonSql(geom4326("p"))} AS geometry_geojson
    FROM children c
    JOIN geo.geo_ref_plz p
      ON p.geo_plz5::text = c.child_id
      OR ('plz5:' || p.geo_plz5::text) = c.child_id
    CROSS JOIN region_geom g
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
      ST_Y(ST_PointOnSurface(${adminGeom})) AS lat,
      ${clippedHitGeoJsonSql(adminGeom)} AS geometry_geojson
    FROM children c
    JOIN geo.geo_ref_admin a
      ON a.geo_ags::text = c.child_id
      OR ('ags:' || a.geo_ags::text) = c.child_id
    CROSS JOIN region_geom g
    WHERE lower(btrim(c.child_grain)) IN ('gemeinde', 'ags')
      AND NULLIF(btrim(a.geo_ags::text), '') IS NOT NULL
      AND char_length(btrim(a.geo_ags::text)) = 8
      AND ${adminGeom} IS NOT NULL
      AND NOT ST_IsEmpty(${adminGeom})
  )
  SELECT geo_key, grain, kind, name, ags, plz, lon, lat, geometry_geojson
    FROM hits
   WHERE geo_key IS NOT NULL
     AND NOT (geo_key = ANY($3::text[]))
   ORDER BY
     ${finestKindOrderSql()},
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
    d.lat::float8 AS lat,
      NULL::text AS geometry_geojson
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
 * Official addresses from Location-Guide (`geo.geo_ref_address`: Berlin,
 * Hamburg, NRW) with PLZ / Ortsteil / Bezirk / Gemeinde / 100-m cell.
 * Skip on missing table or unknown columns — do not invent addresses.
 *
 * $1 geometry GeoJSON (nullable)
 * $2 ags (nullable)
 * $3 Kreis AGS5 prefix (nullable)
 * $4 exclude geoKey[]
 * $5 plz (nullable)
 */
export function buildGeoAddressCandidateSql(): string {
  const hitGeom = addressGeom4326("a");
  return `
  WITH region_geom AS (
    SELECT ${regionGeomExpr()} AS geom
  )
  SELECT
    COALESCE(NULLIF(btrim(a.geo_key::text), ''), 'address:' || a.geo_addr_id::text) AS geo_key,
    'address'::text AS grain,
    'address'::text AS kind,
    COALESCE(
      NULLIF(btrim(concat_ws(' ', NULLIF(btrim(a.strasse), ''), NULLIF(btrim(a.hnr), ''))), ''),
      NULLIF(btrim(a.geo_key::text), ''),
      'address:' || a.geo_addr_id::text
    ) AS name,
    NULLIF(btrim(a.geo_ags::text), '') AS ags,
    NULLIF(btrim(a.geo_plz5::text), '') AS plz,
    ST_X(ST_PointOnSurface(${hitGeom})) AS lon,
    ST_Y(ST_PointOnSurface(${hitGeom})) AS lat,
    ${clippedHitGeoJsonSql(hitGeom)} AS geometry_geojson
  FROM geo.geo_ref_address a, region_geom g
  WHERE COALESCE(NULLIF(btrim(a.geo_key::text), ''), 'address:' || a.geo_addr_id::text) IS NOT NULL
    AND NOT (COALESCE(NULLIF(btrim(a.geo_key::text), ''), 'address:' || a.geo_addr_id::text) = ANY($4::text[]))
    AND a.geom_3035 IS NOT NULL AND NOT ST_IsEmpty(a.geom_3035)
    AND (
      ($2::text IS NOT NULL AND (
        a.geo_ags::text = $2
        OR a.geo_ags::text LIKE $2 || '%'
      ))
      OR ($3::text IS NOT NULL AND a.geo_ags::text LIKE $3 || '%')
      OR ($5::text IS NOT NULL AND a.geo_plz5::text = $5)
      OR (g.geom IS NOT NULL AND ST_Intersects(a.geom_3035, ST_Transform(g.geom, 3035)))
    )
  ORDER BY COALESCE(NULLIF(btrim(a.geo_key::text), ''), 'address:' || a.geo_addr_id::text) ASC
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * Address grain on Brain feature docs. Empty today — skip when 0 rows.
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
    d.lat::float8 AS lat,
      NULL::text AS geometry_geojson
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
      ST_Y(ST_PointOnSurface(${geom4326("o")})) AS lat,
      ${clippedHitGeoJsonSql(geom4326("o"))} AS geometry_geojson
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
      ST_Y(ST_PointOnSurface(${geom4326("b")})) AS lat,
      ${clippedHitGeoJsonSql(geom4326("b"))} AS geometry_geojson
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
      ST_Y(ST_PointOnSurface(${geom4326("p")})) AS lat,
      ${clippedHitGeoJsonSql(geom4326("p"))} AS geometry_geojson
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
      ST_Y(ST_PointOnSurface(${adminGeom})) AS lat,
      ${clippedHitGeoJsonSql(adminGeom)} AS geometry_geojson
    FROM geo.geo_ref_admin a, region_geom g
    WHERE $6::boolean
      AND NULLIF(btrim(a.geo_ags::text), '') IS NOT NULL
      AND char_length(btrim(a.geo_ags::text)) = 8
      AND (
        ($5::text IS NOT NULL AND a.geo_ags::text LIKE $5 || '%')
        OR ($2::text IS NOT NULL AND char_length(btrim($2::text)) = 5 AND a.geo_ags::text LIKE $2 || '%')
      )
  )
  SELECT geo_key, grain, kind, name, ags, plz, lon, lat, geometry_geojson
    FROM hits
   WHERE geo_key IS NOT NULL
     AND ($4::text IS NULL OR geo_key IS DISTINCT FROM $4)
     AND ($2::text IS NULL OR geo_key IS DISTINCT FROM $2)
     AND ($3::text IS NULL OR geo_key IS DISTINCT FROM $3)
   ORDER BY
     ${finestKindOrderSql()},
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

export function municipalityAgsForRegion(region: AnalysisRegion): string | null {
  return (
    municipalityAgsFrom(region) ??
    officialAgsKey(region.ags) ??
    municipalityAgsFromDisplayName(region.parentLabel) ??
    municipalityAgsFromDisplayName(region.label)
  );
}

export function featureCandidateParams(
  region: AnalysisRegion,
): [string | null, string | null, string | null, string[]] {
  const geometry = region.geometry ? JSON.stringify(region.geometry) : null;
  const ags = municipalityAgsForRegion(region) ?? region.ags?.trim() ?? null;
  const kreis = kreisAgsFrom(region);
  return [geometry, ags, kreis, excludeKeys(region)];
}

export function geoAddressCandidateParams(
  region: AnalysisRegion,
): [string | null, string | null, string | null, string[], string | null] {
  return [...featureCandidateParams(region), region.plz?.trim() || null];
}

function berlinLorMembershipSql(): string {
  return `
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
  `;
}

/**
 * Berlin LOR Planungsraum outlines (`lor:plr:*`).
 * Real columns: `lor_level` / `valid_from` / `valid_to` (no `lor_version`).
 * `geo_lor_id` is already `lor:plr:…` on STAGE — do not prefix twice.
 * Skip when `geo.geo_ref_lor` is missing (42P01 / 42703).
 *
 * $1 ags (nullable)
 * $2 exclude geoKey[]
 * $3 bezirk id variants[]
 * $4 Zielregion GeoJSON (nullable) for clipped outlines
 */
export function buildLorPlrCatalogSql(): string {
  const geom = geom4326("l");
  const plrKey = lorGeoKeyExpr("l");
  return `
  WITH region_geom AS (
    SELECT ${regionGeomFromParam("$4")} AS geom
  )
  SELECT
    ${plrKey} AS geo_key,
    'other'::text AS grain,
    'lor'::text AS kind,
    NULLIF(btrim(l.name), '') AS name,
    NULLIF(btrim(l.geo_ags::text), '') AS ags,
    NULL::text AS plz,
    ST_X(ST_PointOnSurface(${geom})) AS lon,
    ST_Y(ST_PointOnSurface(${geom})) AS lat,
    ${clippedHitGeoJsonSql(geom)} AS geometry_geojson
  FROM geo.geo_ref_lor l, region_geom g
  WHERE ${lorPlanungsraumFilter("l")}
    AND NOT (${plrKey} = ANY($2::text[]))
    AND ${hasArea("l")}
    AND (
      ($3::text[] IS NOT NULL AND cardinality($3::text[]) > 0 AND (
        NULLIF(btrim(l.geo_bezirk_id::text), '') = ANY($3::text[])
        OR ('bezirk:' || NULLIF(btrim(l.geo_bezirk_id::text), '')) = ANY($3::text[])
        OR ('stadtbezirk:' || NULLIF(btrim(l.geo_bezirk_id::text), '')) = ANY($3::text[])
        OR NULLIF(btrim(l.geo_ags::text), '') = ANY($3::text[])
      ))
      OR ($1::text IS NOT NULL AND (
        $1 = '11000000'
        OR $1 LIKE '11000%'
        OR l.geo_ags::text = $1
        OR l.geo_ags::text LIKE $1 || '%'
      ))
    )
  ORDER BY ${plrKey} ASC
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * Berlin LOR PLR keys from Brain feature docs (`lor:plr:*`, years 2021–2025).
 * Does not concatenate with lor_version=2006.
 *
 * $1 ags (nullable)
 * $2 exclude geoKey[]
 * $3 bezirk id variants[]
 */
export function buildLorPlrFeatureCandidateSql(): string {
  return `
  SELECT DISTINCT ON (d.geo_key)
    d.geo_key::text AS geo_key,
    'other'::text AS grain,
    'lor'::text AS kind,
    COALESCE(NULLIF(btrim(d.title), ''), d.geo_key::text) AS name,
    NULLIF(btrim(COALESCE(d.metadata->>'ags', d.metadata->>'geo_ags')), '') AS ags,
    NULL::text AS plz,
    d.lon::float8 AS lon,
    d.lat::float8 AS lat,
      NULL::text AS geometry_geojson
  FROM features.location_feature_docs d
  WHERE d.source_theme = 'berlin_lor_ewr_bevoelkerung'
    AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
    AND d.geo_key LIKE 'lor:plr:%'
    AND NOT (d.geo_key = ANY($2::text[]))
    ${berlinLorMembershipSql()}
  ORDER BY d.geo_key ASC, d.ref_period DESC NULLS LAST
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * Berlin LOR 2006 keys (`lor:{RAUMID}`, 2001–2020). Used only when no 2021
 * PLR hit exists for the Zielregion. Never mixed into a PLR trend.
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
    d.lat::float8 AS lat,
      NULL::text AS geometry_geojson
  FROM features.location_feature_docs d
  WHERE d.source_theme = 'berlin_lor_ewr_bevoelkerung'
    AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
    AND d.geo_key LIKE 'lor:%'
    AND d.geo_key NOT LIKE 'lor:plr:%'
    AND COALESCE(d.metadata->>'lor_version', '2006') IS DISTINCT FROM '2021'
    AND NOT (d.geo_key = ANY($2::text[]))
    ${berlinLorMembershipSql()}
  ORDER BY d.geo_key ASC, d.ref_period DESC NULLS LAST
  LIMIT ${AREA_CANDIDATE_LIMIT}
`;
}

/**
 * Köln Quartiere (`koeln:sq:*`), finer than Ortsteil. Prefer these keys over
 * quartier→bezirk `parent_fallback` rows.
 * When the Zielregion has no AGS (e.g. Bezirk Innenstadt), derive the
 * municipality AGS or filter by region geometry.
 *
 * $1 ags (nullable, derived Gemeinde AGS allowed)
 * $2 exclude geoKey[]
 * $3 Zielregion GeoJSON (nullable)
 */
export function buildKoelnQuartierCandidateSql(): string {
  return `
  WITH region_geom AS (
    SELECT ${regionGeomFromParam("$3")} AS geom
  )
  SELECT DISTINCT ON (d.geo_key)
    d.geo_key::text AS geo_key,
    'other'::text AS grain,
    'quartier'::text AS kind,
    NULLIF(btrim(d.title), '') AS name,
    NULLIF(btrim(COALESCE(d.metadata->>'ags', d.metadata->>'geo_ags')), '') AS ags,
    NULL::text AS plz,
    d.lon::float8 AS lon,
    d.lat::float8 AS lat,
      NULL::text AS geometry_geojson
  FROM features.location_feature_docs d, region_geom g
  WHERE d.source_theme = 'koeln_statistischer_datenkatalog'
    AND NULLIF(btrim(d.geo_key), '') IS NOT NULL
    AND d.geo_key LIKE 'koeln:sq:%'
    AND COALESCE(d.metadata->>'placement', '') IS DISTINCT FROM 'parent_fallback'
    AND NOT (d.geo_key = ANY($2::text[]))
    AND (
      ($1::text IS NOT NULL AND (
        $1 = '05315000'
        OR $1 LIKE '05315%'
        OR d.metadata->>'geo_ags' = $1
        OR d.metadata->>'ags' = $1
      ))
      OR (g.geom IS NOT NULL AND d.lon IS NOT NULL AND d.lat IS NOT NULL
          AND ST_Intersects(g.geom, ST_SetSRID(ST_MakePoint(d.lon::float8, d.lat::float8), 4326)))
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
    d.lat::float8 AS lat,
      NULL::text AS geometry_geojson
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

export function lorCandidateParams(
  region: AnalysisRegion,
): [string | null, string[], string[], string | null] {
  const ags = municipalityAgsForRegion(region) ?? region.ags?.trim() ?? null;
  return [ags, excludeKeys(region), bezirkIdVariants(region), regionGeometryParam(region)];
}

export function regionGeometryParam(region: AnalysisRegion): string | null {
  return region.geometry ? JSON.stringify(region.geometry) : null;
}

export function hamburgFallbackParams(region: AnalysisRegion): [string | null, string[]] {
  const ags = municipalityAgsForRegion(region) ?? region.ags?.trim() ?? null;
  return [ags, excludeKeys(region)];
}

export function koelnQuartierCandidateParams(
  region: AnalysisRegion,
): [string | null, string[], string | null] {
  return [municipalityAgsForRegion(region) ?? region.ags?.trim() ?? null, excludeKeys(region), regionGeometryParam(region)];
}

export interface CandidateQuery {
  sql: string;
  params: unknown[];
}

/** Highest `$n` placeholder in a Brain SQL string. `0` when none. */
export function highestSqlPlaceholder(sql: string): number {
  let highest = 0;
  const matches = sql.matchAll(/\$(\d+)\b/g);
  for (const match of matches) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest;
}

export function assertCandidateQueryArity(query: CandidateQuery): void {
  const highest = highestSqlPlaceholder(query.sql);
  if (query.params.length === highest) return;
  throw Object.assign(
    new Error(
      `bind message supplies ${query.params.length} parameters, but prepared statement requires ${highest}`,
    ),
    { code: "08P01" },
  );
}

export function geoAddressCandidateQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildGeoAddressCandidateSql(), params: [...geoAddressCandidateParams(region)] };
}

export function addressCandidateQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildAddressCandidateSql(), params: [...featureCandidateParams(region)] };
}

export function grid100CandidateQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildGrid100CandidateSql(), params: [...featureCandidateParams(region)] };
}

export function lorPlrCatalogQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildLorPlrCatalogSql(), params: [...lorCandidateParams(region)] };
}

/** Feature-doc PLR lookup. `$1–$3` only — no clipped-geometry `$4`. */
export function lorPlrFeatureCandidateQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildLorPlrFeatureCandidateSql(), params: [...lorFeatureCandidateParams(region)] };
}

/** Feature-doc LOR 2006 lookup. `$1–$3` only — no clipped-geometry `$4`. */
export function lorFeatureCandidateQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildLorFeatureCandidateSql(), params: [...lorFeatureCandidateParams(region)] };
}

export function koelnQuartierCandidateQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildKoelnQuartierCandidateSql(), params: [...koelnQuartierCandidateParams(region)] };
}

export function hamburgStadtteilFallbackQuery(region: AnalysisRegion): CandidateQuery {
  return { sql: buildHamburgStadtteilFallbackSql(), params: [...hamburgFallbackParams(region)] };
}

export function teilCatalogQuery(
  region: AnalysisRegion,
  adminMode: "prefer" | "legacy" = "prefer",
): CandidateQuery {
  const membership = parentMemberships(region);
  const exclude = [region.geoKey?.trim(), region.ags?.trim(), region.plz?.trim()].filter(
    (value): value is string => Boolean(value),
  );
  return {
    sql: buildTeilCatalogSql(adminMode),
    params: [membership.grains, membership.ids, exclude, regionGeometryParam(region)],
  };
}

export function areaCandidateQuery(
  region: AnalysisRegion,
  adminMode: "prefer" | "legacy" = "prefer",
): CandidateQuery {
  return { sql: buildAreaCandidateSql(adminMode), params: [...areaCandidateParams(region)] };
}

export function lorFeatureCandidateParams(
  region: AnalysisRegion,
): [string | null, string[], string[]] {
  const [ags, exclude, bezirk] = lorCandidateParams(region);
  return [ags, exclude, bezirk];
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


function lorGeoKeyExpr(alias: string, childIdExpr?: string): string {
  const id = `${alias}.geo_lor_id::text`;
  const fallback = childIdExpr ?? id;
  return `CASE
      WHEN ${id} LIKE 'lor:%' THEN ${id}
      WHEN ${fallback} LIKE 'lor:%' THEN ${fallback}
      ELSE 'lor:plr:' || ${id}
    END`;
}

function lorJoinOnChild(alias: string, childIdExpr: string): string {
  const id = `${alias}.geo_lor_id::text`;
  return `(
      ${id} = ${childIdExpr}
      OR ${id} = regexp_replace(${childIdExpr}, '^lor:(plr:)?', '')
      OR ('lor:plr:' || ${id}) = ${childIdExpr}
      OR ${id} = CASE WHEN ${childIdExpr} LIKE 'lor:%' THEN ${childIdExpr} ELSE 'lor:plr:' || ${childIdExpr} END
    )`;
}

function lorPlanungsraumFilter(alias: string): string {
  return `lower(btrim(${alias}.lor_level::text)) IN ('planungsraum', 'plr')
    AND ${alias}.valid_to IS NULL`;
}

function koelnQuartierKeyExpr(childIdExpr: string): string {
  return `CASE
      WHEN ${childIdExpr} LIKE 'koeln:sq:%' THEN ${childIdExpr}
      WHEN ${childIdExpr} LIKE 'quartier:%' THEN regexp_replace(${childIdExpr}, '^quartier:', 'koeln:sq:')
      ELSE 'koeln:sq:' || ${childIdExpr}
    END`;
}

/**
 * $1 municipality AGS[]
 */
export function buildMunicipalityNameSql(): string {
  return `
  SELECT a.geo_ags::text AS geo_ags,
         NULLIF(btrim(a.name), '') AS name
    FROM geo.geo_ref_admin a
   WHERE a.geo_ags::text = ANY($1::text[])
     AND char_length(btrim(a.geo_ags::text)) = 8
`;
}

export function municipalityNameQuery(agsKeys: string[]): CandidateQuery {
  return { sql: buildMunicipalityNameSql(), params: [agsKeys] };
}

/** Share of the hit's area; drop fragments below this (1 %). */
export const OVERLAP_MIN_SHARE = 0.01;

const OVERLAP_HIT_KINDS = new Set<AreaKind>([
  "plz",
  "lor",
  "quartier",
  "ortsteil",
  "stadtteil",
  "grid100",
  "address",
]);

export function overlapEligibleKind(kind: AreaKind): boolean {
  return OVERLAP_HIT_KINDS.has(kind);
}

/** Union of Zielregion outlines as one GeoJSON string, or null. */
export function regionsGeometryParam(regions: AnalysisRegion[]): string | null {
  const geoms = regions
    .map((region) => region.geometry)
    .filter((geom): geom is RegionGeometry => Boolean(geom));
  if (geoms.length === 0) return null;
  if (geoms.length === 1) return JSON.stringify(geoms[0]);
  return JSON.stringify({ type: "GeometryCollection", geometries: geoms });
}

/**
 * Batched spatial parents (Stadtbezirk/Bezirk) for every eligible hit.
 * Hit geoms are clipped to the Zielregion (`$3`, same as `items[].geometry`)
 * before share = intersection / clipped hit area in EPSG:3035.
 * $1 geo_key[]  $2 kind[]  $3 Zielregion GeoJSON (nullable)
 */
export function buildHitOverlapSql(): string {
  const plzGeom = geom4326("p");
  const lorGeom = geom4326("l");
  const ortGeom = geom4326("o");
  const bezirkGeom = geom4326("b");
  const addrGeom = addressGeom4326("a");
  const clip = clipToRegionSql("r.geom", "g");
  return `
  WITH hits AS (
    SELECT geo_key, kind
      FROM unnest($1::text[], $2::text[]) AS t(geo_key, kind)
  ),
  region_geom AS (
    SELECT ${regionGeomFromParam("$3")} AS geom
  ),
  hit_raw AS (
    SELECT h.geo_key, ${plzGeom} AS geom
      FROM hits h
      JOIN geo.geo_ref_plz p
        ON p.geo_plz5::text = h.geo_key
        OR ('plz5:' || p.geo_plz5::text) = h.geo_key
     WHERE h.kind = 'plz'
       AND ${hasArea("p")}

    UNION ALL

    SELECT h.geo_key, ${lorGeom} AS geom
      FROM hits h
      JOIN geo.geo_ref_lor l
        ON ${lorJoinOnChild("l", "h.geo_key")}
     WHERE h.kind = 'lor'
       AND ${hasArea("l")}

    UNION ALL

    SELECT h.geo_key, ${ortGeom} AS geom
      FROM hits h
      JOIN geo.geo_ref_ortsteil o
        ON (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) = h.geo_key
        OR o.geo_ortsteil_id::text = h.geo_key
     WHERE h.kind IN ('ortsteil', 'stadtteil')
       AND ${hasArea("o")}

    UNION ALL

    SELECT grid.geo_key, grid.geom
      FROM (
        SELECT DISTINCT ON (h.geo_key)
          h.geo_key,
          ST_SetSRID(ST_MakePoint(d.lon::float8, d.lat::float8), 4326) AS geom
          FROM hits h
          JOIN features.location_feature_docs d
            ON d.geo_key = h.geo_key
           AND d.grain = 'grid100'
         WHERE h.kind = 'grid100'
           AND d.lon IS NOT NULL
           AND d.lat IS NOT NULL
         ORDER BY h.geo_key ASC, d.ref_period DESC NULLS LAST
      ) grid

    UNION ALL

    SELECT addr.geo_key, addr.geom
      FROM (
        SELECT DISTINCT ON (h.geo_key)
          h.geo_key,
          ${addrGeom} AS geom
          FROM hits h
          JOIN geo.geo_ref_address a
            ON a.geo_key::text = h.geo_key
            OR ('address:' || a.geo_addr_id::text) = h.geo_key
            OR a.geo_addr_id::text = regexp_replace(h.geo_key, '^address:', '')
         WHERE h.kind = 'address'
           AND a.geom_3035 IS NOT NULL
           AND NOT ST_IsEmpty(a.geom_3035)
         ORDER BY h.geo_key ASC
      ) addr
  ),
  hit_geom AS (
    SELECT r.geo_key, ${clip} AS geom
      FROM hit_raw r, region_geom g
  ),
  shares AS (
    SELECT
      h.geo_key AS hit_geo_key,
      CASE
        WHEN b.geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$' THEN b.geo_bezirk_id::text
        ELSE 'stadtbezirk:' || b.geo_bezirk_id::text
      END AS geo_key,
      NULLIF(btrim(b.name), '') AS label,
      CASE
        WHEN b.geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$' THEN 'bezirk'
        ELSE 'stadtbezirk'
      END AS kind,
      ${overlapShareSql("h.geom", bezirkGeom)} AS share
    FROM hit_geom h
    CROSS JOIN region_geom g
    JOIN geo.geo_ref_bezirk b
      ON ${hasArea("b")}
     AND NULLIF(btrim(b.name), '') IS NOT NULL
     AND ${overlapJoinSql("h.geom", bezirkGeom)}
     AND (g.geom IS NULL OR ST_Intersects(${bezirkGeom}, g.geom))
    WHERE h.geom IS NOT NULL
      AND NOT ST_IsEmpty(h.geom)
  )
  SELECT hit_geo_key, geo_key, label, kind, share
    FROM shares
   WHERE share >= ${OVERLAP_MIN_SHARE}
   ORDER BY hit_geo_key ASC, share DESC, label ASC
`;
}

export function hitOverlapQuery(
  hits: Array<{ geoKey: string; kind: AreaKind }>,
  regionGeometry: string | null = null,
): CandidateQuery {
  const eligible = hits.filter((hit) => overlapEligibleKind(hit.kind));
  return {
    sql: buildHitOverlapSql(),
    params: [eligible.map((hit) => hit.geoKey), eligible.map((hit) => hit.kind), regionGeometry],
  };
}

/** Area share for polygons; points (address / grid) use ST_Covers and share 1. */
export function overlapShareSql(hitGeom: string, bezirkGeom: string): string {
  return `CASE
      WHEN ST_Dimension(${hitGeom}) = 0
        OR GeometryType(${hitGeom}) IN ('POINT', 'MULTIPOINT')
      THEN CASE WHEN ST_Covers(${bezirkGeom}, ${hitGeom}) THEN 1::float8 ELSE NULL END
      ELSE (
        ST_Area(ST_Transform(ST_MakeValid(ST_Intersection(${hitGeom}, ${bezirkGeom})), 3035))
        / NULLIF(ST_Area(ST_Transform(${hitGeom}, 3035)), 0)
      )::float8
    END`;
}

export function overlapJoinSql(hitGeom: string, bezirkGeom: string): string {
  return `(
      (
        (ST_Dimension(${hitGeom}) = 0 OR GeometryType(${hitGeom}) IN ('POINT', 'MULTIPOINT'))
        AND ST_Covers(${bezirkGeom}, ${hitGeom})
      )
      OR (
        ST_Dimension(${hitGeom}) > 0
        AND ST_Intersects(${hitGeom}, ${bezirkGeom})
        AND NOT ST_IsEmpty(ST_Intersection(${hitGeom}, ${bezirkGeom}))
      )
    )`;
}

/** Clip hit geom to region_geom CTE `g` — same rule as `items[].geometry`. */
export function clipToRegionSql(hitGeomExpr: string, regionAlias = "g"): string {
  return `CASE
      WHEN ${regionAlias}.geom IS NULL OR ${hitGeomExpr} IS NULL THEN NULL::geometry
      WHEN ST_IsEmpty(ST_Intersection(${hitGeomExpr}, ${regionAlias}.geom)) THEN NULL::geometry
      ELSE ST_MakeValid(ST_Intersection(${hitGeomExpr}, ${regionAlias}.geom))
    END`;
}

/**
 * GeoJSON (EPSG:4326) of hit geom clipped to region_geom CTE `g.geom`.
 * Empty intersection → NULL (caller sets geometryUnavailableReason).
 */
export function clippedHitGeoJsonSql(hitGeomExpr: string): string {
  return `CASE
      WHEN g.geom IS NULL OR ${hitGeomExpr} IS NULL THEN NULL::text
      WHEN ST_IsEmpty(ST_Intersection(${hitGeomExpr}, g.geom)) THEN NULL::text
      ELSE ST_AsGeoJSON(ST_MakeValid(ST_Intersection(${hitGeomExpr}, g.geom)))
    END`;
}

function geom4326(alias: string): string {
  return `
    CASE
      WHEN ST_SRID(${alias}.geom) IN (0, 4326) THEN ST_SetSRID(${alias}.geom, 4326)
      ELSE ST_Transform(${alias}.geom, 4326)
    END
  `;
}

/** Addresses: map coords from geom_3035 (GiST) without transforming the indexed column for the hit test. */
function addressGeom4326(alias: string): string {
  return `ST_Transform(${alias}.geom_3035, 4326)`;
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

function regionGeomFromParam(param: string): string {
  return `
    CASE
      WHEN ${param}::text IS NULL OR btrim(${param}::text) = '' THEN NULL::geometry
      ELSE ST_SetSRID(ST_GeomFromGeoJSON(${param}::text), 4326)
    END
  `;
}

function regionGeomExpr(): string {
  return regionGeomFromParam("$1");
}

function sameCatalogKey(left: string, right: string): boolean {
  return left === right || bareKey(left) === bareKey(right);
}

function bareKey(value: string): string {
  const match =
    /^(?:ags|ags5|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|grid100|address|lor:plr|koeln:sq|quartier|lor|hamburg_stadtteil):(.+)$/i.exec(
      value.trim(),
    );
  return match?.[1] ?? value.trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
