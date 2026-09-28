import { createHttpApi } from "./http";
import { readStoredSession } from "../session-storage";
import type { RuehrApi } from "./client";

export const DEFAULT_LAYER_ID = "demo-gemeinden";

/**
 * HTTP client for the Backend described by `@ruehrai/api-contracts`.
 * Base URL: `NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:3000`.
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
  Credentials,
  FeatureCollection,
  Grain,
  HealthResponse,
  SearchHit,
  SearchResponse,
  Session,
} from "./types";
export { ApiError, isGrain } from "./types";
export { coordinatesOf } from "./geo";
export { toMapFeatureCollection } from "./http";
