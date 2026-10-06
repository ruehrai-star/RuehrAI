import type {
  AnalysisPatternResponse as ContractAnalysisPatternResponse,
  AnalysisRun,
  Grain,
  Recommendation as ContractRecommendation,
  RecommendationLocation as ContractRecommendationLocation,
  RecommendationSet as ContractRecommendationSet,
  SearchHit as ContractSearchHit,
  SearchResponse as ContractSearchResponse,
  TargetRegion as ContractTargetRegion,
} from "@ruehrai/api-contracts";

/** Catalog `level` on a search / Zielregion hit. Named by the Product-Owner. */
export const CATALOG_LEVELS = ["plz", "bezirk", "stadtbezirk", "stadtteil", "ortsteil", "gemeinde"] as const;
export type CatalogLevel = (typeof CATALOG_LEVELS)[number];

/** OpenAPI `AnalysisRunFailureReason`. No local shadow enum. */
export type AnalysisRunFailureReason = NonNullable<AnalysisRun["failureReason"]>;

export type {
  AnalysisBrain,
  AnalysisInput,
  AnalysisPattern,
  AnalysisRun,
  AnalysisRunStatus,
  Credentials,
  CriterionDirection,
  ErrorResponse,
  Feature,
  FeatureCollection,
  Grain,
  HealthResponse,
  MonthlyRevenuePoint,
  MonthlyRevenuePointWrite,
  AreaKind,
  BaselineMethod,
  EvidenceKind,
  EvidenceScope,
  PatternCriterion,
  PatternLevel,
  PatternLevelProfile,
  PatternLevelRole,
  PatternDatasetProfile,
  SeriesBaseline,
  RecommendationCreate,
  RecommendationEvidence,
  RecommendationIntersectionPart,
  RecommendationOverlap,
  RecommendationTrend,
  RecommendationWindow,
  RegionGeometry,
  RevenueDirection,
  LonLatBounds,
  SeriesCoverage,
  SeriesGranularity,
  SeriesLevel,
  SeriesPoint,
  SeriesPointStatus,
  StoreLocation,
  StoreLocationWrite,
  TargetRegionList,
  TargetRegionWrite,
  TokenResponse,
  YearlySeries,
} from "@ruehrai/api-contracts";

/** Catalog `level` follows OpenAPI `CatalogLevel` when the backend sends it. */
export type SearchHit = ContractSearchHit & {
  level?: CatalogLevel | null;
  parentLabel?: string | null;
};
export type SearchResponse = Omit<ContractSearchResponse, "hits"> & { hits: SearchHit[] };
export type TargetRegion = ContractTargetRegion & {
  level?: CatalogLevel | null;
  parentLabel?: string | null;
};
export type RecommendationLocation = ContractRecommendationLocation & {
  level?: CatalogLevel | null;
  parentLabel?: string | null;
};

/**
 * OpenAPI 0.19.2 item fields. `targetRegionGeoKey` is required on new sets;
 * older stored rows hydrate to `""`. `dataAsOf` is year/month or null.
 */
export type RecommendationV192Fields = {
  targetRegionGeoKey: string;
  dataAsOf?: string | null;
};

/**
 * OpenAPI 0.19.6 additive nAktiv on `items[]`. Always set on new sets
 * (including `0`); omitted on older stored rows. Bind the muted nAktiv-0
 * card to `localDatasetCount === 0`. The card hint is `INACTIVE_HIT_COPY`
 * („Für diese Fläche liegen keine eigenen Verlaufsdaten vor. Die
 * Einordnung beruht auf übergeordneten Werten.“). Fall back to the
 * evidence heuristic only when the field is missing.
 */
export type RecommendationV196Fields = {
  localDatasetCount?: number;
};

export type Recommendation = Omit<ContractRecommendation, "location"> & {
  location: RecommendationLocation;
};

/** Snapshot of keys actually used as `items[].targetRegionGeoKey`. */
export type RecommendationTargetRegionRef = {
  geoKey: string;
  label?: string;
};

export type RecommendationSet = Omit<ContractRecommendationSet, "items"> & {
  items: Recommendation[];
};

/**
 * Query for `GET /analysis/pattern`. `geoKey` is the marked Zielregion.
 * Omit it to keep the latest-pattern behaviour.
 */
export interface AnalysisPatternQuery {
  geoKey?: string | null;
}

/** Query for `GET /recommendations`. `runId` selects a stored set; omit for latest. */
export interface RecommendationQuery {
  runId?: string | null;
}

/**
 * Region stamp on a pattern response. Matches OpenAPI `AnalysisPatternRegion`
 * (`geoKey` is required and nullable). `region` itself stays optional so older
 * payloads without it still parse.
 */
export interface AnalysisPatternRegion {
  label: string;
  geoKey: string | null;
  level?: CatalogLevel | null;
  parentLabel?: string | null;
  grain?: Grain | null;
}

export type AnalysisPatternResponse = Omit<ContractAnalysisPatternResponse, "region"> & {
  region?: AnalysisPatternRegion | null;
};

/**
 * Browser session derived from `POST /auth/login` or `POST /auth/register`
 * (`TokenResponse`). Abmelden calls `POST /auth/logout` and then deletes
 * this record from localStorage.
 */
export interface Session {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  email: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    const trimmed = typeof code === "string" ? code.trim() : "";
    if (trimmed) this.code = trimmed;
  }
}

/**
 * Thrown only when `fetch` itself fails (offline, DNS, CORS, connection reset).
 * Parse and render TypeErrors must not use this class.
 */
export class NetworkError extends ApiError {
  constructor(message: string) {
    super(message, 0);
    this.name = "NetworkError";
  }
}

const GRAINS = new Set<Grain>([
  "address",
  "grid100",
  "plz8",
  "plz5",
  "ags",
  "ags5",
  "other",
]);

export function isGrain(value: unknown): value is Grain {
  return typeof value === "string" && GRAINS.has(value as Grain);
}

export function isCatalogLevel(value: unknown): value is CatalogLevel {
  return typeof value === "string" && (CATALOG_LEVELS as readonly string[]).includes(value);
}
