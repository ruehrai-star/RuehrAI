import { createMockApi } from "./mock";
import type { RuehrApi } from "./types";

/**
 * Swap point for the generated OpenAPI client.
 *
 * `NEXT_PUBLIC_API_MODE=mock` (default) uses {@link createMockApi}.
 * A future `openapi` mode should wrap `packages/api-contracts` here and
 * still return a {@link RuehrApi}.
 */
export function createRuehrApi(): RuehrApi {
  const mode = process.env.NEXT_PUBLIC_API_MODE ?? "mock";
  if (mode === "mock") {
    return createMockApi();
  }
  throw new Error(
    `NEXT_PUBLIC_API_MODE=${mode} is not wired yet. Adapt the OpenAPI client in lib/api/index.ts.`,
  );
}

let singleton: RuehrApi | null = null;

export function getApi(): RuehrApi {
  if (!singleton) {
    singleton = createRuehrApi();
  }
  return singleton;
}

export type {
  RuehrApi,
  SearchHit,
  Session,
  Grain,
  LoginRequest,
  HealthResponse,
  SearchResponse,
} from "./types";
export { ApiError, isGrain } from "./types";
