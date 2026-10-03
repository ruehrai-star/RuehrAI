import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildKarte } from "../map/karte.ts";
import { apiBaseUrl, createHttpApi, DEFAULT_API_BASE_URL, toMapFeatureCollection } from "./http.ts";
import { ApiError } from "./types.ts";

function withPublicApiBase<T>(value: string | undefined, run: () => T): T {
  const key = "NEXT_PUBLIC_API_BASE_URL";
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test("api base URL defaults to the Backend local port and strips a trailing slash", () => {
  withPublicApiBase(undefined, () => {
    assert.equal(apiBaseUrl(), DEFAULT_API_BASE_URL);
  });
  withPublicApiBase("http://localhost:3000/", () => {
    assert.equal(apiBaseUrl(), "http://localhost:3000");
  });
});

test("NEXT_PUBLIC_API_BASE_URL is read as a static process.env member", () => {
  const source = readFileSync(new URL("./http.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function apiBaseUrl");
  const end = source.indexOf("export function createHttpApi");
  assert.ok(start >= 0 && end > start);
  const fn = source.slice(start, end);
  assert.match(fn, /export function apiBaseUrl\(\): string/);
  assert.match(fn, /process\.env\.NEXT_PUBLIC_API_BASE_URL/);
  const withoutStaticAccess = fn.replaceAll("process.env.NEXT_PUBLIC_API_BASE_URL", "");
  assert.equal(withoutStaticAccess.includes("NEXT_PUBLIC_API_BASE_URL"), false);
});

test("createHttpApi uses the public base when no baseUrl is passed", async () => {
  const seen: string[] = [];
  const api = withPublicApiBase("/api", () =>
    createHttpApi({
      fetch: async (input) => {
        seen.push(String(input));
        return jsonResponse({ status: "ok" });
      },
    }),
  );
  await api.health();
  assert.equal(seen[0], "/api/health");
});

test("a same-origin STAGE base stays a relative /api path", async () => {
  withPublicApiBase("/api/", () => {
    assert.equal(apiBaseUrl(), "/api");
  });
  withPublicApiBase("", () => {
    assert.equal(apiBaseUrl(), "");
  });
  const seen: string[] = [];
  const api = createHttpApi({
    baseUrl: "/api",
    getAccessToken: () => "jwt-1",
    fetch: async (input) => {
      seen.push(String(input));
      return jsonResponse({ id: "1", runId: "2", createdAt: "2026-09-29T12:00:00.000Z", window: { from: "2026-04", to: "2026-09" }, count: 0, reason: null, pattern: { source: "heuristic", summary: "Kurz", revenueDirection: "flat", criteria: [] }, items: [] });
    },
  });
  await api.getRecommendations();
  assert.equal(seen[0], "/api/recommendations");
});

test("GET /search sends q and the bearer token", async () => {
  const seen: { url?: string; authorization?: string } = {};
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (input, init) => {
      seen.url = String(input);
      seen.authorization = new Headers(init?.headers).get("authorization") ?? undefined;
      return jsonResponse({
        hits: [
          { id: "ags:09162000", label: "München", grain: "ags", geoKey: "09162000", lon: 11.5, lat: 48.1 },
        ],
      });
    },
  });

  const result = await api.search("München");
  assert.equal(seen.url, "http://backend.test/search?q=M%C3%BCnchen");
  assert.equal(seen.authorization, "Bearer jwt-1");
  assert.equal(result.hits[0]?.label, "München");
  assert.equal(result.hits[0]?.lon, 11.5);
});

test("GET /search keeps level and parentLabel and does not invent a parent name", async () => {
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      jsonResponse({
        hits: [
          {
            id: "ot:plagwitz",
            label: "Plagwitz",
            grain: "ags",
            geoKey: "14713000",
            lon: 12.33,
            lat: 51.33,
            level: "ortsteil",
            parentLabel: "Leipzig",
            parentName: "ignored",
            municipalityName: "Leipzig",
          },
        ],
      }),
  });

  const hit = (await api.search("Plagwitz")).hits[0];
  assert.equal(hit?.label, "Plagwitz");
  assert.equal(hit?.level, "ortsteil");
  assert.equal(hit?.parentLabel, "Leipzig");
  assert.equal("parentName" in (hit ?? {}), false);
  assert.equal("municipalityName" in (hit ?? {}), false);
});

test("GET /search keeps the catalog id on a named hit", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      jsonResponse({
        hits: [
          {
            id: "plz5:12247",
            label: "12247",
            grain: "plz5",
            geoKey: "12247",
            level: "plz",
            parentLabel: "Berlin",
          },
          {
            id: "ortsteil:osm:5712247",
            label: "Lankwitz",
            grain: "other",
            geoKey: "ortsteil:osm:5712247",
            level: "ortsteil",
            parentLabel: "Berlin",
          },
        ],
      }),
  });
  const hits = (await api.search("12247")).hits;
  assert.equal(hits[0]?.id, "plz5:12247");
  assert.equal(hits[0]?.label, "12247");
  assert.equal(hits[1]?.id, "ortsteil:osm:5712247");
  assert.equal(hits[1]?.label, "Lankwitz");
});

test("GET /search drops a blank parentLabel", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      jsonResponse({
        hits: [{ id: "ags:09162000", label: "München", grain: "ags", geoKey: "09162000", parentLabel: "  " }],
      }),
  });
  assert.equal((await api.search("München")).hits[0]?.parentLabel, null);
});

test("GET /search ignores an unknown level", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      jsonResponse({
        hits: [{ id: "ags:09162000", label: "München", grain: "ags", geoKey: "09162000", level: "quartier" }],
      }),
  });
  assert.equal((await api.search("München")).hits[0]?.level, null);
});

test("protected calls fail before fetch when no token is stored", async () => {
  let called = false;
  const api = createHttpApi({
    fetch: async () => {
      called = true;
      return jsonResponse({});
    },
  });
  await assert.rejects(api.search("Berlin"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(called, false);
});

test("GET /layers/{id} keeps the contract collection and adds a map centroid", async () => {
  const api = createHttpApi({
    baseUrl: "http://backend.test/",
    getAccessToken: () => "jwt-1",
    fetch: async (input) => {
      assert.equal(String(input), "http://backend.test/layers/demo-gemeinden");
      return jsonResponse({
        type: "FeatureCollection",
        name: "Demo-Gemeinden",
        features: [
          {
            type: "Feature",
            id: "ags:09162000",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [11, 48],
                  [12, 48],
                  [12, 49],
                  [11, 49],
                  [11, 48],
                ],
              ],
            },
            properties: { label: "München", grain: "ags" },
          },
        ],
      });
    },
  });

  const layer = await api.getLayer("demo-gemeinden");
  assert.equal(layer.name, "Demo-Gemeinden");
  const mapLayer = toMapFeatureCollection(layer);
  assert.equal(mapLayer.features[0]?.properties?.lon, 11.5);
  assert.equal(mapLayer.features[0]?.properties?.lat, 48.5);
});

test("POST /auth/register maps 201 TokenResponse and does not send a bearer token", async () => {
  const seen: { url?: string; method?: string; authorization?: string | null; body?: unknown } = {};
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "should-not-be-sent",
    fetch: async (input, init) => {
      seen.url = String(input);
      seen.method = init?.method;
      seen.authorization = new Headers(init?.headers).get("authorization");
      seen.body = JSON.parse(String(init?.body));
      return jsonResponse({ accessToken: "new-jwt", tokenType: "Bearer", expiresIn: 28800 }, 201);
    },
  });

  const session = await api.register({ email: "  Neu@Kunde.example ", password: "secret-pass" });
  assert.equal(seen.url, "http://backend.test/auth/register");
  assert.equal(seen.method, "POST");
  assert.equal(seen.authorization, null);
  assert.deepEqual(seen.body, { email: "  Neu@Kunde.example ", password: "secret-pass" });
  assert.equal(session.accessToken, "new-jwt");
  assert.equal(session.email, "neu@kunde.example");
  assert.equal(session.tokenType, "Bearer");
});

test("POST /auth/register reports a duplicate email", async () => {
  const api = createHttpApi({
    fetch: async () => jsonResponse({ statusCode: 409, message: "Email already registered" }, 409),
  });
  await assert.rejects(api.register({ email: "dev@ruehrai.local", password: "dev-password" }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.message, "Email already registered");
    return true;
  });
});

test("POST /auth/login maps TokenResponse into a session", async () => {
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    fetch: async (input, init) => {
      assert.equal(String(input), "http://backend.test/auth/login");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        email: "dev@ruehrai.local",
        password: "dev-password",
      });
      return jsonResponse({ accessToken: "signed-jwt", tokenType: "Bearer", expiresIn: 3600 });
    },
  });

  const session = await api.login({ email: "dev@ruehrai.local", password: "dev-password" });
  assert.equal(session.accessToken, "signed-jwt");
  assert.equal(session.tokenType, "Bearer");
  assert.equal(session.email, "dev@ruehrai.local");
  assert.ok(Number.isFinite(Date.parse(session.expiresAt)));
});

test("error JSON from the Backend becomes ApiError", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      jsonResponse({ statusCode: 404, message: "Layer not found", error: "Not Found" }, 404),
  });
  await assert.rejects(api.getLayer("missing"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.message, "Layer not found");
    return true;
  });
});

test("POST /auth/logout revokes the bearer token and accepts an empty body", async () => {
  const seen: { url?: string; method?: string; authorization?: string | null } = {};
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (input, init) => {
      seen.url = String(input);
      seen.method = init?.method;
      seen.authorization = new Headers(init?.headers).get("authorization");
      return new Response(null, { status: 204 });
    },
  });
  await api.logout();
  assert.equal(seen.url, "http://backend.test/auth/logout");
  assert.equal(seen.method, "POST");
  assert.equal(seen.authorization, "Bearer jwt-1");
});

test("GET /target-region keeps a contract level on list items", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      jsonResponse({
        items: [
          {
            label: "Plagwitz",
            grain: "ags",
            geoKey: "14713000",
            ags: "14713000",
            updatedAt: "2026-10-03T12:00:00.000Z",
            bounds: null,
            geometry: null,
            level: "ortsteil",
            parentLabel: "Leipzig",
          },
        ],
      }),
  });
  const items = await api.listTargetRegions();
  assert.equal(items[0]?.label, "Plagwitz");
  assert.equal(items[0]?.level, "ortsteil");
  assert.equal(items[0]?.parentLabel, "Leipzig");
});

test("GET /target-region maps 404 and an empty list to no rows", async () => {
  const missing = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => jsonResponse({ statusCode: 404, message: "Not found" }, 404),
  });
  assert.deepEqual(await missing.listTargetRegions(), []);

  const empty = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => jsonResponse({ items: [] }),
  });
  assert.deepEqual(await empty.listTargetRegions(), []);
});

test("POST /target-region and store revenue use the contract paths", async () => {
  const calls: string[] = [];
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/target-region")) {
        return jsonResponse({
          label: "München",
          grain: "ags",
          geoKey: "09162000",
          ags: "09162000",
          plz: null,
          lon: 11.5,
          lat: 48.1,
          updatedAt: "2026-09-29T12:00:00.000Z",
        });
      }
      if (url.endsWith("/stores") && init?.method === "POST") {
        return jsonResponse(
          {
            id: "3",
            label: "Nord",
            street: "Weg 1",
            postalCode: "80331",
            city: "München",
            countryCode: "DE",
            lon: null,
            lat: null,
            createdAt: "2026-09-29T12:00:00.000Z",
            updatedAt: "2026-09-29T12:00:00.000Z",
          },
          201,
        );
      }
      if (url.endsWith("/revenue") && init?.method === "PUT") {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          points: [{ year: 2026, month: 1, revenueEur: null }],
        });
        return jsonResponse({
          points: [{ year: 2026, month: 1, revenueEur: null, updatedAt: "2026-09-29T12:00:00.000Z" }],
        });
      }
      return jsonResponse({ statusCode: 500, message: url }, 500);
    },
  });

  const region = await api.addTargetRegion({ label: "München", grain: "ags", geoKey: "09162000" });
  assert.equal(region.label, "München");
  assert.equal(region.level, null);
  const store = await api.createStore({
    label: "Nord",
    street: "Weg 1",
    postalCode: "80331",
    city: "München",
    countryCode: "DE",
  });
  assert.equal(store.id, "3");
  const points = await api.putStoreRevenue("3", [{ year: 2026, month: 1, revenueEur: null }]);
  assert.equal(points[0]?.revenueEur, null);
  assert.deepEqual(calls, [
    "POST http://backend.test/target-region",
    "POST http://backend.test/stores",
    "PUT http://backend.test/stores/3/revenue",
  ]);
});

test("DELETE /target-region/{geoKey} encodes the catalog key", async () => {
  const seen: { url?: string; method?: string } = {};
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (input, init) => {
      seen.url = String(input);
      seen.method = init?.method;
      return new Response(null, { status: 204 });
    },
  });
  await api.removeTargetRegion("ortsteil:osm:5712247");
  assert.equal(seen.method, "DELETE");
  assert.equal(seen.url, "http://backend.test/target-region/ortsteil%3Aosm%3A5712247");
});

test("GET /stores keeps Filialadressen coordinates and GET /target-region keeps map geometry", async () => {
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/stores")) {
        return jsonResponse({
          stores: [
            {
              id: "1",
              label: "Marienplatz",
              street: "Marienplatz 1",
              postalCode: "80331",
              city: "München",
              countryCode: "DE",
              lon: 11.575,
              lat: 48.137,
              createdAt: "2026-09-29T12:00:00.000Z",
              updatedAt: "2026-09-29T12:00:00.000Z",
            },
            {
              id: "2",
              label: "Alexanderplatz",
              street: "Alexanderplatz 1",
              postalCode: "10178",
              city: "Berlin",
              countryCode: "DE",
              lon: 13.413,
              lat: 52.522,
              createdAt: "2026-09-29T12:00:00.000Z",
              updatedAt: "2026-09-29T12:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/target-region")) {
        return jsonResponse({
          items: [
            {
              label: "München",
              grain: "ags",
              geoKey: "09162000",
              lon: 11.5,
              lat: 48.1,
              updatedAt: "2026-09-29T12:00:00.000Z",
              bounds: { west: 11.3, south: 48.0, east: 11.8, north: 48.3 },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [11.3, 48.0],
                    [11.8, 48.0],
                    [11.8, 48.3],
                    [11.3, 48.3],
                    [11.3, 48.0],
                  ],
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({ statusCode: 500, message: url }, 500);
    },
  });

  const stores = await api.listStores();
  assert.equal(stores[0]?.lon, 11.575);
  assert.equal(stores[0]?.lat, 48.137);
  assert.equal(stores[1]?.street, "Alexanderplatz 1");
  const items = await api.listTargetRegions();
  const region = items[0];
  assert.equal(region?.bounds?.west, 11.3);
  assert.equal(region?.bounds?.south, 48);
  assert.equal(region?.bounds?.east, 11.8);
  assert.equal(region?.bounds?.north, 48.3);
  assert.equal(region?.geometry?.type, "Polygon");
  assert.equal(region?.level, null);
  const model = buildKarte({
    stores,
    regions: items,
    markedKey: region?.geoKey ?? null,
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.equal(model.pins.length, 2);
  assert.equal(model.pins[0]?.place, "80331 München");
  assert.equal(model.showLegend, true);
  assert.equal(model.camera.kind, "bounds");
  if (model.camera.kind === "bounds") {
    assert.equal(model.camera.bounds.west, 11.3);
    assert.equal(model.camera.bounds.east, 13.413);
    assert.equal(model.camera.bounds.north, 52.522);
  }
});

test("GET /stores keeps numeric-string coordinates and does not treat them as missing", async () => {
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      jsonResponse({
        stores: [
          {
            id: "1",
            label: null,
            street: "Weg 1",
            postalCode: "80331",
            city: "München",
            countryCode: "DE",
            lon: "11.575",
            lat: "48.137",
            createdAt: "2026-09-29T12:00:00.000Z",
            updatedAt: "2026-09-29T12:00:00.000Z",
          },
          {
            id: "2",
            label: null,
            street: "Weg 2",
            postalCode: "20095",
            city: "Hamburg",
            countryCode: "DE",
            lon: null,
            lat: null,
            createdAt: "2026-09-29T12:00:00.000Z",
            updatedAt: "2026-09-29T12:00:00.000Z",
          },
        ],
      }),
  });

  const stores = await api.listStores();
  assert.equal(stores[0]?.lon, 11.575);
  assert.equal(typeof stores[0]?.lon, "number");
  assert.equal(stores[0]?.lat, 48.137);
  assert.equal(stores[1]?.lon, null);
  const model = buildKarte({
    stores,
    regions: [],
    recommendations: [],
    addressesKnownEmpty: false,
  });
  assert.deepEqual(
    model.pins.map((pin) => pin.id),
    ["1"],
  );
  assert.equal(model.showEmptyAddresses, false);
  assert.equal(model.coordinateGapLabel, "1 Filialadresse ohne Koordinaten.");
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
