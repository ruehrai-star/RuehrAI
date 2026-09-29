import type {
  Credentials,
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
 * `updateStore`, `deleteStore`, `listStoreRevenue`, `putStoreRevenue`.
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
}
