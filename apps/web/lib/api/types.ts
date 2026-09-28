import type { FeatureCollection } from "geojson";

/**
 * Browser-side stand-in for the Backend OpenAPI v0 contract.
 * UI code depends only on {@link RuehrApi}. When `packages/api-contracts`
 * publishes a generated client, adapt it inside `createRuehrApi` — do not
 * call fetch from components.
 *
 *   GET  /health
 *   GET  /search?q=
 *   GET  /layers/{id}
 *   POST /auth/login
 *   POST /auth/logout
 */

export type Grain =
  | "address"
  | "grid100"
  | "plz8"
  | "plz5"
  | "ags"
  | "other";

/** One hit from `GET /search`. */
export interface SearchHit {
  id: string;
  label: string;
  grain: Grain;
  lon?: number;
  lat?: number;
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
}

export interface HealthResponse {
  status: "ok" | "degraded";
}

/** Body for `POST /auth/login`. The backend owns the real session. */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Unsigned placeholder for a Backend JWT session.
 * `token` is not a credential and must not be sent anywhere except this mock.
 */
export interface Session {
  token: string;
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

export interface RuehrApi {
  health(): Promise<HealthResponse>;
  search(query: string): Promise<SearchResponse>;
  getLayer(id: string): Promise<FeatureCollection>;
  login(body: LoginRequest): Promise<Session>;
  logout(): Promise<void>;
}

export function isGrain(value: unknown): value is Grain {
  return (
    value === "address" ||
    value === "grid100" ||
    value === "plz8" ||
    value === "plz5" ||
    value === "ags" ||
    value === "other"
  );
}
