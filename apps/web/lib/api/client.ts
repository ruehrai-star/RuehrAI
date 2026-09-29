import type {
  Credentials,
  FeatureCollection,
  HealthResponse,
  SearchResponse,
} from "@ruehrai/api-contracts";
import type { Session } from "./types";

/**
 * UI-facing client. Methods follow OpenAPI operationIds:
 * `getHealth`, `searchPlaces`, `getLayer`, `login`, `register`.
 */
export interface RuehrApi {
  health(): Promise<HealthResponse>;
  search(query: string): Promise<SearchResponse>;
  getLayer(id: string): Promise<FeatureCollection>;
  login(body: Credentials): Promise<Session>;
  register(body: Credentials): Promise<Session>;
}
