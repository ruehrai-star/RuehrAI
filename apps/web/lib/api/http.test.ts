import assert from "node:assert/strict";
import { test } from "node:test";
import { apiBaseUrl, createHttpApi, DEFAULT_API_BASE_URL, toMapFeatureCollection } from "./http.ts";
import { ApiError } from "./types.ts";

test("api base URL defaults to the Backend local port and strips a trailing slash", () => {
  assert.equal(apiBaseUrl({} as NodeJS.ProcessEnv), DEFAULT_API_BASE_URL);
  assert.equal(
    apiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: "http://localhost:3000/" } as NodeJS.ProcessEnv),
    "http://localhost:3000",
  );
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

test("GET /target-region maps 404 to an empty region", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => jsonResponse({ statusCode: 404, message: "Not found" }, 404),
  });
  assert.equal(await api.getTargetRegion(), null);
});

test("PUT /target-region and store revenue use the contract paths", async () => {
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

  const region = await api.putTargetRegion({ label: "München", grain: "ags", geoKey: "09162000" });
  assert.equal(region.label, "München");
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
    "PUT http://backend.test/target-region",
    "POST http://backend.test/stores",
    "PUT http://backend.test/stores/3/revenue",
  ]);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
