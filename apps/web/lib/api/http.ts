import type { Feature, FeatureCollection, Geometry } from "geojson";
import type {
  Credentials,
  ErrorResponse,
  FeatureCollection as ContractFeatureCollection,
  HealthResponse,
  SearchHit,
  SearchResponse,
  TokenResponse,
} from "@ruehrai/api-contracts";
import { coordinatesOf, pointFromGeometry } from "./geo.ts";
import type { RuehrApi } from "./client";
import { ApiError, isGrain, type Session } from "./types.ts";

export const DEFAULT_API_BASE_URL = "http://localhost:3000";

export interface HttpApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  getAccessToken?: () => string | null;
}

export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, "");
}

export function createHttpApi(options: HttpApiOptions = {}): RuehrApi {
  const baseUrl = (options.baseUrl ?? apiBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const getAccessToken = options.getAccessToken ?? (() => null);

  async function request<T>(
    path: string,
    init: { method?: string; body?: string; query?: Record<string, string | undefined>; auth?: boolean },
  ): Promise<T> {
    const headers = new Headers();
    if (init.body) headers.set("Content-Type", "application/json");
    if (init.auth) {
      const token = getAccessToken();
      if (!token) throw new ApiError("Anmeldung erforderlich.", 401);
      headers.set("Authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, init.query), {
        method: init.method ?? "GET",
        headers,
        body: init.body,
      });
    } catch {
      throw new ApiError(`Backend nicht erreichbar (${baseUrl}).`, 0);
    }

    if (!response.ok) {
      throw new ApiError(await readErrorMessage(response), response.status);
    }
    return (await response.json()) as T;
  }

  return {
    health(): Promise<HealthResponse> {
      return request<HealthResponse>("/health", {});
    },

    async search(query: string): Promise<SearchResponse> {
      const body = await request<SearchResponse>("/search", {
        auth: true,
        query: { q: query },
      });
      return { hits: parseHits(body) };
    },

    async getLayer(id: string): Promise<ContractFeatureCollection> {
      const body = await request<ContractFeatureCollection>(`/layers/${encodeURIComponent(id)}`, {
        auth: true,
      });
      return parseLayer(body);
    },

    login(credentials: Credentials): Promise<Session> {
      return sessionFromToken("/auth/login", credentials, () =>
        request<TokenResponse>("/auth/login", {
          method: "POST",
          body: JSON.stringify(credentials),
        }),
      );
    },

    register(credentials: Credentials): Promise<Session> {
      return sessionFromToken("/auth/register", credentials, () =>
        request<TokenResponse>("/auth/register", {
          method: "POST",
          body: JSON.stringify(credentials),
        }),
      );
    },
  };
}

async function sessionFromToken(
  route: string,
  credentials: Credentials,
  read: () => Promise<TokenResponse>,
): Promise<Session> {
  const token = await read();
  if (
    typeof token?.accessToken !== "string" ||
    token.tokenType !== "Bearer" ||
    typeof token.expiresIn !== "number"
  ) {
    throw new ApiError(`Antwort von ${route} ist ungültig.`, 502);
  }
  return {
    accessToken: token.accessToken,
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    email: credentials.email.trim().toLowerCase(),
  };
}

export function toMapFeatureCollection(layer: ContractFeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: layer.features.map((feature) => {
      const geometry = feature.geometry as Geometry;
      const point = pointFromGeometry(feature.geometry);
      const label = typeof feature.properties.label === "string" ? feature.properties.label : feature.id;
      return {
        type: "Feature",
        id: feature.id,
        geometry,
        properties: {
          ...feature.properties,
          id: feature.id,
          label,
          lon: point?.lon,
          lat: point?.lat,
        },
      } satisfies Feature;
    }),
  };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path.replace(/^\//, ""), `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorResponse;
    if (Array.isArray(body.message) && body.message.length > 0) return body.message.join(" ");
    if (typeof body.message === "string" && body.message.length > 0) return body.message;
  } catch {
    // Nest may return an empty body.
  }
  if (response.status === 401) return "Anmeldung erforderlich.";
  return `Anfrage fehlgeschlagen (${response.status}).`;
}

function parseHits(body: SearchResponse): SearchHit[] {
  if (!body || !Array.isArray(body.hits)) {
    throw new ApiError("Antwort von GET /search ist ungültig.", 502);
  }
  return body.hits.map((hit) => {
    if (!hit || typeof hit.id !== "string" || typeof hit.label !== "string" || !isGrain(hit.grain)) {
      throw new ApiError("Antwort von GET /search ist ungültig.", 502);
    }
    const coords = coordinatesOf(hit);
    return {
      id: hit.id,
      label: hit.label,
      grain: hit.grain,
      geoKey: typeof hit.geoKey === "string" ? hit.geoKey : null,
      lon: coords?.lon ?? null,
      lat: coords?.lat ?? null,
    };
  });
}

function parseLayer(body: ContractFeatureCollection): ContractFeatureCollection {
  if (!body || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new ApiError("Antwort von GET /layers/{id} ist ungültig.", 502);
  }
  return body;
}
