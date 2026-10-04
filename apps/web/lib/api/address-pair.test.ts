import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAddressPair } from "../addresses/parse.ts";
import { createHttpApi } from "./http.ts";
import { ApiError } from "./types.ts";

const input = { street: "Marienplatz 1", postalCode: "80331", city: "München" };
const other = { street: "Alexanderplatz 1", postalCode: "10178", city: "Berlin" };

const pairBody = {
  left: {
    input,
    resolution: "resolved" as const,
    gemeinde: { name: "München" },
    kreis: { name: "München" },
    land: { name: "Bayern" },
    topics: [
      { id: "pendler", level: "gemeinde", status: "present", value: { count: 12 } },
      { id: "zensus2022", level: "gemeinde", status: "present", value: { gebaeude: 1840, wohnungen: 2210 } },
      { id: "breitband", level: "gemeinde", status: "absent" },
      { id: "pks", level: "kreis", status: "present", value: { cases: 4 } },
    ],
  },
  right: {
    input: other,
    resolution: "resolved" as const,
    gemeinde: { name: "Berlin" },
    kreis: { name: "Berlin" },
    land: { name: "Berlin" },
    topics: [
      { id: "pendler", level: "gemeinde", status: "present", value: { count: 8 } },
      { id: "zensus2022", level: "gemeinde", status: "absent" },
    ],
  },
  shared: [{ id: "pendler", level: "gemeinde", left: { count: 12 }, right: { count: 8 } }],
};

test("POST /address-pair sends the bearer token and the two addresses", async () => {
  const seen: { url?: string; method?: string; authorization?: string | null; body?: string } = {};
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (request, init) => {
      seen.url = String(request);
      seen.method = init?.method;
      seen.authorization = new Headers(init?.headers).get("authorization");
      seen.body = typeof init?.body === "string" ? init.body : undefined;
      return json(pairBody);
    },
  });

  const result = await api.evaluateAddressPair({ left: input, right: other });
  assert.equal(seen.url, "http://backend.test/address-pair");
  assert.equal(seen.method, "POST");
  assert.equal(seen.authorization, "Bearer jwt-1");
  assert.deepEqual(JSON.parse(String(seen.body)), { left: input, right: other });
  assert.equal(result.left.resolution, "resolved");
  assert.equal(result.left.gemeinde?.name, "München");
  assert.equal(result.left.topics.find((topic) => topic.id === "breitband")?.status, "absent");
  assert.equal(result.left.topics.find((topic) => topic.id === "breitband")?.value, undefined);
  assert.equal(result.shared[0]?.id, "pendler");
});

test("POST /address-pair requires a session token", async () => {
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    fetch: async () => json(pairBody),
  });
  await assert.rejects(() => api.evaluateAddressPair({ left: input, right: other }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    return true;
  });
});

test("an unknown side drops topics and place names", () => {
  const parsed = parseAddressPair({
    left: {
      input,
      resolution: "unknown",
      gemeinde: { name: "should-not-show" },
      kreis: { name: "should-not-show" },
      land: null,
      topics: [{ id: "pendler", level: "gemeinde", status: "present", value: { count: 1 } }],
    },
    right: pairBody.right,
    shared: [],
  });
  assert.equal(parsed.left.resolution, "unknown");
  assert.equal(parsed.left.gemeinde, null);
  assert.equal(parsed.left.kreis, null);
  assert.equal(parsed.left.land, null);
  assert.deepEqual(parsed.left.topics, []);
  assert.equal(parsed.right.resolution, "resolved");
});

test("OpenAPI 0.7.0 requires resolution, places, topics and shared", () => {
  assert.throws(() => parseAddressPair({ left: pairBody.left, right: pairBody.right }), ApiError);
  assert.throws(
    () =>
      parseAddressPair({
        left: { input, gemeinde: { name: "München" }, kreis: { name: "München" }, land: null, topics: [] },
        right: pairBody.right,
        shared: [],
      }),
    ApiError,
  );
  assert.throws(
    () =>
      parseAddressPair({
        left: { ...pairBody.left, gemeinde: "München" },
        right: pairBody.right,
        shared: [],
      }),
    ApiError,
  );
  assert.throws(
    () =>
      parseAddressPair({
        left: { ...pairBody.left, gemeinde: { label: "München" } },
        right: pairBody.right,
        shared: [],
      }),
    ApiError,
  );
});

test("a resolved side may have a null Land and keeps topics", () => {
  const parsed = parseAddressPair({
    left: { ...pairBody.left, land: null },
    right: pairBody.right,
    shared: pairBody.shared,
  });
  assert.equal(parsed.left.resolution, "resolved");
  assert.equal(parsed.left.land, null);
  assert.equal(parsed.left.topics.length > 0, true);
});

test("an absent topic never keeps a value of 0", () => {
  const parsed = parseAddressPair({
    left: {
      input,
      resolution: "resolved",
      gemeinde: { name: "München" },
      kreis: { name: "München" },
      land: null,
      topics: [{ id: "breitband", level: "gemeinde", status: "absent", value: 0 }],
    },
    right: {
      input: other,
      resolution: "resolved",
      gemeinde: { name: "Berlin" },
      kreis: { name: "Berlin" },
      land: null,
      topics: [],
    },
    shared: [],
  });
  assert.deepEqual(parsed.left.topics[0], { id: "breitband", level: "gemeinde", status: "absent" });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
