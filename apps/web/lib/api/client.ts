import type {
  AnalysisInput,
  AnalysisPatternResponse,
  AnalysisRun,
  Credentials,
  RecommendationCreate,
  RecommendationSet,
  FeatureCollection,
  HealthResponse,
  MonthlyRevenuePoint,
  MonthlyRevenuePointWrite,
  SearchResponse,
  StoreLocation,
  StoreLocationWrite,
  TargetRegion,
  TargetRegionWrite,
} from "@ruehrai/api-contracts";
import type { Session } from "./types";

/**
 * UI-facing client. Methods follow OpenAPI operationIds:
 * `getHealth`, `searchPlaces`, `getLayer`, `login`, `register`, `logout`,
 * `getTargetRegion`, `putTargetRegion`, `listStores`, `createStore`,
 * `updateStore`, `deleteStore`, `listStoreRevenue`, `putStoreRevenue`,
 * `getAnalysisInput`, `createAnalysisRun`, `getAnalysisRun`, `getAnalysisPattern`,
 * `getRecommendations`, `createRecommendations`.
 */
export interface RuehrApi {
  health(): Promise<HealthResponse>;
  search(query: string): Promise<SearchResponse>;
  getLayer(id: string): Promise<FeatureCollection>;
  login(body: Credentials): Promise<Session>;
  register(body: Credentials): Promise<Session>;
  logout(): Promise<void>;
  getTargetRegion(): Promise<TargetRegion | null>;
  putTargetRegion(body: TargetRegionWrite): Promise<TargetRegion>;
  listStores(): Promise<StoreLocation[]>;
  createStore(body: StoreLocationWrite): Promise<StoreLocation>;
  updateStore(id: string, body: StoreLocationWrite): Promise<StoreLocation>;
  deleteStore(id: string): Promise<void>;
  listStoreRevenue(id: string): Promise<MonthlyRevenuePoint[]>;
  putStoreRevenue(id: string, points: MonthlyRevenuePointWrite[]): Promise<MonthlyRevenuePoint[]>;
  getAnalysisInput(): Promise<AnalysisInput>;
  createAnalysisRun(): Promise<AnalysisRun>;
  getAnalysisRun(id: string): Promise<AnalysisRun>;
  getAnalysisPattern(): Promise<AnalysisPatternResponse | null>;
  getRecommendations(): Promise<RecommendationSet | null>;
  createRecommendations(body?: RecommendationCreate): Promise<RecommendationSet>;
}
