import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalysisPattern, AnalysisRun, YearlySeries } from "@ruehrai/api-contracts";
import { ApiError, type AnalysisPatternResponse, type TargetRegion } from "../api/types.ts";
import {
  bindPatternToMarkedRegion,
  formatStandLine,
  isVerlaufBindTimeout,
  loadPatternForMarkedRegion,
  loadVerlaufPatternForMarkedRegion,
  markedStandRegions,
  patternMatchesMarkedRegion,
  patternQueryGeoKey,
  runIsForMarkedRegion,
  runMatchesMarkedRegion,
  standRegionLabel,
  VERLAUF_BIND_TIMEOUT_MS,
  yearlySeriesForRegion,
} from "./bind.ts";
import { VERLAUF_COPY } from "./model.ts";

const lankwitz: TargetRegion = {
  label: "Lankwitz",
  grain: "other",
  geoKey: "ortsteil:osm:5712247",
  level: "ortsteil",
  parentLabel: "Berlin",
  lon: null,
  lat: null,
  bounds: null,
  geometry: null,
  updatedAt: "2026-10-05T12:00:00.000Z",
};

const munich: TargetRegion = {
  label: "München",
  grain: "ags",
  geoKey: "09162000",
  ags: "09162000",
  level: "gemeinde",
  lon: null,
  lat: null,
  bounds: null,
  geometry: null,
  updatedAt: "2026-10-05T12:00:00.000Z",
};

const pattern: AnalysisPattern = {
  source: "heuristic",
  summary: "Die Kleinraumkriterien steigen in der Zielregion.",
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

function seriesFor(geoKey: string, extra?: Partial<YearlySeries>): YearlySeries {
  return {
    metricId: "bevoelkerung",
    requestedLevel: "ortsteil",
    requestedGeoKey: geoKey,
    sourceLevel: "ortsteil",
    sourceGeoKey: geoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: 1000 },
      { period: "2025", status: "present", value: 1100 },
    ],
    ...extra,
  };
}

function runFor(region: TargetRegion, regions?: TargetRegion[]): AnalysisRun {
  return {
    id: "7",
    status: "completed",
    createdAt: "2026-10-05T16:37:00.000Z",
    input: {
      region,
      regions,
      stores: [],
      revenueDirection: "up",
      capturedAt: "2026-10-05T16:37:00.000Z",
    },
    brain: { mode: "sql", vectorUnavailableReason: "embeddings_unreachable", factCount: 0, facts: [] },
    pattern,
  };
}

test("Stand line uses de-DE date and Name (Gemeinde) when parentLabel is present", () => {
  const line = formatStandLine("2026-10-05T16:37:00.000Z", lankwitz);
  assert.match(line, /^Stand: Lauf vom /);
  assert.match(line, / für Lankwitz \(Berlin\)$/);
  assert.match(line, /05\.10\.2026/);
  assert.match(line, /18:37/);
  assert.equal(standRegionLabel(lankwitz), "Lankwitz (Berlin)");
});

test("Stand line uses the name alone when parentLabel is missing", () => {
  assert.equal(standRegionLabel(munich), "München");
  const line = formatStandLine("2026-10-05T16:37:00.000Z", munich);
  assert.match(line, /^Stand: Lauf vom /);
  assert.match(line, / für München$/);
  assert.match(line, /05\.10\.2026/);
  assert.doesNotMatch(line, /parentLabel|09162000|Gemeinde/);
});

test("empty and start copy stay exact Variante A strings", () => {
  assert.equal(VERLAUF_COPY.missingRun, "Für diese Zielregion liegt noch kein Analyselauf vor.");
  assert.equal(VERLAUF_COPY.startAnalysis, "Musteranalyse starten");
  assert.equal(VERLAUF_COPY.analysisRunning, "Analyse läuft …");
  assert.equal(VERLAUF_COPY.analysisFailed, "Analyse fehlgeschlagen.");
  assert.equal(VERLAUF_COPY.loadFailed, "Der Stand konnte gerade nicht geladen werden.");
  assert.equal(VERLAUF_COPY.bindFailed, "Der Verlauf konnte nicht geladen werden.");
  assert.equal(VERLAUF_COPY.retryLoad, "Erneut versuchen");
});

test("query geoKey is the stored catalog key and missing keys stay empty", () => {
  assert.equal(patternQueryGeoKey(lankwitz), "ortsteil:osm:5712247");
  assert.equal(patternQueryGeoKey({ label: "Ohne Schlüssel" }), null);
  assert.equal(patternQueryGeoKey({ label: "Leer", geoKey: "  " }), null);
  assert.equal(patternQueryGeoKey(null), null);
});

test("a matching region on the pattern binds and drops other yearlySeries", () => {
  const latest: AnalysisPatternResponse = {
    runId: "7",
    createdAt: "2026-10-05T16:37:00.000Z",
    region: { label: "Lankwitz", geoKey: "ortsteil:osm:5712247", level: "ortsteil", parentLabel: "Berlin" },
    pattern: {
      ...pattern,
      yearlySeries: [seriesFor("ortsteil:osm:5712247"), seriesFor("09162000", { requestedLevel: "gemeinde" })],
    },
  };
  const bound = bindPatternToMarkedRegion({ latest, marked: lankwitz });
  assert.ok(bound);
  assert.equal(bound.runId, "7");
  assert.deepEqual(
    bound.pattern.yearlySeries?.map((item) => item.requestedGeoKey),
    ["ortsteil:osm:5712247"],
  );
  assert.equal(patternMatchesMarkedRegion(latest.region, lankwitz), true);
});

test("a pattern for another region is a mismatch, not a silent fallback", () => {
  const latest: AnalysisPatternResponse = {
    runId: "7",
    createdAt: "2026-10-05T16:37:00.000Z",
    region: { label: "München", geoKey: "09162000", level: "gemeinde" },
    pattern,
  };
  assert.equal(bindPatternToMarkedRegion({ latest, marked: lankwitz }), null);
  assert.equal(patternMatchesMarkedRegion(latest.region, lankwitz), false);
});

test("without region on the pattern the run snapshot must contain the marked key", () => {
  const latest: AnalysisPatternResponse = {
    runId: "7",
    createdAt: "2026-10-05T16:37:00.000Z",
    pattern: { ...pattern, yearlySeries: [seriesFor("ortsteil:osm:5712247")] },
  };
  assert.equal(bindPatternToMarkedRegion({ latest, marked: lankwitz }), null);
  assert.ok(bindPatternToMarkedRegion({ latest, run: runFor(lankwitz, [lankwitz, munich]), marked: lankwitz }));
  assert.equal(bindPatternToMarkedRegion({ latest, run: runFor(munich, [munich]), marked: lankwitz }), null);
  assert.equal(runMatchesMarkedRegion(runFor(munich), lankwitz), false);
  assert.equal(runMatchesMarkedRegion(runFor(munich, [munich, lankwitz]), lankwitz), true);
});

test("Berlin alias keys on the run still match the marked Zielregion", () => {
  const marked = { ...lankwitz, geoKey: "ags:11000007" };
  const run = runFor({ ...lankwitz, geoKey: "11000007" });
  assert.equal(runMatchesMarkedRegion(run, marked), true);
  assert.equal(
    yearlySeriesForRegion([seriesFor("11000007"), seriesFor("09162000")], marked)?.map((item) => item.requestedGeoKey)
      .length,
    1,
  );
});

test("loadPatternForMarkedRegion sends geoKey and treats 404 as empty", async () => {
  const seen: string[] = [];
  const empty = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async (query) => {
        seen.push(query?.geoKey ?? "");
        return null;
      },
      getAnalysisRun: async () => {
        throw new Error("must not load the latest run of another region");
      },
    },
    lankwitz,
  );
  assert.equal(empty, null);
  assert.deepEqual(seen, ["ortsteil:osm:5712247"]);

  const none = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async () => {
        throw new Error("must not call without geoKey");
      },
      getAnalysisRun: async () => {
        throw new Error("must not call without geoKey");
      },
    },
    { label: "Ohne Schlüssel" },
  );
  assert.equal(none, null);
});

test("loadPatternForMarkedRegion does not use a mismatched latest run", async () => {
  const bound = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "7",
        createdAt: "2026-10-05T16:37:00.000Z",
        region: { label: "München", geoKey: "09162000" },
        pattern,
      }),
      getAnalysisRun: async () => runFor(munich),
    },
    lankwitz,
  );
  assert.equal(bound, null);
});

test("loadPatternForMarkedRegion verifies the run when region is omitted", async () => {
  const bound = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "7",
        createdAt: "2026-10-05T16:37:00.000Z",
        pattern: { ...pattern, yearlySeries: [seriesFor("ortsteil:osm:5712247")] },
      }),
      getAnalysisRun: async (id) => {
        assert.equal(id, "7");
        return runFor(lankwitz);
      },
    },
    lankwitz,
  );
  assert.ok(bound);
  assert.equal(bound.region.label, "Lankwitz");
  assert.equal(formatStandLine(bound.createdAt, bound.region), formatStandLine(bound.createdAt, lankwitz));
  assert.equal(bound.regions.length, 1);
});

test("a run with six Zielregionen labels all of them on the Stand line", async () => {
  const six = [
    { ...lankwitz, label: "Innenstadt", geoKey: "stadtbezirk:koeln:innenstadt", level: "bezirk" as const, parentLabel: "Köln" },
    { ...lankwitz, label: "Rodenkirchen", geoKey: "stadtbezirk:koeln:rodenkirchen", parentLabel: "Köln" },
    { ...lankwitz, label: "Lindenthal", geoKey: "stadtbezirk:koeln:lindenthal", parentLabel: "Köln" },
    { ...lankwitz, label: "Ehrenfeld", geoKey: "stadtbezirk:koeln:ehrenfeld", parentLabel: "Köln" },
    { ...lankwitz, label: "Nippes", geoKey: "stadtbezirk:koeln:nippes", parentLabel: "Köln" },
    { ...lankwitz, label: "Chorweiler", geoKey: "stadtbezirk:koeln:chorweiler", parentLabel: "Köln" },
  ];
  const bound = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "41",
        createdAt: "2026-10-05T16:37:00.000Z",
        region: six[0],
        pattern,
      }),
      getAnalysisRun: async () => runFor(six[0]!, six),
    },
    six[0]!,
  );
  assert.ok(bound);
  assert.equal(bound.regions.length, 6);
  assert.equal(formatStandLine(bound.createdAt, bound.regions), formatStandLine(bound.createdAt, six));
  assert.match(formatStandLine(bound.createdAt, bound.regions), /Innenstadt \(Köln\) \+ 5 weitere$/);
});

test("a sibling snapshot binds the marked region without startedRunId", async () => {
  const tempelhof = { ...lankwitz, label: "Tempelhof", geoKey: "ortsteil:osm:162894" };
  const lichterfelde = { ...lankwitz, label: "Lichterfelde", geoKey: "ortsteil:osm:55737" };
  const snapshot = runFor(lichterfelde, [lichterfelde, tempelhof]);
  const bound = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "54",
        createdAt: "2026-10-06T10:48:34.255Z",
        region: { label: "Lichterfelde", geoKey: "ortsteil:osm:55737", parentLabel: "Berlin" },
        pattern,
      }),
      getAnalysisRun: async () => ({ ...snapshot, id: "54" }),
    },
    tempelhof,
  );
  assert.ok(bound);
  assert.equal(bound.runId, "54");
  assert.equal(bound.region.label, "Tempelhof");
  assert.equal(runIsForMarkedRegion(snapshot, tempelhof), true);
  assert.equal(runMatchesMarkedRegion(snapshot, tempelhof), true);
  assert.equal(runIsForMarkedRegion(snapshot, tempelhof, "47"), true);
  assert.equal(runIsForMarkedRegion({ ...snapshot, id: "54" }, tempelhof, "54"), true);
  assert.equal(runIsForMarkedRegion(runFor(munich, [munich]), tempelhof), false);
  assert.equal(runIsForMarkedRegion(runFor(munich, [munich]), tempelhof, "7"), false);

  const foreign = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "7",
        createdAt: "2026-10-06T10:48:34.255Z",
        region: { label: "Tempelhof", geoKey: "ortsteil:osm:162894", parentLabel: "Berlin" },
        pattern,
      }),
      getAnalysisRun: async () => runFor(munich, [munich]),
    },
    tempelhof,
  );
  assert.equal(foreign, null);
});

test("Stand for the marked region stays singular and does not use another name", async () => {
  const bound = await loadPatternForMarkedRegion(
    {
      getAnalysisPattern: async () => ({
        runId: "7",
        createdAt: "2026-10-05T16:37:00.000Z",
        region: { label: "Lankwitz", geoKey: "ortsteil:osm:5712247", parentLabel: "Berlin" },
        pattern,
      }),
      getAnalysisRun: async () => runFor(lankwitz, [lankwitz, munich]),
    },
    lankwitz,
  );
  assert.ok(bound);
  const stand = markedStandRegions(bound, lankwitz);
  assert.equal(stand.length, 1);
  assert.equal(stand[0]?.label, "Lankwitz");
  assert.equal(formatStandLine(bound.createdAt, stand).includes("München"), false);
});

test("a 500 from the run lookup is not turned into another region's series", async () => {
  await assert.rejects(
    loadPatternForMarkedRegion(
      {
        getAnalysisPattern: async () => ({
          runId: "7",
          createdAt: "2026-10-05T16:37:00.000Z",
          pattern,
        }),
        getAnalysisRun: async () => {
          throw new ApiError("Backend nicht erreichbar.", 500);
        },
      },
      lankwitz,
    ),
    (error: unknown) => error instanceof ApiError && error.status === 500,
  );
});

test("Verlauf binds from GET /analysis/pattern without waiting for the run", async () => {
  const bound = await loadVerlaufPatternForMarkedRegion(
    {
      getAnalysisPattern: async (query) => {
        assert.equal(query?.geoKey, "ortsteil:osm:5712247");
        return {
          runId: "7",
          createdAt: "2026-10-05T16:37:00.000Z",
          region: { label: "Lankwitz", geoKey: "ortsteil:osm:5712247", parentLabel: "Berlin" },
          pattern: { ...pattern, yearlySeries: [seriesFor("ortsteil:osm:5712247")] },
        };
      },
    },
    lankwitz,
  );
  assert.ok(bound);
  assert.equal(bound.runId, "7");
  assert.equal(bound.region.label, "Lankwitz");
  assert.equal(VERLAUF_BIND_TIMEOUT_MS, 30_000);
});

test("Verlauf pattern bind times out instead of hanging", async () => {
  let release: ((value: null) => void) | undefined;
  const hang = new Promise<null>((resolve) => {
    release = resolve;
  });
  await assert.rejects(
    loadVerlaufPatternForMarkedRegion(
      {
        getAnalysisPattern: async () => hang,
      },
      lankwitz,
      { timeoutMs: 20 },
    ),
    (error: unknown) => isVerlaufBindTimeout(error),
  );
  release?.(null);
  await hang;
});
