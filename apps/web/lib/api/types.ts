import type { Grain } from "@ruehrai/api-contracts";

export type {
  Credentials,
  ErrorResponse,
  Feature,
  FeatureCollection,
  Grain,
  HealthResponse,
  SearchHit,
  SearchResponse,
  TokenResponse,
} from "@ruehrai/api-contracts";

/**
 * Browser session derived from `POST /auth/login` or `POST /auth/register`
 * (`TokenResponse`). Abmelden deletes this record from sessionStorage.
 * The contract has no logout route, so the JWT is only cleared locally.
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
