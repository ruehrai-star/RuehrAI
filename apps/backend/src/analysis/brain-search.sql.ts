export type FeatureRelation = "v_location_search" | "location_feature_docs";

export interface FeatureColumnFlags {
  title: boolean;
  name: boolean;
  refPeriod: boolean;
  content: boolean;
  metadata: boolean;
  sourceTheme: boolean;
  embedding: boolean;
}

export function flagsFromColumns(columns: ReadonlySet<string>): FeatureColumnFlags {
  return {
    title: columns.has("title"),
    name: columns.has("name"),
    refPeriod: columns.has("ref_period"),
    content: columns.has("content"),
    metadata: columns.has("metadata"),
    sourceTheme: columns.has("source_theme"),
    embedding: columns.has("embedding"),
  };
}

export function relationIsSearchable(columns: ReadonlySet<string>): boolean {
  return (
    columns.has("id") &&
    columns.has("geo_key") &&
    columns.has("grain") &&
    (columns.has("title") || columns.has("name"))
  );
}

/**
 * Prefer the document table when it is visible: it carries `content` and
 * `embedding`. Fall back to the search view, which is what `/search` reads
 * and what a restricted role may be allowed to see.
 */
export function chooseRelation(
  tableColumns: ReadonlySet<string> | null,
  viewColumns: ReadonlySet<string> | null,
): { relation: FeatureRelation; columns: ReadonlySet<string> } | null {
  if (tableColumns && relationIsSearchable(tableColumns)) {
    return { relation: "location_feature_docs", columns: tableColumns };
  }
  if (viewColumns && relationIsSearchable(viewColumns)) {
    return { relation: "v_location_search", columns: viewColumns };
  }
  return null;
}

export function buildRegionSql(
  relation: FeatureRelation,
  flags: FeatureColumnFlags,
  vector: boolean,
): string {
  return `
    SELECT ${selectList(flags, vector)}
    FROM features.${relation}
    WHERE (
      ($1::text IS NOT NULL AND grain IN ('ags', 'ags5') AND (geo_key = $1 OR geo_key LIKE $1 || '%'))
      OR ($2::text IS NOT NULL AND grain IN ('plz5', 'plz8') AND (geo_key = $2 OR geo_key LIKE $2 || '%'))
      OR ($3::text IS NOT NULL AND geo_key = $3)
      OR (
        $1::text IS NULL
        AND $2::text IS NULL
        AND $3::text IS NULL
        AND $4::text IS NOT NULL
        AND (${labelMatch(flags)})
      )
    )
    ${vector ? "AND embedding IS NOT NULL" : ""}
    ${orderBy(flags, vector, 5)}
    LIMIT 8
  `;
}

export function buildStoreSql(
  relation: FeatureRelation,
  flags: FeatureColumnFlags,
  vector: boolean,
): string {
  const vectorParam = vector ? "$2::vector" : "";
  return `
    SELECT ${selectList(flags, vector, vectorParam)}
    FROM features.${relation}
    WHERE cardinality($1::text[]) > 0
      AND grain IN ('plz5', 'plz8')
      AND EXISTS (
        SELECT 1
        FROM unnest($1::text[]) AS wanted(code)
        WHERE geo_key = wanted.code OR geo_key LIKE wanted.code || '%'
      )
    ${vector ? "AND embedding IS NOT NULL" : ""}
    ${orderBy(flags, vector, 2)}
    LIMIT 4
  `;
}

function selectList(flags: FeatureColumnFlags, vector: boolean, vectorCast = "$5::vector"): string {
  const title = flags.title
    ? "COALESCE(NULLIF(btrim(title), ''), NULLIF(btrim(geo_key), ''), id::text)"
    : "COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(geo_key), ''), id::text)";
  return `
    id::text AS id,
    geo_key,
    grain,
    ${flags.name ? "name" : "NULL::text"} AS name,
    ${flags.refPeriod ? "ref_period" : "NULL::text"} AS ref_period,
    ${title} AS title,
    ${flags.content ? "content" : "NULL::text"} AS content,
    ${flags.metadata ? "metadata" : "NULL::jsonb"} AS metadata,
    ${flags.sourceTheme ? "source_theme" : "NULL::text"} AS source_theme,
    ${vector ? `(embedding <=> ${vectorCast})::float8` : "NULL::float8"} AS distance
  `;
}

function labelMatch(flags: FeatureColumnFlags): string {
  const parts = ["geo_key ILIKE $4 ESCAPE '\\'"];
  if (flags.name) parts.unshift("name ILIKE $4 ESCAPE '\\'");
  if (flags.title) parts.unshift("title ILIKE $4 ESCAPE '\\'");
  return parts.join(" OR ");
}

function orderBy(
  flags: FeatureColumnFlags,
  vector: boolean,
  vectorParamIndex: number,
): string {
  if (!vector) {
    return flags.refPeriod ? "ORDER BY ref_period DESC NULLS LAST, id ASC" : "ORDER BY id ASC";
  }
  // Cosine distance. An HNSW index on embedding (Brain, not this service)
  // can serve this ORDER BY when the planner combines it with the region filter.
  return `ORDER BY embedding <=> $${vectorParamIndex}::vector ASC, id ASC`;
}
