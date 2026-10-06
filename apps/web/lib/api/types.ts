import type {
  AnalysisPatternResponse as ContractAnalysisPatternResponse,
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

export type {
  AnalysisBrain,
  AnalysisInput,
  AnalysisPattern,
  AnalysisRun,
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
export type Recommendation = Omit<ContractRecommendation, "location"> & {
  location: RecommendationLocation;
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
 * this record from sessionStorage.
 */
export interface Session {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  email: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
