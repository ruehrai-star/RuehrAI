import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpApi } from "./http.ts";
import { ApiError } from "./types.ts";

const pattern = {
  source: "heuristic",
  summary: "Einwohner steigen mit dem Umsatz.",
  revenueDirection: "up",
  criteria: [
    {
      key: "einwohner",
      label: "Einwohner",
      direction: "up",
      evidence: "Einwohner steigt zwischen den vorliegenden Zeiträumen.",
    },
  ],
};

const set = {
  id: "3",
  runId: "15",
  createdAt: "2026-09-29T12:00:00.000Z",
  window: { from: "2026-04", to: "2026-09" },
  count: 1,
  reason: "In der Zielregion liegt nur 1 Standort mit positiver Musterentwicklung in den letzten sechs Monaten vor.",
  pattern,
  items: [
    {
      id: "plz5:80801",
      rank: 1,
      title: "Schwabing",
      location: {
        geoKey: "80801",
        grain: "plz5",
        lon: 11.58,
        lat: 48.16,
        name: "Schwabing",
        level: "plz",
        parentLabel: "München",
      },
      score: 1,
      rationale: "Am Standort Schwabing passt das Muster in den letzten sechs Monaten.",
      criteriaEvidence: [
        {
          key: "einwohner",
          label: "Einwohner",
          direction: "up",
          patternDirection: "up",
          evidence: "Einwohner steigt in den letzten sechs Monaten.",
        },
      ],
      source: "heuristic",
    },
  ],
};

test("recommendation calls send the bearer token and follow the OpenAPI paths", async () => {
  const calls: { url: string; method: string; authorization: string | null; body?: string }[] = [];
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/recommendations") && init?.method === "POST") return json(set, 201);
      if (url.endsWith("/recommendations")) return json(set);
      return json({ statusCode: 500, message: url }, 500);
    },
  });

  const latest = await api.getRecommendations();
  assert.equal(latest?.items[0]?.rationale.startsWith("Am Standort Schwabing"), true);
  assert.equal(latest?.items[0]?.location.level, "plz");
  assert.equal(latest?.items[0]?.location.parentLabel, "München");
  const created = await api.createRecommendations();
  assert.equal(created.count, 1);
  assert.equal(created.items[0]?.rank, 1);
  const pinned = await api.createRecommendations({ runId: "15" });
  assert.equal(pinned.runId, "15");

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "GET http://backend.test/recommendations",
      "POST http://backend.test/recommendations",
      "POST http://backend.test/recommendations",
    ],
  );
  assert.equal(calls.every((call) => call.authorization === "Bearer jwt-1"), true);
  assert.equal(calls[1]?.body, undefined);
  assert.deepEqual(JSON.parse(calls[2]?.body ?? "{}"), { runId: "15" });
});

test("GET /recommendations maps 404 to no set", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      json(
        {
          statusCode: 404,
          message: "Es liegen noch keine Empfehlungen vor. Bitte zuerst Empfehlungen berechnen.",
          error: "Not Found",
        },
        404,
      ),
  });
  assert.equal(await api.getRecommendations(), null);
});

test("POST /recommendations keeps the German missing-pattern error", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      json(
        {
          statusCode: 404,
          message: "Es liegt noch kein Muster vor. Bitte zuerst eine Analyse starten.",
          error: "Not Found",
        },
        404,
      ),
  });
  await assert.rejects(api.createRecommendations(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.match(error.message, /kein Muster/);
    return true;
  });
});

test("a recommendation set whose count disagrees with its items is rejected", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json({ ...set, count: 3 }),
  });
  await assert.rejects(api.getRecommendations(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 502);
    return true;
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
