import { createHttpApi } from "./http";
import { readStoredSession } from "../session-storage";
import type { RuehrApi } from "./client";

export const DEFAULT_LAYER_ID = "demo-gemeinden";

/**
 * HTTP client for the Backend described by `@ruehrai/api-contracts`.
 * Base URL: `NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:3000`.
 * A relative value such as `/api` stays on the page origin.
 */
export function createRuehrApi(): RuehrApi {
  return createHttpApi({
    getAccessToken: () => readStoredSession()?.accessToken ?? null,
  });
}

let singleton: RuehrApi | null = null;

export function getApi(): RuehrApi {
  if (!singleton) singleton = createRuehrApi();
  return singleton;
}

export type { RuehrApi } from "./client";
export type {
  CatalogLevel,
  AnalysisBrain,
  AnalysisInput,
  AnalysisPattern,
  AnalysisPatternQuery,
  AnalysisPatternRegion,
  AnalysisPatternResponse,
  AnalysisRun,
  Credentials,
  CriterionDirection,
  FeatureCollection,
  Grain,
  HealthResponse,
  MonthlyRevenuePoint,
  MonthlyRevenuePointWrite,
  LonLatBounds,
  PatternCriterion,
  PatternLevel,
  PatternLevelProfile,
  PatternLevelRole,
  PatternDatasetProfile,
  SeriesBaseline,
  Recommendation,
  RecommendationCreate,
  RecommendationEvidence,
  RecommendationLocation,
  RecommendationSet,
  RecommendationTrend,
  RecommendationWindow,
  RegionGeometry,
  RevenueDirection,
  SearchHit,
  SearchResponse,
  Session,
  StoreLocation,
  StoreLocationWrite,
  TargetRegion,
  TargetRegionList,
  TargetRegionWrite,
  YearlySeries,
} from "./types";
export type {
  AddressInput,
  AddressPairRequest,
  AddressPairResult,
  AddressSide,
  AddressTopic,
  SharedTopic,
} from "../addresses/types";
export { ApiError, CATALOG_LEVELS, isCatalogLevel, isGrain } from "./types";
export { coordinatesOf } from "./geo";
export { toMapFeatureCollection } from "./http";
