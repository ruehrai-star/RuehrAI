import type { Feature, FeatureCollection, Geometry } from "geojson";
import type {
  Credentials,
  ErrorResponse,
  FeatureCollection as ContractFeatureCollection,
  HealthResponse,
  MonthlyRevenuePoint,
  MonthlyRevenuePointWrite,
  MonthlyRevenueSeries,
  SearchHit,
  SearchResponse,
  StoreList,
  StoreLocation,
  StoreLocationWrite,
  TargetRegion,
  TargetRegionWrite,
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
    init: {
      method?: string;
      body?: string;
      query?: Record<string, string | undefined>;
      auth?: boolean;
      empty?: boolean;
      nullOn404?: boolean;
    },
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

    if (init.nullOn404 && response.status === 404) {
      return null as T;
    }
    if (!response.ok) {
      throw new ApiError(await readErrorMessage(response), response.status);
    }
    if (init.empty || response.status === 204) {
      return undefined as T;
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

    async logout(): Promise<void> {
      await request<void>("/auth/logout", { method: "POST", auth: true, empty: true });
    },

    async getTargetRegion(): Promise<TargetRegion | null> {
      const body = await request<TargetRegion | null>("/target-region", { auth: true, nullOn404: true });
      return body ? parseTargetRegion(body) : null;
    },

    async putTargetRegion(region: TargetRegionWrite): Promise<TargetRegion> {
      const body = await request<TargetRegion>("/target-region", {
        method: "PUT",
        auth: true,
        body: JSON.stringify(region),
      });
      return parseTargetRegion(body);
    },

    async listStores(): Promise<StoreLocation[]> {
      const body = await request<StoreList>("/stores", { auth: true });
      if (!body || !Array.isArray(body.stores)) {
        throw new ApiError("Antwort von GET /stores ist ungültig.", 502);
      }
      return body.stores.map(parseStore);
    },

    async createStore(store: StoreLocationWrite): Promise<StoreLocation> {
      const body = await request<StoreLocation>("/stores", {
        method: "POST",
        auth: true,
        body: JSON.stringify(store),
      });
      return parseStore(body);
    },

    async updateStore(id: string, store: StoreLocationWrite): Promise<StoreLocation> {
      const body = await request<StoreLocation>(`/stores/${encodeURIComponent(id)}`, {
        method: "PUT",
        auth: true,
        body: JSON.stringify(store),
      });
      return parseStore(body);
    },

    async deleteStore(id: string): Promise<void> {
      await request<void>(`/stores/${encodeURIComponent(id)}`, { method: "DELETE", auth: true, empty: true });
    },

    async listStoreRevenue(id: string): Promise<MonthlyRevenuePoint[]> {
      const body = await request<MonthlyRevenueSeries>(`/stores/${encodeURIComponent(id)}/revenue`, {
        auth: true,
      });
      return parseRevenueSeries(body);
    },

    async putStoreRevenue(id: string, points: MonthlyRevenuePointWrite[]): Promise<MonthlyRevenuePoint[]> {
      const body = await request<MonthlyRevenueSeries>(`/stores/${encodeURIComponent(id)}/revenue`, {
        method: "PUT",
        auth: true,
        body: JSON.stringify({ points }),
      });
      return parseRevenueSeries(body);
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

function parseTargetRegion(body: TargetRegion): TargetRegion {
  if (!body || typeof body.label !== "string" || typeof body.updatedAt !== "string") {
    throw new ApiError("Antwort von /target-region ist ungültig.", 502);
  }
  if (body.grain != null && !isGrain(body.grain)) {
    throw new ApiError("Antwort von /target-region ist ungültig.", 502);
  }
  return body;
}

function parseStore(body: StoreLocation): StoreLocation {
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.street !== "string" ||
    typeof body.postalCode !== "string" ||
    typeof body.city !== "string"
  ) {
    throw new ApiError("Antwort von /stores ist ungültig.", 502);
  }
  return body;
}

function parseRevenueSeries(body: MonthlyRevenueSeries): MonthlyRevenuePoint[] {
  if (!body || !Array.isArray(body.points)) {
    throw new ApiError("Antwort von /stores/{id}/revenue ist ungültig.", 502);
  }
  return body.points.map((point) => {
    if (
      !point ||
      typeof point.year !== "number" ||
      typeof point.month !== "number" ||
      !(point.revenueEur === null || typeof point.revenueEur === "number")
    ) {
      throw new ApiError("Antwort von /stores/{id}/revenue ist ungültig.", 502);
    }
    return point;
  });
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
