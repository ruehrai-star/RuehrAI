import type { Grain } from "@ruehrai/api-contracts";

export type {
  AnalysisBrain,
  AnalysisInput,
  AnalysisPattern,
  AnalysisPatternResponse,
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
  PatternCriterion,
  RevenueDirection,
  SearchHit,
  SearchResponse,
  StoreLocation,
  StoreLocationWrite,
  TargetRegion,
  TargetRegionWrite,
  TokenResponse,
} from "@ruehrai/api-contracts";

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
