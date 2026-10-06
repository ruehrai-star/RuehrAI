import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AnalysisPattern, AnalysisRun } from "@ruehrai/api-contracts";
import { ApiError, type Recommendation, type RecommendationSet, type TargetRegion } from "../api/types.ts";
import {
  bindTrefferlisteForRegion,
  loadRecommendationsForRun,
  pollTrefferlisteRun,
  recommendationSetForRun,
} from "./bind.ts";
import { visibleHits } from "./model.ts";

const koeln: RecommendationSet = {
  id: "29",
  runId: "31",
  createdAt: "2026-10-06T07:44:23.000Z",
  window: { from: "2023", to: "2025" },
  count: 5,
  reason: null,
  pattern: {
    source: "heuristic",
    summary: "Unfälle steigen in der Zielregion.",
    revenueDirection: "up",
    criteria: [],
  },
  items: [],
};

const tempelhof: RecommendationSet = {
  ...koeln,
  id: "28",
  runId: "30",
  count: 9,
};

const pattern: AnalysisPattern = {
  source: "heuristic",
  summary: "Unfälle steigen in der Zielregion.",
  revenueDirection: "up",
  criteria: [],
};

const marked: TargetRegion = {
  label: "Innenstadt",
  grain: "other",
  geoKey: "stadtbezirk:koeln:innenstadt",
  level: "bezirk",
  parentLabel: "Köln",
  lon: null,
  lat: null,
  bounds: null,
  geometry: null,
  updatedAt: "2026-10-06T08:00:00.000Z",
};

function run(partial: Partial<AnalysisRun> & Pick<AnalysisRun, "id" | "status">): AnalysisRun {
  return {
    createdAt: "2026-10-06T08:00:00.000Z",
    input: {
      region: marked,
      stores: [],
      revenueDirection: "flat",
      capturedAt: "2026-10-06T08:00:00.000Z",
    },
    brain: { mode: "sql", vectorUnavailableReason: null, factCount: 0, facts: [] },
    pattern,
    ...partial,
  };
}

test("loadRecommendationsForRun GETs by runId and never computes", async () => {
  const seen: Array<string | undefined> = [];
  const api = {
    getRecommendations: async (query?: { runId?: string }) => {
      seen.push(query?.runId);
      if (query?.runId === "31") return koeln;
      if (query?.runId === "30") return tempelhof;
      return null;
    },
  };

  assert.equal((await loadRecommendationsForRun(api, "31"))?.id, "29");
  assert.equal((await loadRecommendationsForRun(api, "30"))?.runId, "30");
  assert.equal(await loadRecommendationsForRun(api, "99"), null);
  assert.equal(await loadRecommendationsForRun(api, "  "), null);
  assert.deepEqual(seen, ["31", "30", "99"]);
});

test("a region switch shows a stored set and stays empty without one", () => {
  assert.equal(recommendationSetForRun(koeln, "31")?.id, "29");
  assert.equal(recommendationSetForRun(koeln, "30"), null);
  assert.equal(recommendationSetForRun(null, "31"), null);
});

test("bind never starts a run when the marked region has no pattern", async () => {
  const calls: string[] = [];
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async (query) => {
        calls.push(`pattern:${query?.geoKey ?? ""}`);
        return null;
      },
      getAnalysisRun: async (id) => {
        calls.push(`run:${id}`);
        return run({ id, status: "completed" });
      },
      getRecommendations: async (query) => {
        calls.push(`recs:${query?.runId ?? ""}`);
        return koeln;
      },
    },
    marked,
  );
  assert.equal(next.kind, "empty");
  assert.deepEqual(calls, ["pattern:stadtbezirk:koeln:innenstadt"]);
});

test("bind resumes polling when a known run is still queued or running", async () => {
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async () => {
        throw new Error("pattern must not run while in flight");
      },
      getAnalysisRun: async () => run({ id: "44", status: "running" }),
      getRecommendations: async () => {
        throw new Error("recs must not load while in flight");
      },
    },
    marked,
    "44",
  );
  assert.deepEqual(next, { kind: "in_flight", runId: "44", status: "running" });
});

test("bind of a failed known run maps the reason and does not POST", async () => {
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async () => null,
      getAnalysisRun: async () => run({ id: "45", status: "failed", failureReason: "timeout" }),
      getRecommendations: async () => null,
    },
    marked,
    "45",
  );
  assert.equal(next.kind, "failed");
  if (next.kind === "failed") {
    assert.match(next.message, /zu lange gedauert/);
    assert.equal(next.message.includes("timeout"), false);
    assert.equal(next.runId, "45");
  }
});

test("bind of an interrupted known run maps the restart copy", async () => {
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async () => null,
      getAnalysisRun: async () => run({ id: "46", status: "failed", failureReason: "interrupted" }),
      getRecommendations: async () => {
        throw new Error("recs must not load for an interrupted run");
      },
    },
    marked,
    "46",
  );
  assert.equal(next.kind, "failed");
  if (next.kind === "failed") {
    assert.equal(next.message, "Analyse fehlgeschlagen: Die Analyse wurde unterbrochen.");
    assert.equal(next.message.includes("interrupted"), false);
    assert.equal(next.runId, "46");
  }
});

test("a 404 for a known run id is a generic failure, not empty", async () => {
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async () => {
        throw new Error("pattern must not run after a missing run");
      },
      getAnalysisRun: async () => {
        throw new ApiError("Die Analyse wurde nicht gefunden.", 404);
      },
      getRecommendations: async () => {
        throw new Error("recs must not load for a missing run");
      },
    },
    marked,
    "99",
  );
  assert.equal(next.kind, "failed");
  if (next.kind === "failed") {
    assert.equal(next.runId, "99");
    assert.match(next.message, /unerwarteter Fehler/);
    assert.equal(next.message.includes("99"), false);
  }
});

test("recommendations are loaded only after the run is completed", async () => {
  const calls: string[] = [];
  let runReads = 0;
  const queuedThenDone = async (id: string) => {
    runReads += 1;
    calls.push(`run:${id}`);
    if (runReads < 2) return run({ id, status: "running" });
    return run({ id, status: "completed" });
  };
  const settled = await pollTrefferlisteRun(
    {
      getAnalysisPattern: async (query) => {
        calls.push(`pattern:${query?.geoKey ?? ""}`);
        return {
          runId: "31",
          createdAt: "2026-10-06T08:00:00.000Z",
          pattern,
          region: marked,
        };
      },
      getAnalysisRun: queuedThenDone,
      getRecommendations: async (query) => {
        calls.push(`recs:${query?.runId ?? ""}`);
        return koeln;
      },
    },
    "31",
    marked,
    { sleep: async () => {}, now: () => 0, deadlineMs: 60_000 },
  );
  assert.equal(settled.kind, "ready");
  assert.ok(calls.indexOf("recs:31") > -1);
  assert.ok(calls.indexOf("recs:31") > calls.indexOf("run:31"));
  assert.equal(
    calls.filter((item) => item.startsWith("recs:")).length,
    1,
  );
});

test("a 502 for a known in-flight run stays in flight so polling can continue", async () => {
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async () => {
        throw new Error("pattern must not run after a transient GET");
      },
      getAnalysisRun: async () => {
        throw new ApiError("Bad Gateway", 502);
      },
      getRecommendations: async () => {
        throw new Error("recs must not load after a transient GET");
      },
    },
    marked,
    "44",
  );
  assert.deepEqual(next, { kind: "in_flight", runId: "44", status: "running" });
});

test("Trefferliste bind is GET-only; start is an explicit button", () => {
  const empfehlungen = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  const verlauf = readFileSync(new URL("../../components/verlauf-page.tsx", import.meta.url), "utf8");
  assert.match(empfehlungen, /bindTrefferlisteForRegion/);
  assert.equal(empfehlungen.includes("createRecommendations"), false);
  const bindBlock = empfehlungen.slice(0, empfehlungen.indexOf("async function onStartAnalysis"));
  assert.equal(bindBlock.includes("createAnalysisRun"), false);
  assert.match(empfehlungen, /async function onStartAnalysis/);
  assert.match(empfehlungen, /createAnalysisRun/);
  assert.match(empfehlungen, /pollTrefferlisteRun/);
  assert.match(verlauf, /loadRecommendationsForRun/);
  assert.match(verlauf, /createRecommendations/);
  const afterBind = verlauf.slice(verlauf.indexOf("loadVerlaufPatternForMarkedRegion"));
  const verlaufBind = afterBind.slice(0, afterBind.indexOf("async function onCreate"));
  assert.match(verlaufBind, /loadRecommendationsForRun/);
  assert.equal(verlaufBind.includes("createRecommendations"), false);
  assert.ok(verlaufBind.indexOf("setBoundKey") < verlaufBind.indexOf("getAnalysisRun"));
  assert.ok(verlaufBind.indexOf("loadVerlaufPatternForMarkedRegion") < verlaufBind.indexOf("loadRecommendationsForRun"));
  assert.match(empfehlungen, /disabled=\{startLocked\}/);
  assert.match(empfehlungen, /RECOMMENDATION_COPY\.loadFailed/);
  assert.match(empfehlungen, /RunRegionLabel/);
  const karte = readFileSync(new URL("../../components/map-page.tsx", import.meta.url), "utf8");
  assert.match(karte, /loadRecommendationsForRun/);
  assert.match(karte, /loadPatternForMarkedRegion/);
  assert.equal(karte.includes("getRecommendations()"), false);
  assert.match(karte, /visibleHits\(set\?\.items/);
});

const markedLichterfelde: TargetRegion = {
  ...marked,
  label: "Lichterfelde",
  geoKey: "ortsteil:osm:55737",
  parentLabel: "Berlin",
  level: "ortsteil",
};

const markedTempelhof: TargetRegion = {
  ...marked,
  label: "Tempelhof",
  geoKey: "ortsteil:osm:162894",
  parentLabel: "Berlin",
  level: "ortsteil",
};

function hit(partial: Partial<Recommendation> & Pick<Recommendation, "id" | "rank" | "targetRegionGeoKey">): Recommendation {
  return {
    title: partial.title ?? "Treffer",
    kind: partial.kind ?? "lor",
    score: 1,
    rationale: "Am Standort passt das Muster.",
    criteriaEvidence: [],
    source: "heuristic",
    geometry: null,
    trend: { direction: "up", summary: "Einwohner steigt." },
    ...partial,
    location: {
      geoKey: partial.location?.geoKey ?? partial.id,
      grain: "other",
      lon: null,
      lat: null,
      name: partial.location?.name ?? "Treffer",
      ...partial.location,
    },
  };
}

test("Lichterfelde+Tempelhof set binds marked Tempelhof without startedRunId and keeps only those hits", async () => {
  const mixed: RecommendationSet = {
    ...koeln,
    id: "47",
    runId: "54",
    count: 2,
    targetRegions: [
      { geoKey: "55737", label: "Lichterfelde" },
      { geoKey: "162894", label: "Tempelhof" },
      { geoKey: "162900", label: "Mariendorf" },
      { geoKey: "55736", label: "Steglitz" },
      { geoKey: "55735", label: "Lankwitz" },
    ],
    items: [
      hit({
        id: "lor:plr:tempelhof-1",
        rank: 1,
        title: "Lichtenrade",
        targetRegionGeoKey: "ortsteil:osm:162894",
        location: { geoKey: "lor:plr:tempelhof-1", grain: "other", lon: null, lat: null, name: "Lichtenrade" },
      }),
      hit({
        id: "lor:plr:lichterfelde-1",
        rank: 1,
        title: "Botanischer Garten",
        targetRegionGeoKey: "ortsteil:osm:55737",
        location: { geoKey: "lor:plr:lichterfelde-1", grain: "other", lon: null, lat: null, name: "Botanischer Garten" },
      }),
    ],
  };
  const siblingRun = run({
    id: "54",
    status: "completed",
    input: {
      region: markedLichterfelde,
      regions: [markedLichterfelde, markedTempelhof],
      stores: [],
      revenueDirection: "flat",
      capturedAt: "2026-10-06T08:00:00.000Z",
    },
  });
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async (query) => {
        assert.equal(query?.geoKey, "ortsteil:osm:162894");
        return {
          runId: "54",
          createdAt: "2026-10-06T08:00:00.000Z",
          region: { label: "Lichterfelde", geoKey: "ortsteil:osm:55737", parentLabel: "Berlin" },
          pattern,
        };
      },
      getAnalysisRun: async (id) => {
        assert.equal(id, "54");
        return siblingRun;
      },
      getRecommendations: async (query) => {
        assert.equal(query?.runId, "54");
        return mixed;
      },
    },
    markedTempelhof,
  );
  assert.equal(next.kind, "ready");
  if (next.kind === "ready") {
    assert.equal(next.bound.runId, "54");
    assert.equal(next.bound.region.label, "Tempelhof");
    assert.equal(next.set?.id, "47");
    assert.deepEqual(
      visibleHits(next.set?.items ?? [], markedTempelhof).map((item) => item.location.name),
      ["Lichtenrade"],
    );
  }

  const foreign = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "99",
        createdAt: "2026-10-06T08:00:00.000Z",
        region: { label: "Tempelhof", geoKey: "ortsteil:osm:162894", parentLabel: "Berlin" },
        pattern,
      }),
      getAnalysisRun: async () =>
        run({
          id: "99",
          status: "completed",
          input: {
            region: markedLichterfelde,
            regions: [markedLichterfelde],
            stores: [],
            revenueDirection: "flat",
            capturedAt: "2026-10-06T08:00:00.000Z",
          },
        }),
      getRecommendations: async () => ({
        ...mixed,
        id: "100",
        runId: "99",
        targetRegions: [{ geoKey: "55737", label: "Lichterfelde" }],
        items: mixed.items.filter((item) => item.targetRegionGeoKey === "ortsteil:osm:55737"),
      }),
    },
    markedTempelhof,
  );
  assert.equal(foreign.kind, "empty");
});

test("a set that lists Tempelhof in targetRegions binds even when input.region is Lichterfelde", async () => {
  const setOnly: RecommendationSet = {
    ...koeln,
    id: "47",
    runId: "54",
    targetRegions: [
      { geoKey: "55737", label: "Lichterfelde" },
      { geoKey: "162894", label: "Tempelhof" },
    ],
    items: [
      hit({
        id: "lor:plr:tempelhof-1",
        rank: 1,
        title: "Lichtenrade",
        targetRegionGeoKey: "ortsteil:osm:162894",
        location: { geoKey: "lor:plr:tempelhof-1", grain: "other", lon: null, lat: null, name: "Lichtenrade" },
      }),
    ],
  };
  const next = await bindTrefferlisteForRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "54",
        createdAt: "2026-10-06T08:00:00.000Z",
        region: { label: "Lichterfelde", geoKey: "ortsteil:osm:55737", parentLabel: "Berlin" },
        pattern,
      }),
      getAnalysisRun: async () =>
        run({
          id: "54",
          status: "completed",
          input: {
            region: markedLichterfelde,
            regions: [markedLichterfelde],
            stores: [],
            revenueDirection: "flat",
            capturedAt: "2026-10-06T08:00:00.000Z",
          },
        }),
      getRecommendations: async () => setOnly,
    },
    markedTempelhof,
  );
  assert.equal(next.kind, "ready");
  if (next.kind === "ready") {
    assert.equal(next.bound.region.label, "Tempelhof");
    assert.deepEqual(
      visibleHits(next.set?.items ?? [], markedTempelhof).map((item) => item.location.name),
      ["Lichtenrade"],
    );
  }
});
