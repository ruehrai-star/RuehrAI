import type {
  AnalysisInput,
  AnalysisRun,
  Credentials,
  RecommendationCreate,
  FeatureCollection,
  HealthResponse,
  MonthlyRevenuePoint,
  MonthlyRevenuePointWrite,
  StoreLocation,
  StoreLocationWrite,
  TargetRegionWrite,
} from "@ruehrai/api-contracts";
import type { AddressPairRequest, AddressPairResult } from "../addresses/types.ts";
import type {
  AnalysisPatternQuery,
  AnalysisPatternResponse,
  RecommendationSet,
  SearchResponse,
  Session,
  TargetRegion,
} from "./types";

/**
 * UI-facing client. Methods follow OpenAPI operationIds:
 * `getHealth`, `searchPlaces`, `getLayer`, `login`, `register`, `logout`,
 * `listTargetRegions`, `addTargetRegion`, `removeTargetRegion`, `clearTargetRegions`, `listStores`, `createStore`,
 * `updateStore`, `deleteStore`, `listStoreRevenue`, `putStoreRevenue`,
 * `getAnalysisInput`, `createAnalysisRun`, `getAnalysisRun`, `getAnalysisPattern`,
 * `getRecommendations`, `createRecommendations`, `evaluateAddressPair`.
 */
export interface RuehrApi {
  health(): Promise<HealthResponse>;
  search(query: string): Promise<SearchResponse>;
  getLayer(id: string): Promise<FeatureCollection>;
  login(body: Credentials): Promise<Session>;
  register(body: Credentials): Promise<Session>;
  logout(): Promise<void>;
  listTargetRegions(): Promise<TargetRegion[]>;
  addTargetRegion(body: TargetRegionWrite): Promise<TargetRegion>;
  removeTargetRegion(geoKey: string): Promise<void>;
  clearTargetRegions(): Promise<void>;
  listStores(): Promise<StoreLocation[]>;
  createStore(body: StoreLocationWrite): Promise<StoreLocation>;
  updateStore(id: string, body: StoreLocationWrite): Promise<StoreLocation>;
  deleteStore(id: string): Promise<void>;
  listStoreRevenue(id: string): Promise<MonthlyRevenuePoint[]>;
  putStoreRevenue(id: string, points: MonthlyRevenuePointWrite[]): Promise<MonthlyRevenuePoint[]>;
  getAnalysisInput(): Promise<AnalysisInput>;
  createAnalysisRun(): Promise<AnalysisRun>;
  getAnalysisRun(id: string): Promise<AnalysisRun>;
  getAnalysisPattern(query?: AnalysisPatternQuery): Promise<AnalysisPatternResponse | null>;
  getRecommendations(): Promise<RecommendationSet | null>;
  createRecommendations(body?: RecommendationCreate): Promise<RecommendationSet>;
  evaluateAddressPair(body: AddressPairRequest): Promise<AddressPairResult>;
}
