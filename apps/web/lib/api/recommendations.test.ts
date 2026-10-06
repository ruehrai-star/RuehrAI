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
      kind: "plz",
      grain: "plz5",
      name: "Schwabing",
      parentLabel: "München",
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
      targetRegionGeoKey: "plz5:80801",
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
      if (url.includes("/recommendations") && init?.method === "POST") return json(set, 201);
      if (url.includes("/recommendations")) return json(set);
      return json({ statusCode: 500, message: url }, 500);
    },
  });

  const latest = await api.getRecommendations();
  assert.equal(latest?.items[0]?.rationale.startsWith("Am Standort Schwabing"), true);
  assert.equal(latest?.items[0]?.grain, "plz5");
  assert.equal(latest?.items[0]?.name, "Schwabing");
  assert.equal(latest?.items[0]?.parentLabel, "München");
  assert.equal(latest?.items[0]?.location.level, "plz");
  assert.equal(latest?.items[0]?.location.parentLabel, "München");
  const created = await api.createRecommendations();
  assert.equal(created.count, 1);
  assert.equal(created.items[0]?.rank, 1);
  const pinned = await api.createRecommendations({ runId: "15" });
  assert.equal(pinned.runId, "15");
  const byRun = await api.getRecommendations({ runId: "15" });
  assert.equal(byRun?.runId, "15");

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "GET http://backend.test/recommendations",
      "POST http://backend.test/recommendations",
      "POST http://backend.test/recommendations",
      "GET http://backend.test/recommendations?runId=15",
    ],
  );
  assert.equal(calls.every((call) => call.authorization === "Bearer jwt-1"), true);
  assert.equal(calls[1]?.body, undefined);
  assert.deepEqual(JSON.parse(calls[2]?.body ?? "{}"), { runId: "15" });
});

test("GET /recommendations accepts additive patternByLevel and still parses without it", async () => {
  const withProfile = {
    ...set,
    patternByLevel: [
      {
        level: "plz",
        role: "pattern",
        geoKeys: ["80801"],
        yearlySeries: [
          {
            metricId: "unfallatlas",
            requestedLevel: "plz",
            requestedGeoKey: "80801",
            sourceLevel: "plz",
            sourceGeoKey: "80801",
            granularity: "year",
            coverage: "multi",
            points: [
              { period: "2023", status: "present", value: 10 },
              { period: "2024", status: "absent" },
              { period: "2025", status: "present", value: 8 },
            ],
          },
        ],
        criteria: [
          {
            key: "unfallatlas",
            label: "Unfälle",
            direction: "down",
            evidence: "fällt",
            kind: "trend",
            scope: "local",
          },
        ],
      },
      {
        level: "kreis",
        role: "frame",
        geoKeys: ["09162"],
        yearlySeries: [],
        criteria: [],
      },
    ],
  };
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json(withProfile),
  });
  const latest = await api.getRecommendations();
  assert.equal(latest?.patternByLevel?.length, 2);
  assert.equal(latest?.patternByLevel?.[0]?.level, "plz");
  assert.equal(latest?.patternByLevel?.[0]?.criteria[0]?.scope, "local");
  assert.equal(latest?.patternByLevel?.[1]?.role, "frame");
  assert.equal(latest?.patternByLevel?.[0]?.yearlySeries[0]?.points.find((point) => point.period === "2024")?.status, "absent");
  assert.equal(latest?.patternByLevel?.[0]?.yearlySeries[0]?.points.find((point) => point.period === "2024")?.value, undefined);
});

test("GET /recommendations accepts additive patternByDataset and still parses without it", async () => {
  const withDataset = {
    ...set,
    patternByDataset: [
      {
        metricId: "kba_elektro_pkw",
        baseline: "per_1000_inhabitants",
        sourceLevel: "plz",
        sourceGeoKey: "80801",
        baselineMethod: "official",
        yearlySeries: {
          metricId: "kba_elektro_pkw",
          requestedLevel: "plz",
          requestedGeoKey: "80801",
          sourceLevel: "plz",
          sourceGeoKey: "80801",
          granularity: "year",
          coverage: "multi",
          points: [
            { period: "2023", status: "present", value: 10, normalizedValue: 1, baselineMethod: "official" },
            { period: "2024", status: "absent" },
            { period: "2025", status: "present", value: 20, normalizedValue: 2, baselineMethod: "official_zensus2022_grid" },
          ],
        },
        criterion: {
          key: "kba_elektro_pkw",
          metricId: "kba_elektro_pkw",
          label: "Elektro-Pkw",
          direction: "up",
          evidence: "steigt je 1.000 Einwohner",
          kind: "trend",
          baseline: "per_1000_inhabitants",
          rawValue: 20,
          normalizedValue: 2,
          sourceLevel: "plz",
          baselineMethod: "estimate_zensus2022_grid_sum",
        },
      },
    ],
    items: [
      {
        ...set.items[0],
        criteriaEvidence: [
          {
            ...set.items[0]!.criteriaEvidence[0],
            metricId: "kba_elektro_pkw",
            baseline: "per_1000_inhabitants",
            rawValue: 20,
            normalizedValue: 2,
            sourceLevel: "plz",
            baselineMethod: "official",
          },
        ],
      },
    ],
  };
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json(withDataset),
  });
  const latest = await api.getRecommendations();
  assert.equal(latest?.patternByDataset?.length, 1);
  assert.equal(latest?.patternByDataset?.[0]?.metricId, "kba_elektro_pkw");
  assert.equal(latest?.patternByDataset?.[0]?.baseline, "per_1000_inhabitants");
  assert.equal(latest?.patternByDataset?.[0]?.criterion.normalizedValue, 2);
  assert.equal(latest?.patternByDataset?.[0]?.criterion.baselineMethod, "estimate_zensus2022_grid_sum");
  assert.equal(latest?.patternByDataset?.[0]?.baselineMethod, "official");
  assert.equal(
    latest?.patternByDataset?.[0]?.yearlySeries.points.find((point) => point.period === "2025")?.baselineMethod,
    "official_zensus2022_grid",
  );
  assert.equal(latest?.items[0]?.criteriaEvidence[0]?.rawValue, 20);
  assert.equal(latest?.items[0]?.criteriaEvidence[0]?.baselineMethod, "official");
  assert.equal(
    latest?.patternByDataset?.[0]?.yearlySeries.points.find((point) => point.period === "2024")?.normalizedValue,
    undefined,
  );
});

test("GET /recommendations accepts 0.18 geometry, series coverage, trend, and baselineMatch", async () => {
  const withHit = {
    ...set,
    patternByDataset: [
      {
        metricId: "unfallatlas",
        baseline: "per_1000_inhabitants",
        sourceLevel: "plz",
        sourceGeoKey: "80801",
        baselineMatch: true,
        yearlySeries: {
          metricId: "unfallatlas",
          requestedLevel: "plz",
          requestedGeoKey: "80801",
          sourceLevel: "plz",
          sourceGeoKey: "80801",
          granularity: "year",
          coverage: "series",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2025", status: "present", value: 8 },
          ],
        },
        criterion: {
          key: "unfallatlas",
          label: "Unfälle",
          direction: "down",
          evidence: "fällt",
        },
      },
    ],
    items: [
      {
        ...set.items[0],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.5, 48.1],
              [11.6, 48.1],
              [11.6, 48.2],
              [11.5, 48.2],
              [11.5, 48.1],
            ],
          ],
        },
        geometryUnavailableReason: null,
        trend: { direction: "down", summary: "Unfälle fallen seit drei Jahren." },
        criteriaEvidence: [
          {
            ...set.items[0]!.criteriaEvidence[0],
            baselineMatch: false,
            evidence: "Unfälle liegt nicht vor.",
          },
        ],
      },
    ],
  };
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json(withHit),
  });
  const latest = await api.getRecommendations();
  assert.equal(latest?.items[0]?.geometry?.type, "Polygon");
  assert.equal(latest?.items[0]?.geometryUnavailableReason, null);
  assert.equal(latest?.items[0]?.trend?.direction, "down");
  assert.equal(latest?.items[0]?.criteriaEvidence[0]?.baselineMatch, false);
  assert.equal(latest?.patternByDataset?.[0]?.yearlySeries.coverage, "series");
  assert.equal(latest?.patternByDataset?.[0]?.baselineMatch, true);
});

test("GET /recommendations keeps official grain, parentLabel, and intersectionOf", async () => {
  const withParts = {
    ...set,
    items: [
      {
        ...set.items[0],
        grain: "plz5",
        name: "10115",
        parentLabel: "Mitte",
        intersectionOf: [
          { geoKey: "11000001", grain: "ags", name: "Mitte", datasetKey: "kba_elektro_pkw" },
          { geoKey: "10115", grain: "plz5", name: "10115", datasetKey: "wanderungen" },
        ],
      },
    ],
  };
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json(withParts),
  });
  const latest = await api.getRecommendations();
  assert.equal(latest?.items[0]?.grain, "plz5");
  assert.equal(latest?.items[0]?.name, "10115");
  assert.equal(latest?.items[0]?.parentLabel, "Mitte");
  assert.deepEqual(latest?.items[0]?.intersectionOf, withParts.items[0]?.intersectionOf);
});

test("GET /recommendations keeps optional overlaps without treating them as intersectionOf", async () => {
  const withOverlaps = {
    ...set,
    items: [
      {
        ...set.items[0],
        grain: "plz5",
        name: "PLZ 81541",
        parentLabel: "München",
        overlaps: [
          { geoKey: "stadtbezirk:au", label: "Au-Haidhausen", kind: "stadtbezirk", share: 0.42 },
          { geoKey: "stadtbezirk:og", label: "Obergiesing-Fasangarten", kind: "stadtbezirk", share: 0.38 },
        ],
      },
    ],
  };
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json(withOverlaps),
  });
  const latest = await api.getRecommendations();
  assert.equal(latest?.items[0]?.parentLabel, "München");
  assert.equal(latest?.items[0]?.name, "PLZ 81541");
  assert.deepEqual(latest?.items[0]?.overlaps, withOverlaps.items[0]?.overlaps);
});

test("GET /recommendations fills name from location when a stored set still has name null", async () => {
  const legacy = {
    ...set,
    items: [
      {
        ...set.items[0],
        name: null,
        location: { ...set.items[0].location, name: "PLZ 80801" },
      },
    ],
  };
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json(legacy),
  });
  const latest = await api.getRecommendations();
  assert.equal(typeof latest?.items[0]?.name, "string");
  assert.equal(latest?.items[0]?.name, "PLZ 80801");
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

test("GET /recommendations accepts a year window and more than three hits", async () => {
  const yearly = {
    ...set,
    window: { from: "2023", to: "2025" },
    count: 4,
    items: [0, 1, 2, 3].map((index) => ({
      ...set.items[0],
      id: `plz5:8080${index}`,
      rank: index + 1,
    })),
  };
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json(yearly),
  });
  const latest = await api.getRecommendations();
  assert.equal(latest?.window.from, "2023");
  assert.equal(latest?.count, 4);
  assert.equal(latest?.items[3]?.rank, 4);
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
