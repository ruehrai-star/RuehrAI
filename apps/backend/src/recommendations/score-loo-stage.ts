import { Pool, QueryResult, QueryResultRow } from "pg";
import { AreaBaselineService } from "../analysis/area-baseline.service";
import { AnalysisInput, AnalysisPattern, AnalysisRegion, PatternCriterion } from "../analysis/types";
import { SeriesRegionInput, YearlySeries, asOfFrom } from "../analysis/yearly-series";
import { YearlySeriesService } from "../analysis/yearly-series.service";
import { toCoord } from "../customer/values";
import { DatabaseService, SqlQuery } from "../database/database.service";
import { readPgPoolOptions } from "../database/pool-options";
import { geometryFromUnknown, boundsFromGeometry } from "../geo/region-geometry";
import { NEAREST_LOR_LEGACY_SQL, NEAREST_LOR_PLR_SQL } from "../analysis/store-surroundings.service";
import { AreaCandidate, isLorPlrKey } from "./area-candidates";
import { AreaCandidateService } from "./area-candidate.service";
import {
  LooFixture,
  stampPoolTargetRegion,
  uniqueOrtsteilKeys,
  withFixtureValueKeyHygiene,
} from "./score-loo-fixture";
import { LeaveOneOutStore, assertEnoughLooStores } from "./score-loo";
import { RecommendationPayload } from "./types";

export const DEFAULT_LOO_USER_ID = "2";

export interface LooStageDeps {
  query: SqlQuery;
  yearlyBuild: (regions: SeriesRegionInput[], asOf?: Date) => Promise<YearlySeries[]>;
  loadAreas: (regions: AnalysisRegion[]) => Promise<AreaCandidate[]>;
}

export interface LooStageOptions {
  userId: string;
  runId?: string;
}

interface StoreRow {
  id: string;
  label: string | null;
  street: string;
  postal_code: string;
  city: string;
  lon: number | string | null;
  lat: number | string | null;
}

interface GeoKeyRow {
  geo_key: string | null;
  geo_ags: string | null;
  name?: string | null;
  geometry_geojson?: string | null;
}

interface RunRow {
  id: string;
  input: AnalysisInput;
  pattern: AnalysisPattern;
}

interface SetRow {
  id: string;
  payload: RecommendationPayload;
}

/** Home Ortsteil at a store point, including catalog geometry for PLR load. */
export const ORTSTEIL_AT_POINT_SQL = `
  SELECT (lower(btrim(kind)) || ':' || geo_ortsteil_id::text) AS geo_key,
         NULLIF(btrim(geo_ags::text), '') AS geo_ags,
         NULLIF(btrim(name), '') AS name,
         ST_AsGeoJSON(
           CASE
             WHEN ST_SRID(geom) IN (0, 4326) THEN ST_SetSRID(geom, 4326)
             ELSE ST_Transform(geom, 4326)
           END
         ) AS geometry_geojson
    FROM geo.geo_ref_ortsteil
   WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
     AND lower(btrim(kind)) IN ('stadtteil', 'ortsteil')
     AND ST_Intersects(
       CASE
         WHEN ST_SRID(geom) IN (0, 4326) THEN ST_SetSRID(geom, 4326)
         ELSE ST_Transform(geom, 4326)
       END,
       ST_SetSRID(ST_Point($1::float8, $2::float8), 4326)
     )
   ORDER BY geo_ortsteil_id ASC
   LIMIT 1
`;

const STORES_SQL = `
  SELECT id::text AS id,
         NULLIF(btrim(label), '') AS label,
         street,
         postal_code,
         city,
         lon,
         lat
    FROM app.store_locations
   WHERE user_id = $1::bigint
   ORDER BY created_at ASC, id ASC
`;

const RUN_SQL = `
  SELECT id::text AS id, input, pattern
    FROM app.analysis_runs
   WHERE user_id = $1::bigint
     AND status = 'completed'
     AND ($2::bigint IS NULL OR id = $2::bigint)
   ORDER BY created_at DESC, id DESC
   LIMIT 1
`;

const SET_SQL = `
  SELECT s.id::text AS id, s.payload
    FROM app.recommendation_sets s
    LEFT JOIN app.analysis_runs r ON r.id = s.analysis_run_id
   WHERE s.user_id = $1::bigint
     AND (s.analysis_run_id IS NULL OR r.status = 'completed')
     AND ($2::bigint IS NULL OR s.analysis_run_id = $2::bigint)
   ORDER BY s.created_at DESC, s.id DESC
   LIMIT 1
`;

const WRITE_SQL =
  /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|copy|refresh|reindex|vacuum|merge|call)\b/i;

export function looError(code: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...extra });
}

export function assertReadOnlySql(sql: string): void {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
  if (WRITE_SQL.test(stripped) || /\bfor\s+update\b/i.test(stripped)) {
    throw looError("LOO_WRITE_FORBIDDEN", "Leave-one-out loader is read-only and refused a write statement.");
  }
}

export function createReadOnlyLooPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    application_name: "ruehrai-loo-readonly",
    max: 4,
    ...readPgPoolOptions((key) => process.env[key]),
  });
  pool.on("connect", (client) => {
    void client.query("SET search_path TO app, features, geo, public");
    void client.query("SET default_transaction_read_only = on");
  });
  return pool;
}

export function createReadOnlyLooDb(pool: Pool): Pick<
  DatabaseService,
  "query" | "queryReadingFeatures" | "queryAnalysisFeatures"
> {
  const query = async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> => {
    assertReadOnlySql(String(text));
    return pool.query<T>(text, params);
  };
  return {
    query,
    queryReadingFeatures: query,
    queryAnalysisFeatures: query,
  };
}

export function createLooStageDeps(db: Pick<DatabaseService, "query" | "queryReadingFeatures" | "queryAnalysisFeatures">): LooStageDeps {
  const areaBaseline = new AreaBaselineService(db as DatabaseService);
  const yearly = new YearlySeriesService(db as DatabaseService, areaBaseline);
  const areas = new AreaCandidateService(db as DatabaseService);
  return {
    query: (text, params) => db.query(text, params),
    yearlyBuild: (regions, asOf) => yearly.build(regions, asOf),
    loadAreas: async (regions) => (await areas.load(regions)).items,
  };
}

/**
 * Read-only STAGE load: stores → nearest LOR PLR, live YearlySeries (valueKey
 * preserved), PLR pool in home Ortsteile (else last completed set), criteria
 * from the latest completed analysis_runs.pattern.
 */
export async function loadLooFromDatabase(deps: LooStageDeps, options: LooStageOptions): Promise<LooFixture> {
  const stores = await loadStores(deps.query, options.userId);
  assertEnoughLooStores(stores.map((store) => ({ geoKey: store.id, title: store.title })));

  const resolved = await resolveStorePlrs(deps.query, stores);
  const run = await loadRun(deps.query, options.userId, options.runId);
  const criteria = criteriaOf(run.pattern);
  const homeOrtsteile = uniqueOrtsteilKeys(resolved.map((item) => item.ortsteil?.geoKey));
  const ortsteilRegions = homeOrtsteilRegions(resolved);
  const fromCatalog = ortsteilRegions.length === 0 ? [] : await deps.loadAreas(ortsteilRegions);
  const setPayload = await loadLatestSet(deps.query, options.userId, options.runId);
  const pool = assemblePool(resolved, fromCatalog, setPayload);
  const stamped = stampPoolTargetRegion(pool, homeOrtsteile, setPayload ?? undefined);
  const seriesRegions = seriesRegionsFor(resolved, stamped.pool);
  const asOf = asOfFrom(run.input?.capturedAt);
  const yearly = seriesRegions.length === 0 ? [] : await deps.yearlyBuild(seriesRegions, asOf);

  return withFixtureValueKeyHygiene({
    targetRegionGeoKey: stamped.targetRegionGeoKey,
    targetRegionStampNote: stamped.targetRegionStampNote,
    stores: resolved.map((item) => ({ geoKey: item.plr.geoKey, title: item.store.title })),
    pool: stamped.pool,
    yearly,
    criteria,
  });
}

async function loadStores(query: SqlQuery, userId: string): Promise<Array<StoreRow & { title: string; lon: number; lat: number }>> {
  const result = await query<StoreRow>(STORES_SQL, [userId]);
  if (result.rows.length < 3) {
    throw looError(
      "LOO_TOO_FEW_STORES",
      `Leave-one-out braucht mindestens 3 Bestandsfilialen.`,
      { storeCount: result.rows.length },
    );
  }
  const withCoords = result.rows.map((row) => {
    const lon = toCoord(row.lon);
    const lat = toCoord(row.lat);
    return {
      ...row,
      title: row.label?.trim() || row.street,
      lon: lon ?? Number.NaN,
      lat: lat ?? Number.NaN,
    };
  });
  if (withCoords.some((row) => !Number.isFinite(row.lon) || !Number.isFinite(row.lat))) {
    throw looError("LOO_STORE_PLR_UNRESOLVED", "Leave-one-out needs lon/lat on every store to resolve a LOR PLR.");
  }
  return withCoords as Array<StoreRow & { title: string; lon: number; lat: number }>;
}

async function resolveStorePlrs(
  query: SqlQuery,
  stores: Array<StoreRow & { title: string; lon: number; lat: number }>,
): Promise<
  Array<{
    store: LeaveOneOutStore & { lon: number; lat: number; ags: string | null };
    plr: { geoKey: string; ags: string | null };
    ortsteil: { geoKey: string; ags: string | null; name: string | null; geometry: ReturnType<typeof geometryFromUnknown> } | null;
  }>
> {
  const out: Array<{
    store: LeaveOneOutStore & { lon: number; lat: number; ags: string | null };
    plr: { geoKey: string; ags: string | null };
    ortsteil: { geoKey: string; ags: string | null; name: string | null; geometry: ReturnType<typeof geometryFromUnknown> } | null;
  }> = [];
  for (const store of stores) {
    const plr = await nearestPlr(query, store.lon, store.lat);
    if (!plr) {
      throw looError(
        "LOO_STORE_PLR_UNRESOLVED",
        `Leave-one-out could not resolve a LOR PLR for store ${store.id}.`,
        { storeId: store.id },
      );
    }
    const ortsteil = await nearestOrtsteil(query, store.lon, store.lat);
    out.push({
      store: { geoKey: plr.geoKey, title: store.title, lon: store.lon, lat: store.lat, ags: plr.ags },
      plr,
      ortsteil,
    });
  }
  return out;
}

async function nearestPlr(
  query: SqlQuery,
  lon: number,
  lat: number,
): Promise<{ geoKey: string; ags: string | null } | null> {
  const found = await query<GeoKeyRow>(NEAREST_LOR_PLR_SQL, [lon, lat]);
  const plr = geoKeyOf(found.rows[0]);
  if (plr && isLorPlrKey(plr.geoKey)) return plr;
  const legacy = await query<GeoKeyRow>(NEAREST_LOR_LEGACY_SQL, [lon, lat]);
  return geoKeyOf(legacy.rows[0]);
}

async function nearestOrtsteil(
  query: SqlQuery,
  lon: number,
  lat: number,
): Promise<{ geoKey: string; ags: string | null; name: string | null; geometry: ReturnType<typeof geometryFromUnknown> } | null> {
  const result = await query<GeoKeyRow>(ORTSTEIL_AT_POINT_SQL, [lon, lat]);
  const row = result.rows[0];
  const parsed = geoKeyOf(row);
  if (!parsed) return null;
  const geometry = geometryFromUnknown(parseJson(row.geometry_geojson));
  return { ...parsed, name: row.name?.trim() || null, geometry };
}

async function loadRun(query: SqlQuery, userId: string, runId?: string): Promise<RunRow> {
  const result = await query<RunRow>(RUN_SQL, [userId, runId ?? null]);
  const row = result.rows[0];
  if (!row) {
    throw looError(
      "LOO_NO_ANALYSIS_RUN",
      runId
        ? `Leave-one-out found no completed analysis_runs id=${runId} for user ${userId}.`
        : `Leave-one-out found no completed analysis_runs for user ${userId}.`,
    );
  }
  return row;
}

async function loadLatestSet(
  query: SqlQuery,
  userId: string,
  runId?: string,
): Promise<RecommendationPayload | null> {
  const result = await query<SetRow>(SET_SQL, [userId, runId ?? null]);
  const payload = result.rows[0]?.payload;
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) return null;
  return payload;
}

function assemblePool(
  resolved: Awaited<ReturnType<typeof resolveStorePlrs>>,
  fromCatalog: AreaCandidate[],
  payload: RecommendationPayload | null,
): AreaCandidate[] {
  const catalogPlrs = fromCatalog.filter((item) => item.kind === "lor" && isLorPlrKey(item.geoKey));
  const storePlrs = resolved.map((item) => storePlrCandidate(item));
  const fromSet = payload ? candidatesFromSet(payload) : [];
  const preferred = catalogPlrs.length > 0 ? catalogPlrs : fromSet;
  return uniqueByGeoKey([...storePlrs, ...preferred]);
}

function storePlrCandidate(item: Awaited<ReturnType<typeof resolveStorePlrs>>[number]): AreaCandidate {
  return {
    id: `other:${item.plr.geoKey}`,
    geoKey: item.plr.geoKey,
    grain: "other",
    kind: "lor",
    title: item.store.title,
    name: item.store.title,
    ags: item.plr.ags,
    plz: null,
    lon: item.store.lon,
    lat: item.store.lat,
  };
}

function candidatesFromSet(payload: RecommendationPayload): AreaCandidate[] {
  const items = payload.items ?? [];
  const plr = items.filter((item) => isLorPlrKey(item.location?.geoKey) || item.kind === "lor");
  const source = plr.length > 0 ? plr : items;
  const out: AreaCandidate[] = [];
  for (const item of source) {
    const geoKey = item.location?.geoKey?.trim();
    if (!geoKey) continue;
    out.push({
      id: item.id,
      geoKey,
      grain: item.grain ?? "other",
      kind: item.kind ?? "lor",
      title: item.title,
      name: item.name,
      ags: null,
      plz: null,
      lon: item.location.lon,
      lat: item.location.lat,
      targetRegionGeoKey: item.targetRegionGeoKey,
    });
  }
  return uniqueByGeoKey(out);
}

function homeOrtsteilRegions(
  resolved: Awaited<ReturnType<typeof resolveStorePlrs>>,
): AnalysisRegion[] {
  const seen = new Set<string>();
  const regions: AnalysisRegion[] = [];
  for (const item of resolved) {
    const ortsteil = item.ortsteil;
    const geoKey = ortsteil?.geoKey;
    if (!ortsteil || !geoKey || seen.has(geoKey)) continue;
    seen.add(geoKey);
    const geometry = ortsteil.geometry;
    regions.push({
      label: ortsteil.name || geoKey,
      grain: "other",
      geoKey,
      level: "ortsteil",
      parentLabel: null,
      ags: ortsteil.ags,
      plz: null,
      lon: item.store.lon,
      lat: item.store.lat,
      bounds: geometry ? boundsFromGeometry(geometry) : null,
      geometry,
      updatedAt: new Date(0).toISOString(),
    });
  }
  return regions;
}

function seriesRegionsFor(
  resolved: Awaited<ReturnType<typeof resolveStorePlrs>>,
  pool: AreaCandidate[],
): SeriesRegionInput[] {
  const regions: SeriesRegionInput[] = [];
  const seen = new Set<string>();
  const push = (geoKey: string, ags: string | null | undefined) => {
    if (!geoKey || seen.has(geoKey)) return;
    seen.add(geoKey);
    regions.push({ grain: "other", geoKey, level: "lor", ags: ags ?? null });
  };
  for (const item of resolved) push(item.plr.geoKey, item.plr.ags);
  for (const item of pool) push(item.geoKey, item.ags);
  return regions;
}

function criteriaOf(pattern: AnalysisPattern | undefined): PatternCriterion[] {
  const criteria = pattern?.criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw looError("LOO_NO_CRITERIA", "Leave-one-out needs pattern.criteria on the completed analysis run.");
  }
  return criteria;
}

function geoKeyOf(row: GeoKeyRow | undefined): { geoKey: string; ags: string | null } | null {
  const geoKey = row?.geo_key?.trim();
  if (!geoKey) return null;
  return { geoKey, ags: row?.geo_ags?.trim() || null };
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function uniqueByGeoKey(items: AreaCandidate[]): AreaCandidate[] {
  const seen = new Set<string>();
  const out: AreaCandidate[] = [];
  for (const item of items) {
    if (seen.has(item.geoKey)) continue;
    seen.add(item.geoKey);
    out.push(item);
  }
  return out;
}
