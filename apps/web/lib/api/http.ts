import type { Feature, FeatureCollection, Geometry } from "geojson";
import type {
  AnalysisBrain,
  AnalysisInput,
  AnalysisPattern,
  AnalysisRun,
  Credentials,
  CriterionDirection,
  ErrorResponse,
  FeatureCollection as ContractFeatureCollection,
  HealthResponse,
  MonthlyRevenuePoint,
  MonthlyRevenuePointWrite,
  MonthlyRevenueSeries,
  PatternLevelProfile,
  PatternDatasetProfile,
  RecommendationCreate,
  RecommendationEvidence,
  RevenueDirection,
  StoreList,
  StoreLocation,
  StoreLocationWrite,
  TargetRegionList,
  TargetRegionWrite,
  TokenResponse,
  YearlySeries,
} from "@ruehrai/api-contracts";
import { catalogLevelOf, catalogParentName, visibleSavedRegions } from "../format.ts";
import { isAnalysisRunFailureReason } from "../analysis/failure.ts";
import { readContractBounds, readRegionGeometry } from "../map/karte.ts";
import { coordinatesOf, pointFromGeometry } from "./geo.ts";
import { parseAddressPair } from "../addresses/parse.ts";
import type { AddressPairRequest, AddressPairResult } from "../addresses/types.ts";
import type { RuehrApi } from "./client";
import {
  ApiError,
  NetworkError,
  isCatalogLevel,
  isGrain,
  type AnalysisPatternQuery,
  type AnalysisPatternRegion,
  type AnalysisPatternResponse,
  type Recommendation,
  type RecommendationQuery,
  type RecommendationSet,
  type SearchHit,
  type SearchResponse,
  type Session,
  type TargetRegion,
} from "./types.ts";

export const DEFAULT_API_BASE_URL = "http://localhost:3000";

export interface HttpApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  getAccessToken?: () => string | null;
}

// Next.js inlines NEXT_PUBLIC_* only for a static `process.env.NEXT_PUBLIC_*`
// member. Reading the value off a passed-in `process.env` object stays
// undefined in the client bundle and falls back to the localhost default.
export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured === undefined) return DEFAULT_API_BASE_URL;
  return configured.trim().replace(/\/+$/, "");
}

export function createHttpApi(options: HttpApiOptions = {}): RuehrApi {
  const baseUrl = (options.baseUrl ?? apiBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const getAccessToken = options.getAccessToken ?? (() => null);

  async function request<T>(
    path: string,
    init: {
      method?: string;
      body?: string;
      query?: Record<string, string | undefined>;
      auth?: boolean;
      empty?: boolean;
      nullOn404?: boolean;
    },
  ): Promise<T> {
    const headers = new Headers();
    if (init.body) headers.set("Content-Type", "application/json");
    if (init.auth) {
      const token = getAccessToken();
      if (!token) throw new ApiError("Anmeldung erforderlich.", 401);
      headers.set("Authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, init.query), {
        method: init.method ?? "GET",
        headers,
        body: init.body,
      });
    } catch (error) {
      if (error instanceof NetworkError) throw error;
      throw new NetworkError(`Backend nicht erreichbar (${baseUrl}).`);
    }

    if (init.nullOn404 && response.status === 404) {
      return null as T;
    }
    if (!response.ok) {
      throw new ApiError(await readErrorMessage(response), response.status);
    }
    if (init.empty || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    health(): Promise<HealthResponse> {
      return request<HealthResponse>("/health", {});
    },

    async search(query: string): Promise<SearchResponse> {
      const body = await request<SearchResponse>("/search", {
        auth: true,
        query: { q: query },
      });
      return { hits: parseHits(body) };
    },

    async getLayer(id: string): Promise<ContractFeatureCollection> {
      const body = await request<ContractFeatureCollection>(`/layers/${encodeURIComponent(id)}`, {
        auth: true,
      });
      return parseLayer(body);
    },

    login(credentials: Credentials): Promise<Session> {
      return sessionFromToken("/auth/login", credentials, () =>
        request<TokenResponse>("/auth/login", {
          method: "POST",
          body: JSON.stringify(credentials),
        }),
      );
    },

    register(credentials: Credentials): Promise<Session> {
      return sessionFromToken("/auth/register", credentials, () =>
        request<TokenResponse>("/auth/register", {
          method: "POST",
          body: JSON.stringify(credentials),
        }),
      );
    },

    async logout(): Promise<void> {
      await request<void>("/auth/logout", { method: "POST", auth: true, empty: true });
    },

    async listTargetRegions(): Promise<TargetRegion[]> {
      const body = await request<TargetRegionList | null>("/target-region", { auth: true, nullOn404: true });
      return body ? parseTargetRegionList(body) : [];
    },

    async addTargetRegion(region: TargetRegionWrite): Promise<TargetRegion> {
      const body = await request<TargetRegion>("/target-region", {
        method: "POST",
        auth: true,
        body: JSON.stringify(region),
      });
      return parseTargetRegion(body);
    },

    async removeTargetRegion(geoKey: string): Promise<void> {
      const key = geoKey.trim();
      if (!key) throw new ApiError("Antwort von /target-region ist ungültig.", 502);
      await request<void>(`/target-region/${encodeURIComponent(key)}`, {
        method: "DELETE",
        auth: true,
        empty: true,
      });
    },

    async clearTargetRegions(): Promise<void> {
      await request<void>("/target-region", { method: "DELETE", auth: true, empty: true });
    },

    async listStores(): Promise<StoreLocation[]> {
      const body = await request<StoreList>("/stores", { auth: true });
      if (!body || !Array.isArray(body.stores)) {
        throw new ApiError("Antwort von GET /stores ist ungültig.", 502);
      }
      return body.stores.map(parseStore);
    },

    async createStore(store: StoreLocationWrite): Promise<StoreLocation> {
      const body = await request<StoreLocation>("/stores", {
        method: "POST",
        auth: true,
        body: JSON.stringify(store),
      });
      return parseStore(body);
    },

    async updateStore(id: string, store: StoreLocationWrite): Promise<StoreLocation> {
      const body = await request<StoreLocation>(`/stores/${encodeURIComponent(id)}`, {
        method: "PUT",
        auth: true,
        body: JSON.stringify(store),
      });
      return parseStore(body);
    },

    async deleteStore(id: string): Promise<void> {
      await request<void>(`/stores/${encodeURIComponent(id)}`, { method: "DELETE", auth: true, empty: true });
    },

    async listStoreRevenue(id: string): Promise<MonthlyRevenuePoint[]> {
      const body = await request<MonthlyRevenueSeries>(`/stores/${encodeURIComponent(id)}/revenue`, {
        auth: true,
      });
      return parseRevenueSeries(body);
    },

    async putStoreRevenue(id: string, points: MonthlyRevenuePointWrite[]): Promise<MonthlyRevenuePoint[]> {
      const body = await request<MonthlyRevenueSeries>(`/stores/${encodeURIComponent(id)}/revenue`, {
        method: "PUT",
        auth: true,
        body: JSON.stringify({ points }),
      });
      return parseRevenueSeries(body);
    },

    async getAnalysisInput(): Promise<AnalysisInput> {
      const body = await request<AnalysisInput>("/analysis/input", { auth: true });
      return parseAnalysisInput(body);
    },

    async createAnalysisRun(query?: { geoKey?: string | null }): Promise<AnalysisRun> {
      const geoKey = trimQueryValue(query?.geoKey);
      const body = await request<AnalysisRun>("/analysis/runs", {
        method: "POST",
        auth: true,
        // Marked Zielregion in the JSON body (and as ?geoKey=). Nest 9545ce2
        // still snapshots every saved row and ignores both; the body is what
        // a backend that honors the mark must read. Never send another
        // region's key or an empty list default.
        query: geoKey ? { geoKey } : undefined,
        body: geoKey ? JSON.stringify({ geoKey }) : undefined,
      });
      return parseAnalysisRun(body, { allowIncomplete: true });
    },

    async getAnalysisRun(id: string): Promise<AnalysisRun> {
      const body = await request<AnalysisRun>(`/analysis/runs/${encodeURIComponent(id)}`, { auth: true });
      return parseAnalysisRun(body, { allowIncomplete: true });
    },

    async getAnalysisPattern(query?: AnalysisPatternQuery): Promise<AnalysisPatternResponse | null> {
      const geoKey = trimQueryValue(query?.geoKey);
      const body = await request<AnalysisPatternResponse | null>("/analysis/pattern", {
        auth: true,
        nullOn404: true,
        query: geoKey ? { geoKey } : undefined,
      });
      return body ? parseAnalysisPatternResponse(body) : null;
    },

    async getRecommendations(query?: RecommendationQuery): Promise<RecommendationSet | null> {
      const runId = trimQueryValue(query?.runId);
      const body = await request<RecommendationSet | null>("/recommendations", {
        auth: true,
        nullOn404: true,
        query: runId ? { runId } : undefined,
      });
      return body ? parseRecommendationSet(body) : null;
    },

    async createRecommendations(body?: RecommendationCreate): Promise<RecommendationSet> {
      const created = await request<RecommendationSet>("/recommendations", {
        method: "POST",
        auth: true,
        body: body?.runId ? JSON.stringify({ runId: body.runId }) : undefined,
      });
      return parseRecommendationSet(created);
    },

    async evaluateAddressPair(body: AddressPairRequest): Promise<AddressPairResult> {
      const response = await request<unknown>("/address-pair", {
        method: "POST",
        auth: true,
        body: JSON.stringify(body),
      });
      return parseAddressPair(response);
    },
  };
}

async function sessionFromToken(
  route: string,
  credentials: Credentials,
  read: () => Promise<TokenResponse>,
): Promise<Session> {
  const token = await read();
  if (
    typeof token?.accessToken !== "string" ||
    token.tokenType !== "Bearer" ||
    typeof token.expiresIn !== "number"
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  return {
    accessToken: token.accessToken,
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    email: credentials.email.trim().toLowerCase(),
  };
}

function parseTargetRegionList(body: TargetRegionList): TargetRegion[] {
  if (!body || !Array.isArray(body.items)) {
    throw new ApiError("Antwort von /target-region ist ungültig.", 502);
  }
  return visibleSavedRegions(body.items.map(parseTargetRegion));
}

function parseTargetRegion(body: TargetRegion): TargetRegion {
  if (!body || typeof body.label !== "string" || typeof body.updatedAt !== "string") {
    throw new ApiError("Antwort von /target-region ist ungültig.", 502);
  }
  if (body.grain != null && !isGrain(body.grain)) {
    throw new ApiError("Antwort von /target-region ist ungültig.", 502);
  }
  const raw = body as TargetRegion & { level?: unknown; parentLabel?: unknown };
  return {
    ...body,
    bounds: readContractBounds(body.bounds),
    geometry: readRegionGeometry(body.geometry),
    level: catalogLevelOf(raw.level),
    parentLabel: catalogParentName(raw),
  };
}

function parseStore(body: StoreLocation): StoreLocation {
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.street !== "string" ||
    typeof body.postalCode !== "string" ||
    typeof body.city !== "string"
  ) {
    throw new ApiError("Antwort von /stores ist ungültig.", 502);
  }
  const point = coordinatesOf(body);
  return {
    ...body,
    lon: point?.lon ?? null,
    lat: point?.lat ?? null,
  };
}

function parseRevenueSeries(body: MonthlyRevenueSeries): MonthlyRevenuePoint[] {
  if (!body || !Array.isArray(body.points)) {
    throw new ApiError("Antwort von /stores/{id}/revenue ist ungültig.", 502);
  }
  return body.points.map((point) => {
    if (
      !point ||
      typeof point.year !== "number" ||
      typeof point.month !== "number" ||
      !(point.revenueEur === null || typeof point.revenueEur === "number")
    ) {
      throw new ApiError("Antwort von /stores/{id}/revenue ist ungültig.", 502);
    }
    return point;
  });
}

export function toMapFeatureCollection(layer: ContractFeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: layer.features.map((feature) => {
      const geometry = feature.geometry as Geometry;
      const point = pointFromGeometry(feature.geometry);
      const label = typeof feature.properties.label === "string" ? feature.properties.label : feature.id;
      return {
        type: "Feature",
        id: feature.id,
        geometry,
        properties: {
          ...feature.properties,
          id: feature.id,
          label,
          lon: point?.lon,
          lat: point?.lat,
        },
      } satisfies Feature;
    }),
  };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(baseUrl);
  const url = absolute
    ? new URL(path.replace(/^\//, ""), `${baseUrl}/`)
    : new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, "http://same-origin.invalid");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  if (!absolute) return `${url.pathname}${url.search}`;
  return url.toString();
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorResponse;
    if (Array.isArray(body.message) && body.message.length > 0) return body.message.join(" ");
    if (typeof body.message === "string" && body.message.length > 0) return body.message;
  } catch {
    // Nest may return an empty body.
  }
  if (response.status === 401) return "Anmeldung erforderlich.";
  return `Anfrage fehlgeschlagen (${response.status}).`;
}

function parseHits(body: SearchResponse): SearchHit[] {
  if (!body || !Array.isArray(body.hits)) {
    throw new ApiError("Antwort von GET /search ist ungültig.", 502);
  }
  return body.hits.map((hit) => {
    if (!hit || typeof hit.id !== "string" || typeof hit.label !== "string" || !isGrain(hit.grain)) {
      throw new ApiError("Antwort von GET /search ist ungültig.", 502);
    }
    const coords = coordinatesOf(hit);
    const raw = hit as SearchHit & { level?: unknown; parentLabel?: unknown };
    return {
      id: hit.id,
      label: hit.label,
      grain: hit.grain,
      geoKey: typeof hit.geoKey === "string" ? hit.geoKey : null,
      lon: coords?.lon ?? null,
      lat: coords?.lat ?? null,
      level: catalogLevelOf(raw.level),
      parentLabel: catalogParentName(raw),
    };
  });
}

const REVENUE_DIRECTIONS = new Set<RevenueDirection>(["up", "down", "flat"]);
const CRITERION_DIRECTIONS = new Set<CriterionDirection>(["up", "down", "flat", "unknown"]);
const ANALYSIS_RUN_STATUSES = new Set<AnalysisRun["status"]>(["queued", "running", "completed", "failed"]);
const BRAIN_MODES = new Set<AnalysisBrain["mode"]>(["vector", "sql"]);
const BRAIN_REASONS = new Set<NonNullable<AnalysisBrain["vectorUnavailableReason"]>>([
  "embeddings_disabled",
  "embeddings_unconfigured",
  "embeddings_unreachable",
  "embeddings_rejected",
  "vector_query_failed",
  "no_embeddings_in_region",
  "features_unavailable",
]);
const PATTERN_SOURCES = new Set<AnalysisPattern["source"]>(["llm", "heuristic"]);
const PATTERN_LEVELS = new Set([
  "address",
  "grid100",
  "lor",
  "quartier",
  "ortsteil",
  "plz",
  "bezirk",
  "gemeinde",
  "kreis",
] as const);
const PATTERN_LEVEL_ROLES = new Set(["pattern", "frame"] as const);
const EVIDENCE_SCOPES = new Set(["local", "inherited"] as const);
const SERIES_BASELINES = new Set<string>(["per_1000_inhabitants", "per_km2", "per_household"]);
const BASELINE_METHODS = new Set<string>([
  "official",
  "official_zensus2022_grid",
  "estimate_lor_sum",
  "estimate_zensus2022_grid_sum",
  "estimate_address",
  "missing",
  "geom",
  "fixed_grid",
]);
const SERIES_GRANULARITIES = new Set<YearlySeries["granularity"]>(["year", "month"]);
const SERIES_COVERAGES = new Set<YearlySeries["coverage"]>(["none", "single", "multi", "series"]);
const SERIES_POINT_STATUSES = new Set<YearlySeries["points"][number]["status"]>(["present", "absent"]);

function parseAnalysisInput(body: AnalysisInput, route = "GET /analysis/input"): AnalysisInput {
  if (
    !body ||
    !body.region ||
    typeof body.region.label !== "string" ||
    typeof body.region.updatedAt !== "string" ||
    !Array.isArray(body.stores) ||
    !isRevenueDirection(body.revenueDirection) ||
    typeof body.capturedAt !== "string"
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  for (const store of body.stores) {
    if (
      !store ||
      typeof store.id !== "string" ||
      typeof store.street !== "string" ||
      typeof store.postalCode !== "string" ||
      typeof store.city !== "string" ||
      !Array.isArray(store.points) ||
      !Array.isArray(store.changes)
    ) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    for (const point of store.points) {
      if (
        !point ||
        typeof point.year !== "number" ||
        typeof point.month !== "number" ||
        !(point.revenueEur === null || typeof point.revenueEur === "number")
      ) {
        throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
      }
    }
  }
  if (body.regions !== undefined && !Array.isArray(body.regions)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  return {
    ...body,
    region: parseTargetRegion(body.region),
    ...(Array.isArray(body.regions) ? { regions: body.regions.map(parseTargetRegion) } : {}),
  };
}

const STUB_ANALYSIS_INPUT: AnalysisInput = {
  region: {
    label: "",
    grain: null,
    geoKey: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  stores: [],
  revenueDirection: "flat",
  capturedAt: "1970-01-01T00:00:00.000Z",
};

const STUB_ANALYSIS_BRAIN: AnalysisBrain = {
  mode: "sql",
  vectorUnavailableReason: null,
  factCount: 0,
  facts: [],
};

const STUB_ANALYSIS_PATTERN: AnalysisPattern = {
  source: "heuristic",
  summary: "",
  revenueDirection: "flat",
  criteria: [],
};

function parseAnalysisRun(body: AnalysisRun, options: { allowIncomplete?: boolean } = {}): AnalysisRun {
  const route = "/analysis/runs";
  if (!body || typeof body.id !== "string" || !ANALYSIS_RUN_STATUSES.has(body.status)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  const incompleteOk = Boolean(options.allowIncomplete) && body.status !== "completed";
  const createdAt =
    typeof body.createdAt === "string" ? body.createdAt : incompleteOk ? "1970-01-01T00:00:00.000Z" : null;
  if (!createdAt) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.failureReason != null && !isAnalysisRunFailureReason(body.failureReason)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.startedAt != null && typeof body.startedAt !== "string") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.completedAt != null && typeof body.completedAt !== "string") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.input) parseAnalysisInput(body.input, route);
  else if (!incompleteOk) throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  if (body.brain) parseAnalysisBrain(body.brain, route);
  else if (!incompleteOk) throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  if (body.pattern) parseAnalysisPattern(body.pattern, route);
  else if (!incompleteOk) throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  return {
    ...body,
    createdAt,
    input: body.input ?? STUB_ANALYSIS_INPUT,
    brain: body.brain ?? STUB_ANALYSIS_BRAIN,
    pattern: body.pattern ?? STUB_ANALYSIS_PATTERN,
  };
}

function parseAnalysisBrain(body: AnalysisBrain, route: string): AnalysisBrain {
  if (!body || !BRAIN_MODES.has(body.mode) || typeof body.factCount !== "number" || !Array.isArray(body.facts)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.vectorUnavailableReason != null && !BRAIN_REASONS.has(body.vectorUnavailableReason)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  return body;
}

function parseAnalysisPattern(body: AnalysisPattern, route: string): AnalysisPattern {
  if (
    !body ||
    !PATTERN_SOURCES.has(body.source) ||
    typeof body.summary !== "string" ||
    !isRevenueDirection(body.revenueDirection) ||
    !Array.isArray(body.criteria)
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  for (const criterion of body.criteria) {
    if (
      !criterion ||
      typeof criterion.key !== "string" ||
      typeof criterion.label !== "string" ||
      typeof criterion.evidence !== "string" ||
      !CRITERION_DIRECTIONS.has(criterion.direction)
    ) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    if (criterion.scope !== undefined && !EVIDENCE_SCOPES.has(criterion.scope)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    parseCriterionDatasetFields(criterion, route);
  }
  if (body.yearlySeries !== undefined) {
    if (!Array.isArray(body.yearlySeries)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    body.yearlySeries.forEach((item) => parseYearlySeries(item, route));
  }
  return body;
}

function parseYearlySeries(body: YearlySeries, route: string): YearlySeries {
  if (
    !body ||
    typeof body.metricId !== "string" ||
    !isSeriesLevel(body.requestedLevel) ||
    typeof body.requestedGeoKey !== "string" ||
    !isSeriesLevel(body.sourceLevel) ||
    typeof body.sourceGeoKey !== "string" ||
    !SERIES_GRANULARITIES.has(body.granularity) ||
    !SERIES_COVERAGES.has(body.coverage) ||
    !Array.isArray(body.points)
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  for (const point of body.points) {
    if (!point || typeof point.period !== "string" || !SERIES_POINT_STATUSES.has(point.status)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    if (point.status === "present" && typeof point.value !== "number") {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    if (point.normalizedValue !== undefined && typeof point.normalizedValue !== "number") {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    if (point.baselineMethod !== undefined && !BASELINE_METHODS.has(point.baselineMethod)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
  }
  return body;
}

function isSeriesLevel(value: unknown): value is YearlySeries["sourceLevel"] {
  return (
    isCatalogLevel(value) ||
    value === "kreis" ||
    value === "land" ||
    value === "grid100" ||
    value === "address" ||
    value === "lor" ||
    value === "quartier"
  );
}

function parseAnalysisPatternResponse(body: AnalysisPatternResponse): AnalysisPatternResponse {
  if (!body || typeof body.runId !== "string" || typeof body.createdAt !== "string") {
    throw new ApiError("Antwort von GET /analysis/pattern ist ungültig.", 502);
  }
  parseAnalysisPattern(body.pattern, "GET /analysis/pattern");
  const region = parseOptionalPatternRegion(body.region);
  return region ? { ...body, region } : { ...body, region: undefined };
}

/**
 * Planned Backend field on `GET /analysis/pattern?geoKey=`. A missing or
 * partial `region` is ignored so the client can still match via the run.
 */
function parseOptionalPatternRegion(value: unknown): AnalysisPatternRegion | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const raw = value as {
    label?: unknown;
    geoKey?: unknown;
    level?: unknown;
    parentLabel?: unknown;
    grain?: unknown;
  };
  if (typeof raw.label !== "string" || raw.label.trim().length === 0) return undefined;
  return {
    label: raw.label,
    geoKey: typeof raw.geoKey === "string" ? raw.geoKey : null,
    level: catalogLevelOf(raw.level),
    parentLabel: catalogParentName(raw),
    grain: isGrain(raw.grain) ? raw.grain : raw.grain === null ? null : undefined,
  };
}

function trimQueryValue(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const WINDOW_STAMP = /^[0-9]{4}(-[0-9]{2})?$/;
const AREA_KINDS = new Set([
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
] as const);
const EVIDENCE_KINDS = new Set(["trend", "stichtag", "absent"] as const);

function parseRecommendationSet(body: RecommendationSet): RecommendationSet {
  const route = "/recommendations";
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.runId !== "string" ||
    typeof body.createdAt !== "string" ||
    !body.window ||
    !WINDOW_STAMP.test(body.window.from) ||
    !WINDOW_STAMP.test(body.window.to) ||
    typeof body.count !== "number" ||
    !(body.reason === null || typeof body.reason === "string") ||
    !Array.isArray(body.items) ||
    body.items.length > 200 ||
    body.count !== body.items.length
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  parseAnalysisPattern(body.pattern, route);
  if (body.patternByLevel !== undefined) {
    if (!Array.isArray(body.patternByLevel)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    body.patternByLevel.forEach((profile) => parsePatternLevelProfile(profile, route));
  }
  if (body.patternByDataset !== undefined) {
    if (!Array.isArray(body.patternByDataset)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    body.patternByDataset.forEach((profile) => parsePatternDatasetProfile(profile, route));
  }
  if (body.targetRegions !== undefined) {
    if (!Array.isArray(body.targetRegions) || body.targetRegions.length > 200) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    for (const region of body.targetRegions) {
      if (!region || typeof region.geoKey !== "string") {
        throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
      }
    }
  }
  return {
    ...body,
    items: body.items.map((item) => parseRecommendation(item, route)),
  };
}

function parsePatternLevelProfile(body: PatternLevelProfile, route: string): void {
  if (
    !body ||
    !PATTERN_LEVELS.has(body.level) ||
    !PATTERN_LEVEL_ROLES.has(body.role) ||
    !Array.isArray(body.geoKeys) ||
    !Array.isArray(body.yearlySeries) ||
    !Array.isArray(body.criteria)
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.geoKeys.some((key) => typeof key !== "string")) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  body.yearlySeries.forEach((item) => parseYearlySeries(item, route));
  for (const criterion of body.criteria) {
    if (
      !criterion ||
      typeof criterion.key !== "string" ||
      typeof criterion.label !== "string" ||
      typeof criterion.evidence !== "string" ||
      !CRITERION_DIRECTIONS.has(criterion.direction)
    ) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    if (criterion.scope !== undefined && !EVIDENCE_SCOPES.has(criterion.scope)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    parseCriterionDatasetFields(criterion, route);
  }
}

function parsePatternDatasetProfile(body: PatternDatasetProfile, route: string): void {
  if (
    !body ||
    typeof body.metricId !== "string" ||
    !SERIES_BASELINES.has(body.baseline) ||
    !isSeriesLevel(body.sourceLevel) ||
    typeof body.sourceGeoKey !== "string" ||
    !body.yearlySeries ||
    !body.criterion
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  parseYearlySeries(body.yearlySeries, route);
  if (body.baselineMatch !== undefined && typeof body.baselineMatch !== "boolean") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  const criterion = body.criterion;
  if (
    !criterion ||
    typeof criterion.key !== "string" ||
    typeof criterion.label !== "string" ||
    typeof criterion.evidence !== "string" ||
    !CRITERION_DIRECTIONS.has(criterion.direction)
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  parseCriterionDatasetFields(criterion, route);
  if (body.baselineMethod !== undefined && !BASELINE_METHODS.has(body.baselineMethod)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
}

function recommendationDisplayName(body: Recommendation): string {
  if (typeof body.name === "string") return body.name;
  const fromLocation = body.location?.name;
  return typeof fromLocation === "string" ? fromLocation : "";
}

function parseRecommendation(body: Recommendation, route: string): Recommendation {
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.rank !== "number" ||
    body.rank < 1 ||
    body.rank > 200 ||
    typeof body.title !== "string" ||
    typeof body.score !== "number" ||
    typeof body.rationale !== "string" ||
    !PATTERN_SOURCES.has(body.source) ||
    !Array.isArray(body.criteriaEvidence) ||
    !body.location ||
    typeof body.location.geoKey !== "string" ||
    !isGrain(body.location.grain) ||
    !isNullableNumber(body.location.lon) ||
    !isNullableNumber(body.location.lat) ||
    !(body.location.name === null || typeof body.location.name === "string")
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.kind !== undefined && !AREA_KINDS.has(body.kind)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  for (const evidence of body.criteriaEvidence) parseRecommendationEvidence(evidence, route);
  if (body.geometry !== undefined && body.geometry !== null && !readRegionGeometry(body.geometry)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.geometryUnavailableReason != null && typeof body.geometryUnavailableReason !== "string") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.trend !== undefined) {
    if (
      !body.trend ||
      !CRITERION_DIRECTIONS.has(body.trend.direction) ||
      typeof body.trend.summary !== "string"
    ) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
  }
  if (body.grain !== undefined && !isGrain(body.grain)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.name != null && typeof body.name !== "string") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.parentLabel != null && typeof body.parentLabel !== "string") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.intersectionOf !== undefined) {
    if (!Array.isArray(body.intersectionOf)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    for (const part of body.intersectionOf) {
      if (
        !part ||
        typeof part.geoKey !== "string" ||
        !isGrain(part.grain) ||
        !(part.name === null || typeof part.name === "string") ||
        (part.datasetKey !== undefined && typeof part.datasetKey !== "string")
      ) {
        throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
      }
    }
  }
  if (body.overlaps !== undefined) {
    if (!Array.isArray(body.overlaps)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    for (const part of body.overlaps) {
      if (
        !part ||
        typeof part.geoKey !== "string" ||
        typeof part.label !== "string" ||
        !AREA_KINDS.has(part.kind) ||
        typeof part.share !== "number" ||
        part.share < 0 ||
        part.share > 1
      ) {
        throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
      }
    }
  }
  if (body.targetRegionGeoKey != null && typeof body.targetRegionGeoKey !== "string") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.dataAsOf != null && (typeof body.dataAsOf !== "string" || !WINDOW_STAMP.test(body.dataAsOf))) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  const rawLocation = body.location as Recommendation["location"] & { level?: unknown; parentLabel?: unknown };
  const parentLabel = catalogParentName(body) ?? catalogParentName(rawLocation);
  return {
    ...body,
    grain: body.grain ?? body.location.grain,
    name: recommendationDisplayName(body),
    parentLabel,
    targetRegionGeoKey: typeof body.targetRegionGeoKey === "string" ? body.targetRegionGeoKey : "",
    dataAsOf: body.dataAsOf === undefined ? undefined : body.dataAsOf,
    location: {
      ...body.location,
      level: catalogLevelOf(rawLocation.level),
      parentLabel,
    },
  };
}

function parseRecommendationEvidence(body: RecommendationEvidence, route: string): void {
  if (
    !body ||
    typeof body.key !== "string" ||
    typeof body.label !== "string" ||
    typeof body.evidence !== "string" ||
    !CRITERION_DIRECTIONS.has(body.direction) ||
    !CRITERION_DIRECTIONS.has(body.patternDirection)
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.baselineMatch !== undefined && typeof body.baselineMatch !== "boolean") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.coverage !== undefined && !SERIES_COVERAGES.has(body.coverage)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.scope !== undefined && !EVIDENCE_SCOPES.has(body.scope)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.kind !== undefined && !EVIDENCE_KINDS.has(body.kind)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.sourceLevel !== undefined && !isSeriesLevel(body.sourceLevel)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.points !== undefined) {
    if (!Array.isArray(body.points)) {
      throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
    }
    for (const point of body.points) {
      if (!point || typeof point.period !== "string" || !SERIES_POINT_STATUSES.has(point.status)) {
        throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
      }
      if (point.status === "present" && point.value !== undefined && typeof point.value !== "number") {
        throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
      }
      if (point.normalizedValue !== undefined && typeof point.normalizedValue !== "number") {
        throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
      }
    }
  }
  parseCriterionDatasetFields(body, route);
}

function parseCriterionDatasetFields(
  body: {
    metricId?: string;
    baseline?: string;
    rawValue?: number;
    normalizedValue?: number;
    baselineMethod?: string;
  },
  route: string,
): void {
  if (body.metricId !== undefined && typeof body.metricId !== "string") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.baseline !== undefined && !SERIES_BASELINES.has(body.baseline)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.rawValue !== undefined && typeof body.rawValue !== "number") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.normalizedValue !== undefined && typeof body.normalizedValue !== "number") {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  if (body.baselineMethod !== undefined && !BASELINE_METHODS.has(body.baselineMethod)) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isRevenueDirection(value: unknown): value is RevenueDirection {
  return typeof value === "string" && REVENUE_DIRECTIONS.has(value as RevenueDirection);
}

function parseLayer(body: ContractFeatureCollection): ContractFeatureCollection {
  if (!body || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new ApiError("Antwort von GET /layers/{id} ist ungültig.", 502);
  }
  return body;
}
