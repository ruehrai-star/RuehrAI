import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpApi } from "./http.ts";
import { ApiError } from "./types.ts";

const region = {
  label: "München",
  grain: "ags",
  geoKey: "09162000",
  ags: "09162000",
  plz: null,
  lon: 11.5,
  lat: 48.1,
  updatedAt: "2026-09-29T11:00:00.000Z",
};

const input = {
  region,
  stores: [
    {
      id: "3",
      label: "Nord",
      street: "Weg 1",
      postalCode: "80331",
      city: "München",
      lon: null,
      lat: null,
      points: [
        { year: 2026, month: 1, revenueEur: 10 },
        { year: 2026, month: 2, revenueEur: 12 },
      ],
      changes: [
        {
          fromYear: 2026,
          fromMonth: 1,
          toYear: 2026,
          toMonth: 2,
          fromRevenueEur: 10,
          toRevenueEur: 12,
          changeEur: 2,
        },
      ],
    },
  ],
  revenueDirection: "up",
  capturedAt: "2026-09-29T12:00:00.000Z",
};

const pattern = {
  source: "heuristic",
  summary: "Der Filialumsatz ist steigend.",
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

const run = {
  id: "7",
  status: "completed",
  createdAt: "2026-09-29T12:00:00.000Z",
  input,
  brain: {
    mode: "sql",
    vectorUnavailableReason: "embeddings_unreachable",
    factCount: 2,
    facts: [],
  },
  pattern,
};

test("analysis calls send the bearer token and follow the OpenAPI paths", async () => {
  const calls: { url: string; method: string; authorization: string | null; body: string | undefined }[] = [];
  const api = createHttpApi({
    baseUrl: "http://backend.test",
    getAccessToken: () => "jwt-1",
    fetch: async (inputUrl, init) => {
      const url = String(inputUrl);
      calls.push({
        url,
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/analysis/input")) return json(input);
      if (url.endsWith("/analysis/runs") && init?.method === "POST") return json({ ...run, status: "queued" }, 202);
      if (url.endsWith("/analysis/runs/7")) return json(run);
      if (url.endsWith("/analysis/pattern")) {
        return json({ runId: "7", createdAt: run.createdAt, pattern });
      }
      return json({ statusCode: 500, message: url }, 500);
    },
  });

  const loaded = await api.getAnalysisInput();
  assert.equal(loaded.region.label, "München");
  assert.equal(loaded.stores[0]?.points[1]?.revenueEur, 12);

  const created = await api.createAnalysisRun();
  assert.equal(created.id, "7");
  assert.equal(created.status, "queued");
  assert.equal(created.brain.mode, "sql");
  assert.equal(created.pattern.summary, pattern.summary);

  const read = await api.getAnalysisRun("7");
  assert.equal(read.pattern.criteria[0]?.label, "Einwohner");

  const latest = await api.getAnalysisPattern();
  assert.equal(latest?.runId, "7");

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "GET http://backend.test/analysis/input",
      "POST http://backend.test/analysis/runs",
      "GET http://backend.test/analysis/runs/7",
      "GET http://backend.test/analysis/pattern",
    ],
  );
  assert.equal(calls.every((call) => call.authorization === "Bearer jwt-1"), true);
  assert.equal(calls[1]?.body, undefined);
});

test("GET /analysis/pattern maps 404 to no pattern", async () => {
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
  assert.equal(await api.getAnalysisPattern(), null);
});

test("POST /analysis/runs keeps the German Backend error", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      json(
        {
          statusCode: 400,
          message:
            "Die Monatsumsätze reichen für eine Musteranalyse nicht aus. Mindestens eine Filiale braucht zwei aufeinanderfolgende Monate mit gesetztem Umsatz.",
          error: "Bad Request",
        },
        400,
      ),
  });
  await assert.rejects(api.createAnalysisRun(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.match(error.message, /Monatsumsätze/);
    return true;
  });
});

test("a malformed analysis run is rejected", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json({ id: "7", status: "running" }),
  });
  await assert.rejects(api.getAnalysisRun("7"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 502);
    return true;
  });
});

test("GET /analysis/runs accepts queued, running, and failed when the payload is complete", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async (inputUrl) => {
      const url = String(inputUrl);
      if (url.endsWith("/analysis/runs/8")) return json({ ...run, id: "8", status: "queued", startedAt: null, completedAt: null });
      if (url.endsWith("/analysis/runs/9")) return json({ ...run, id: "9", status: "running", startedAt: run.createdAt, completedAt: null });
      return json({
        ...run,
        id: "10",
        status: "failed",
        failureReason: "timeout",
        startedAt: run.createdAt,
        completedAt: run.createdAt,
      });
    },
  });
  assert.equal((await api.getAnalysisRun("8")).status, "queued");
  assert.equal((await api.getAnalysisRun("9")).status, "running");
  const failed = await api.getAnalysisRun("10");
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReason, "timeout");
});

test("GET /analysis/pattern accepts an old run without yearlySeries", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json({ runId: "7", createdAt: run.createdAt, pattern }),
  });
  const latest = await api.getAnalysisPattern();
  assert.equal(latest?.pattern.yearlySeries, undefined);
});

test("GET /analysis/pattern keeps yearlySeries points and absent cells without value", async () => {
  const yearlySeries = [
    {
      metricId: "bevoelkerung",
      requestedLevel: "ortsteil",
      requestedGeoKey: "ortsteil:osm:1",
      sourceLevel: "gemeinde",
      sourceGeoKey: "11000000",
      granularity: "year",
      coverage: "single",
      points: [
        { period: "2023", status: "absent" },
        { period: "2024", status: "present", value: 0 },
        { period: "2025", status: "absent" },
      ],
    },
  ];
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json({ runId: "7", createdAt: run.createdAt, pattern: { ...pattern, yearlySeries } }),
  });
  const latest = await api.getAnalysisPattern();
  assert.equal(latest?.pattern.yearlySeries?.[0]?.coverage, "single");
  assert.equal(latest?.pattern.yearlySeries?.[0]?.points[1]?.value, 0);
  assert.equal(latest?.pattern.yearlySeries?.[0]?.points[0]?.value, undefined);
});

test("GET /analysis/pattern accepts requestedLevel kreis for grain ags5", async () => {
  const yearlySeries = [
    {
      metricId: "destatis_wohnungen",
      requestedLevel: "kreis",
      requestedGeoKey: "05315",
      sourceLevel: "kreis",
      sourceGeoKey: "05315",
      granularity: "year",
      coverage: "multi",
      points: [
        { period: "2023", status: "absent" },
        { period: "2024", status: "present", value: 540000 },
        { period: "2025", status: "present", value: 545000 },
      ],
    },
  ];
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json({ runId: "7", createdAt: run.createdAt, pattern: { ...pattern, yearlySeries } }),
  });
  const latest = await api.getAnalysisPattern();
  assert.equal(latest?.pattern.yearlySeries?.[0]?.requestedLevel, "kreis");
  assert.equal(latest?.pattern.yearlySeries?.[0]?.coverage, "multi");
});

test("GET /analysis/pattern rejects a present yearlySeries point without a number", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () =>
      json({
        runId: "7",
        createdAt: run.createdAt,
        pattern: {
          ...pattern,
          yearlySeries: [
            {
              metricId: "bevoelkerung",
              requestedLevel: "gemeinde",
              requestedGeoKey: "11000000",
              sourceLevel: "gemeinde",
              sourceGeoKey: "11000000",
              granularity: "year",
              coverage: "single",
              points: [{ period: "2024", status: "present" }],
            },
          ],
        },
      }),
  });
  await assert.rejects(api.getAnalysisPattern(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 502);
    return true;
  });
});

test("GET /analysis/pattern?geoKey= sends the marked catalog key", async () => {
  const seen: string[] = [];
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async (inputUrl) => {
      seen.push(String(inputUrl));
      return json({
        runId: "7",
        createdAt: run.createdAt,
        region: { label: "Lankwitz", geoKey: "ortsteil:osm:5712247", level: "ortsteil", parentLabel: "Berlin" },
        pattern,
      });
    },
  });
  const latest = await api.getAnalysisPattern({ geoKey: "ortsteil:osm:5712247" });
  assert.equal(latest?.runId, "7");
  assert.equal(latest?.region?.label, "Lankwitz");
  assert.equal(latest?.region?.parentLabel, "Berlin");
  assert.equal(seen[0], "http://localhost:3000/analysis/pattern?geoKey=ortsteil%3Aosm%3A5712247");
});

test("GET /analysis/pattern without geoKey keeps the latest-pattern URL", async () => {
  const seen: string[] = [];
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async (inputUrl) => {
      seen.push(String(inputUrl));
      return json({ runId: "7", createdAt: run.createdAt, pattern });
    },
  });
  const latest = await api.getAnalysisPattern();
  assert.equal(latest?.region, undefined);
  assert.equal(seen[0], "http://localhost:3000/analysis/pattern");
});

test("GET /analysis/pattern?geoKey= maps 404 to no pattern", async () => {
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
  assert.equal(await api.getAnalysisPattern({ geoKey: "09162000" }), null);
});

test("GET /analysis/pattern ignores a region object without a label", async () => {
  const api = createHttpApi({
    getAccessToken: () => "jwt-1",
    fetch: async () => json({ runId: "7", createdAt: run.createdAt, region: { geoKey: "09162000" }, pattern }),
  });
  const latest = await api.getAnalysisPattern({ geoKey: "09162000" });
  assert.equal(latest?.region, undefined);
  assert.equal(latest?.runId, "7");
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
