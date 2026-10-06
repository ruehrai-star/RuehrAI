import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AnalysisPattern, AnalysisRun } from "@ruehrai/api-contracts";
import { ApiError } from "../api/types.ts";
import type { RecommendationSet, TargetRegion } from "../api/types.ts";
import {
  bindTrefferlisteForRegion,
  loadRecommendationsForRun,
  pollTrefferlisteRun,
  recommendationSetForRun,
} from "./bind.ts";

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
