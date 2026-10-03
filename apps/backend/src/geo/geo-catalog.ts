import { canonicalBerlinBezirkAgs, isOfficialBerlinBezirkAgs } from "./bezirk-ags";

/** Values `GET /search` and the stored list send as `level`. */
export const CATALOG_LEVELS = ["plz", "bezirk", "stadtbezirk", "stadtteil", "ortsteil", "gemeinde"] as const;
export type CatalogLevel = (typeof CATALOG_LEVELS)[number];

/** Brain `geo` sub-area tokens. Never `gemeinde` — that table set has no municipalities. */
export const GEO_CATALOG_LEVELS = ["plz", "bezirk", "stadtbezirk", "stadtteil", "ortsteil"] as const;
export type GeoCatalogLevel = (typeof GEO_CATALOG_LEVELS)[number];

export interface CatalogSearchHit {
  id: string;
  label: string;
  grain: string;
  geoKey: string | null;
  level: CatalogLevel;
  parentLabel: string | null;
  geoAgs: string | null;
  lon: number | null;
  lat: number | null;
}

export interface CatalogHitRow {
  id: string;
  label: string;
  grain: string;
  geo_key: string | null;
  level: string;
  parent_label: string | null;
  geo_ags: string | null;
  lon: number | string | null;
  lat: number | string | null;
}

export function isCatalogLevel(value: unknown): value is CatalogLevel {
  return typeof value === "string" && (CATALOG_LEVELS as readonly string[]).includes(value);
}

export function isGeoCatalogLevel(value: unknown): value is GeoCatalogLevel {
  return typeof value === "string" && (GEO_CATALOG_LEVELS as readonly string[]).includes(value);
}

/** Persist only a Brain `geo` token. `gemeinde` is resolved on read, not stored. */
export function persistedCatalogLevel(value: unknown): GeoCatalogLevel | null {
  return isGeoCatalogLevel(value) ? value : null;
}

/**
 * Municipality: grain `ags` (or a bare 8-digit AGS), and not a Berlin Bezirk.
 * Never a PLZ, Bezirk, Stadtbezirk, Stadtteil, or Ortsteil.
 */
export function isMunicipalityPlace(input: {
  grain?: string | null;
  geoKey?: string | null;
  ags?: string | null;
}): boolean {
  const grain = input.grain ?? null;
  if (grain === "plz5" || grain === "plz8" || grain === "other" || grain === "ags5") return false;
  const rawKey = input.geoKey ?? input.ags ?? "";
  if (/^(plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):/i.test(rawKey.trim())) return false;
  const key = bareCatalogKey(input.geoKey) ?? bareCatalogKey(input.ags);
  if (key && isOfficialBerlinBezirkAgs(canonicalBerlinBezirkAgs(key))) return false;
  if (grain === "ags") return true;
  return Boolean(key && /^[0-9]{8}$/.test(key));
}

/** Catalog sub-area token wins. A municipality without one is `gemeinde`. */
export function catalogLevelForPlace(input: {
  grain?: string | null;
  geoKey?: string | null;
  ags?: string | null;
  level?: string | null;
}): CatalogLevel | null {
  if (isGeoCatalogLevel(input.level)) return input.level;
  if (isMunicipalityPlace(input)) return "gemeinde";
  return null;
}

export function catalogLevelForBezirk(id: string): "bezirk" | "stadtbezirk" {
  return isOfficialBerlinBezirkAgs(id) ? "bezirk" : "stadtbezirk";
}

/** `kind` is already one of the two words; anything else is dropped. */
export function catalogLevelForOrtsteilKind(kind: string | null | undefined): "stadtteil" | "ortsteil" | null {
  if (!kind) return null;
  const value = kind.trim().toLowerCase();
  if (value === "stadtteil" || value === "ortsteil") return value;
  return null;
}

export function toCatalogHit(row: CatalogHitRow): CatalogSearchHit | null {
  if (!isGeoCatalogLevel(row.level)) return null;
  const label = emptyToNull(row.label);
  if (!label) return null;
  return {
    id: row.id,
    label,
    grain: row.grain,
    geoKey: row.geo_key ?? null,
    level: row.level,
    parentLabel: emptyToNull(row.parent_label),
    geoAgs: emptyToNull(row.geo_ags),
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
  };
}

/** One search hit per geo key. `11000000` and `11000` stay different keys. */
export function catalogDedupKey(hit: { id: string; grain: string; geoKey?: string | null; level?: string | null }): string {
  if (hit.level === "plz" || hit.grain === "plz5" || hit.grain === "plz8") {
    const plz = bareCatalogKey(hit.geoKey) ?? bareCatalogKey(hit.id);
    return plz ? `plz:${plz}` : `id:${hit.id}`;
  }
  const bare = geoIdentityKey(hit);
  if (bare) {
    const official = canonicalBerlinBezirkAgs(bare);
    if (isOfficialBerlinBezirkAgs(official)) return `bezirk:${official}`;
    return `key:${bare}`;
  }
  return `id:${hit.id}`;
}

/**
 * Same visible name may appear more than once only when `parentLabel`
 * distinguishes the rows. Empty and missing parents are the same parent.
 */
export function catalogNameDedupKey(hit: { label: string; parentLabel?: string | null }): string {
  const label = hit.label.trim().toLocaleLowerCase("de");
  const parent = (hit.parentLabel ?? "").trim().toLocaleLowerCase("de");
  return `name:${label}|${parent}`;
}

/** Bare geo key used for "one hit per geo key". Numeric feature ids are not keys. */
function geoIdentityKey(hit: { id: string; geoKey?: string | null }): string | null {
  const fromGeo = bareCatalogKey(hit.geoKey);
  if (fromGeo) return fromGeo;
  if (!isPrefixedCatalogId(hit.id)) return null;
  return bareCatalogKey(hit.id);
}

function isPrefixedCatalogId(value: string): boolean {
  return /^(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):/i.test(value.trim());
}

export function bareCatalogKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const prefixed = /^(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):(.+)$/i.exec(trimmed);
  return prefixed?.[1] ?? trimmed;
}

export interface CatalogLookupPlan {
  plz: string | null;
  bezirkId: string | null;
  ortsteilId: string | null;
}

/**
 * Decide which Brain `geo` table to read for a PUT/GET outline.
 * Municipality AGS values (not Berlin Bezirke) skip the sub-area tables.
 */
export function catalogLookupPlan(input: {
  grain: string | null;
  geoKey: string | null;
  ags: string | null;
  plz: string | null;
}): CatalogLookupPlan {
  const grain = input.grain;
  const parsed = parseCatalogRef(input.geoKey);
  const agsBare = bareCatalogKey(input.ags);
  const canonicalAgs = agsBare ? canonicalBerlinBezirkAgs(agsBare) : null;

  let plz: string | null = null;
  if (grain === "plz5" || grain === "plz8" || input.plz || parsed.kind === "plz") {
    plz = fiveDigit(input.plz) ?? fiveDigit(parsed.value) ?? fiveDigit(input.geoKey);
  }

  let bezirkId: string | null = null;
  if (parsed.kind === "bezirk" && parsed.value) {
    bezirkId = canonicalBerlinBezirkAgs(parsed.value);
  } else if (canonicalAgs && isOfficialBerlinBezirkAgs(canonicalAgs)) {
    bezirkId = canonicalAgs;
  } else if (parsed.kind === "ags" && parsed.value) {
    const official = canonicalBerlinBezirkAgs(parsed.value);
    if (isOfficialBerlinBezirkAgs(official)) bezirkId = official;
  }

  let ortsteilId: string | null = null;
  if (parsed.kind === "ortsteil" && parsed.value) {
    ortsteilId = parsed.value;
  }

  return { plz, bezirkId, ortsteilId };
}

function parseCatalogRef(geoKey: string | null): { kind: string | null; value: string | null } {
  if (!geoKey) return { kind: null, value: null };
  const trimmed = geoKey.trim();
  const match = /^(ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):(.+)$/i.exec(trimmed);
  if (!match?.[1] || !match[2]) {
    if (/^[0-9]{5}$/.test(trimmed)) return { kind: "plz", value: trimmed };
    if (isOfficialBerlinBezirkAgs(canonicalBerlinBezirkAgs(trimmed))) {
      return { kind: "bezirk", value: canonicalBerlinBezirkAgs(trimmed) };
    }
    return { kind: null, value: trimmed };
  }
  const prefix = match[1].toLowerCase();
  const value = match[2];
  if (prefix === "plz5" || prefix === "plz8") return { kind: "plz", value };
  if (prefix === "bezirk" || prefix === "stadtbezirk") return { kind: "bezirk", value };
  if (prefix === "stadtteil" || prefix === "ortsteil") return { kind: "ortsteil", value };
  if (prefix === "ags") return { kind: "ags", value };
  return { kind: null, value };
}

function fiveDigit(value: string | null | undefined): string | null {
  if (!value) return null;
  const bare = bareCatalogKey(value);
  return bare && /^[0-9]{5}$/.test(bare) ? bare : null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toCoord(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const GEOM_4326 = `
  CASE
    WHEN ST_SRID(geom) IN (0, 4326) THEN ST_SetSRID(geom, 4326)
    ELSE ST_Transform(geom, 4326)
  END
`;

const HAS_AREA = `geom IS NOT NULL AND NOT ST_IsEmpty(geom)`;

const HAS_NAME = `NULLIF(btrim(name), '') IS NOT NULL`;

const BERLIN_BEZIRK = `geo_bezirk_id::text ~ '^110000(0[1-9]|1[0-2])$'`;

const PARENT_LABEL = `
  COALESCE(
    NULLIF(btrim(admin.name), ''),
    CASE WHEN src.geo_ags = '11000000' THEN 'Berlin' END
  )
`;

/**
 * Visible free-text fields only. `id`, `geo_key`, and `geo_ags` are catalog
 * keys (`plz5:…`, `ortsteil:osm:…`, `ags:…`) and must not participate in `q`.
 */
const VISIBLE_TEXT_MATCH = `
  src.label ILIKE $4 ESCAPE '\\'
  OR COALESCE(${PARENT_LABEL}, '') ILIKE $4 ESCAPE '\\'
`;

/**
 * Query-scoped catalog. Empty/null `geom` and nameless rows are excluded.
 * `level` is the machine token the web badge uses. This union is only
 * PLZ / Bezirk / Stadtteil / Ortsteil; never `gemeinde` for a sub-area.
 * `$6` is an exact id/geo_key lookup for a stored place, not free-text.
 * `$8` is true when PLZ rows may appear (no `q`, or `q` is only digits).
 */
export const GEO_CATALOG_SEARCH_SQL = `
  WITH catalog AS (
    SELECT
      ('plz5:' || p.geo_plz5::text) AS id,
      p.geo_plz5::text AS label,
      'plz5'::text AS grain,
      p.geo_plz5::text AS geo_key,
      'plz'::text AS level,
      p.geo_ags::text AS geo_ags,
      ${GEOM_4326} AS geom
    FROM geo.geo_ref_plz p
    WHERE ${HAS_AREA}
      AND NULLIF(btrim(p.geo_plz5::text), '') IS NOT NULL

    UNION ALL

    SELECT
      CASE
        WHEN ${BERLIN_BEZIRK} THEN 'ags:' || b.geo_bezirk_id::text
        ELSE 'stadtbezirk:' || b.geo_bezirk_id::text
      END AS id,
      NULLIF(btrim(b.name), '') AS label,
      CASE
        WHEN ${BERLIN_BEZIRK} THEN 'ags'
        ELSE 'other'
      END AS grain,
      CASE
        WHEN ${BERLIN_BEZIRK} THEN b.geo_bezirk_id::text
        ELSE 'stadtbezirk:' || b.geo_bezirk_id::text
      END AS geo_key,
      CASE
        WHEN ${BERLIN_BEZIRK} THEN 'bezirk'
        ELSE 'stadtbezirk'
      END AS level,
      COALESCE(
        NULLIF(btrim(b.geo_ags::text), ''),
        CASE WHEN ${BERLIN_BEZIRK} THEN '11000000' END
      ) AS geo_ags,
      ${GEOM_4326} AS geom
    FROM geo.geo_ref_bezirk b
    WHERE ${HAS_AREA}
      AND ${HAS_NAME}

    UNION ALL

    SELECT
      (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) AS id,
      NULLIF(btrim(o.name), '') AS label,
      'other'::text AS grain,
      (lower(btrim(o.kind)) || ':' || o.geo_ortsteil_id::text) AS geo_key,
      lower(btrim(o.kind)) AS level,
      o.geo_ags::text AS geo_ags,
      ${GEOM_4326} AS geom
    FROM geo.geo_ref_ortsteil o
    WHERE ${HAS_AREA}
      AND lower(btrim(o.kind)) IN ('stadtteil', 'ortsteil')
      AND ${HAS_NAME}
  )
  SELECT
    src.id,
    src.label,
    src.grain,
    src.geo_key,
    src.level,
    ${PARENT_LABEL} AS parent_label,
    src.geo_ags,
    ST_X(ST_PointOnSurface(src.geom)) AS lon,
    ST_Y(ST_PointOnSurface(src.geom)) AS lat
  FROM catalog src
  LEFT JOIN geo.geo_ref_admin admin ON admin.geo_ags = src.geo_ags
  WHERE src.label IS NOT NULL
    AND ($1::text IS NULL OR src.geo_ags = $1 OR src.geo_key = $1 OR src.id = ('ags:' || $1) OR src.id = ('stadtbezirk:' || $1))
    AND ($2::text IS NULL OR (src.level = 'plz' AND src.geo_key = $2))
    AND $3::text IS NULL
    AND ($6::text IS NULL OR src.geo_key = $6 OR src.id = $6)
    AND ($7::text IS NULL OR src.grain = $7)
    AND ($8::boolean OR src.level <> 'plz')
    AND (
      $4::text IS NULL
      OR (
        $5::text = 'plz'
        AND src.level = 'plz'
        AND src.label ILIKE $4 ESCAPE '\\'
      )
      OR (
        $5::text = 'ags'
        AND src.level IN ('bezirk', 'stadtbezirk')
        AND (${VISIBLE_TEXT_MATCH})
      )
      OR (
        $5::text IS NULL
        AND (${VISIBLE_TEXT_MATCH})
      )
    )
  ORDER BY src.label ASC, parent_label ASC NULLS LAST, src.id ASC
  LIMIT 50
`;

/** Same filter without `geo.geo_ref_admin` when that table is not installed. */
export const GEO_CATALOG_SEARCH_SQL_NO_ADMIN = GEO_CATALOG_SEARCH_SQL.replace(
  /\s+LEFT JOIN geo\.geo_ref_admin admin ON admin\.geo_ags = src\.geo_ags/g,
  "",
).replace(/NULLIF\(btrim\(admin\.name\), ''\)/g, "NULL");

export const GEO_PLZ_OUTLINE_SQL = `
  SELECT ST_AsGeoJSON(${GEOM_4326})::json AS geometry,
         ST_X(ST_PointOnSurface(${GEOM_4326})) AS lon,
         ST_Y(ST_PointOnSurface(${GEOM_4326})) AS lat
  FROM geo.geo_ref_plz
  WHERE geo_plz5::text = $1
    AND ${HAS_AREA}
  LIMIT 1
`;

export const GEO_BEZIRK_OUTLINE_SQL = `
  SELECT ST_AsGeoJSON(${GEOM_4326})::json AS geometry,
         ST_X(ST_PointOnSurface(${GEOM_4326})) AS lon,
         ST_Y(ST_PointOnSurface(${GEOM_4326})) AS lat
  FROM geo.geo_ref_bezirk
  WHERE geo_bezirk_id::text = $1
    AND ${HAS_AREA}
  LIMIT 1
`;

export const GEO_ORTSTEIL_OUTLINE_SQL = `
  SELECT ST_AsGeoJSON(${GEOM_4326})::json AS geometry,
         ST_X(ST_PointOnSurface(${GEOM_4326})) AS lon,
         ST_Y(ST_PointOnSurface(${GEOM_4326})) AS lat
  FROM geo.geo_ref_ortsteil
  WHERE geo_ortsteil_id::text = $1
    AND ${HAS_AREA}
    AND lower(btrim(kind)) IN ('stadtteil', 'ortsteil')
  LIMIT 1
`;
