import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RecommendationSet } from "../api/types.ts";
import { loadRecommendationsForRun, recommendationSetForRun } from "./bind.ts";

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

test("Trefferliste and Verlauf bind hits by runId without POST on open or region switch", () => {
  const empfehlungen = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  const verlauf = readFileSync(new URL("../../components/verlauf-page.tsx", import.meta.url), "utf8");
  assert.match(empfehlungen, /loadRecommendationsForRun/);
  assert.equal(empfehlungen.includes("createRecommendations"), false);
  assert.match(verlauf, /loadRecommendationsForRun/);
  assert.match(verlauf, /createRecommendations/);
  const afterBind = verlauf.slice(verlauf.indexOf("loadPatternForMarkedRegion"));
  const bindBlock = afterBind.slice(0, afterBind.indexOf("async function onCreate"));
  assert.match(bindBlock, /loadRecommendationsForRun/);
  assert.equal(bindBlock.includes("createRecommendations"), false);
});
