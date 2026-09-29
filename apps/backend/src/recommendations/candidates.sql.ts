import {
  FeatureColumnFlags,
  FeatureRelation,
  flagsFromColumns,
} from "../analysis/brain-search.sql";
import { toContainsPattern } from "../search/search.util";
import { AnalysisRegion } from "../analysis/types";

/** Cap the in-window series read. A full region can be large; the reason field says when this bound hits. */
export const CANDIDATE_ROW_LIMIT = 2400;

export function regionQueryParams(
  region: AnalysisRegion,
): [string | null, string | null, string | null, string | null] {
  const ags = region.ags?.trim() || null;
  const plz = region.plz?.trim() || null;
  const geoKey = region.geoKey?.trim() || null;
  const label =
    !ags && !plz && !geoKey && region.label.trim()
      ? toContainsPattern(region.label.trim())
      : null;
  return [ags, plz, geoKey, label];
}

/**
 * Every feature row in the target region whose `ref_period` falls in `$5`
 * (`YYYY-MM` keys). Same geo filter as the Musteranalyse region search, plus
 * finer grains whose metadata names the region ags or plz. No vector sort:
 * Top-3 ranks the time series, it does not re-run semantic search.
 */
export function buildCandidateSql(
  relation: FeatureRelation,
  columns: ReadonlySet<string>,
): string {
  const flags = flagsFromColumns(columns);
  const lon = columns.has("lon") ? "lon" : "NULL::float8";
  const lat = columns.has("lat") ? "lat" : "NULL::float8";
  return `
    SELECT
      id::text AS id,
      geo_key,
      grain,
      ${flags.name ? "name" : "NULL::text"} AS name,
      ${flags.refPeriod ? "ref_period" : "NULL::text"} AS ref_period,
      ${titleExpr(flags)} AS title,
      ${flags.metadata ? "metadata" : "NULL::jsonb"} AS metadata,
      ${lon} AS lon,
      ${lat} AS lat
    FROM features.${relation}
    WHERE ${regionFilter(flags)}
      AND ref_period IS NOT NULL
      AND left(btrim(ref_period), 7) = ANY($5::text[])
    ORDER BY geo_key ASC, grain ASC, ref_period ASC, id ASC
    LIMIT ${CANDIDATE_ROW_LIMIT}
  `;
}

function titleExpr(flags: FeatureColumnFlags): string {
  if (flags.title) {
    return "COALESCE(NULLIF(btrim(title), ''), NULLIF(btrim(geo_key), ''), id::text)";
  }
  return "COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(geo_key), ''), id::text)";
}

function regionFilter(flags: FeatureColumnFlags): string {
  const metadataArms: string[] = [];
  if (flags.metadata) {
    metadataArms.push(
      "($1::text IS NOT NULL AND (metadata->>'geo_ags' = $1 OR metadata->>'ags' = $1))",
      "($2::text IS NOT NULL AND (metadata->>'plz' = $2 OR metadata->>'geo_plz' = $2))",
      "($3::text IS NOT NULL AND metadata->>'geo_key' = $3)",
    );
  }
  const tagged = metadataArms.length > 0 ? `\n      OR ${metadataArms.join("\n      OR ")}` : "";
  return `(
      ($1::text IS NOT NULL AND grain IN ('ags', 'ags5') AND (geo_key = $1 OR geo_key LIKE $1 || '%'))
      OR ($2::text IS NOT NULL AND grain IN ('plz5', 'plz8') AND (geo_key = $2 OR geo_key LIKE $2 || '%'))
      OR ($3::text IS NOT NULL AND geo_key = $3)${tagged}
      OR (
        $1::text IS NULL
        AND $2::text IS NULL
        AND $3::text IS NULL
        AND $4::text IS NOT NULL
        AND (${labelMatch(flags)})
      )
    )`;
}

function labelMatch(flags: FeatureColumnFlags): string {
  const parts = ["geo_key ILIKE $4 ESCAPE '\\'"];
  if (flags.name) parts.unshift("name ILIKE $4 ESCAPE '\\'");
  if (flags.title) parts.unshift("title ILIKE $4 ESCAPE '\\'");
  return parts.join(" OR ");
}
