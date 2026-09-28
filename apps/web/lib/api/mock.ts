import type { FeatureCollection } from "geojson";
import { GRID_LAYER_ID, gridLayer, searchCatalog } from "./catalog";
import {
  ApiError,
  type HealthResponse,
  type LoginRequest,
  type RuehrApi,
  type SearchResponse,
  type Session,
} from "./types";

const LATENCY_MS = 120;

function delay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, LATENCY_MS);
  });
}

function base64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

/**
 * Looks like a JWT so the shell can render a Backend session.
 * `alg: none` and the `mock` signature mark it as a non-credential.
 */
function stubToken(email: string, expiresAt: string): string {
  const header = base64Url({ alg: "none", typ: "JWT" });
  const payload = base64Url({
    sub: email,
    iss: "ruehrai-backend-mock",
    exp: expiresAt,
  });
  return `${header}.${payload}.mock`;
}

function cloneLayer(layer: FeatureCollection): FeatureCollection {
  return structuredClone(layer);
}

/** In-process implementation of the v0 routes. No network, no Supabase. */
export function createMockApi(): RuehrApi {
  return {
    async health(): Promise<HealthResponse> {
      await delay();
      return { status: "ok" };
    },

    async search(query: string): Promise<SearchResponse> {
      await delay();
      const trimmed = query.trim();
      return { query: trimmed, results: searchCatalog(trimmed) };
    },

    async getLayer(id: string): Promise<FeatureCollection> {
      await delay();
      if (id !== GRID_LAYER_ID) {
        throw new ApiError(`Layer „${id}“ wurde nicht gefunden.`, 404);
      }
      return cloneLayer(gridLayer());
    },

    async login(body: LoginRequest): Promise<Session> {
      await delay();
      const email = body.email.trim();
      if (!email || !body.password) {
        throw new ApiError("E-Mail und Passwort werden benötigt.", 400);
      }
      if (!email.includes("@")) {
        throw new ApiError("E-Mail muss ein @ enthalten.", 400);
      }
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      return {
        token: stubToken(email, expiresAt),
        tokenType: "Bearer",
        expiresAt,
        email,
      };
    },

    async logout(): Promise<void> {
      await delay();
    },
  };
}
