import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type {
  AnalysisPattern,
  MonthlyRevenuePoint,
  Recommendation,
  RecommendationSet,
  TargetRegion,
  YearlySeries,
} from "@ruehrai/api-contracts";
import { catalogBadge } from "../format.ts";
import {
  ABSENT_LABEL,
  POST_STANDORTE_HREF,
  SELECTABLE_AREA_LEVELS,
  VERLAUF_COPY,
  buildVerlaufHero,
  isPostStandorteMap,
  kleinraumSeries,
  monthRow,
  municipalityNeedsSubarea,
  optionalRevenueCount,
  regionView,
  sourceAttribution,
  streetAddress,
} from "./model.ts";

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

const item: Recommendation = {
  id: "address:nord-1",
  rank: 1,
  title: "Nordstraße 12",
  location: { geoKey: "nord-1", grain: "address", lon: 13.4, lat: 52.5, name: "Mitte" },
  score: 1,
  rationale: "Die vorliegenden Monate liegen über dem bisherigen Verlauf.",
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
};

function setWith(items: Recommendation[], extra?: Partial<AnalysisPattern>): RecommendationSet {
  return {
    id: "3",
    runId: "15",
    createdAt: "2026-10-03T12:00:00.000Z",
    window: { from: "2026-04", to: "2026-09" },
    count: items.length,
    reason: null,
    pattern: { ...pattern, ...extra },
    items,
  };
}

function series(partial: Partial<YearlySeries> & Pick<YearlySeries, "metricId" | "coverage" | "points">): YearlySeries {
  return {
    requestedLevel: "ortsteil",
    requestedGeoKey: "ortsteil:osm:1",
    sourceLevel: "ortsteil",
    sourceGeoKey: "ortsteil:osm:1",
    granularity: "year",
    ...partial,
  };
}

const banned = /Frequenz|Miete|München|09162000|demo-gemeinden|Beschäftigte im Block|Könneritzstraße|409|441|478/i;

test("after Standorte the path is Verlauf, not the map", () => {
  assert.equal(POST_STANDORTE_HREF, "/verlauf");
  assert.notEqual(POST_STANDORTE_HREF, "/");
  assert.equal(isPostStandorteMap(), false);
  assert.equal(VERLAUF_COPY.title, "Verlauf");
  assert.equal(VERLAUF_COPY.heroHeading, "Veränderung der Kleinraumdaten");
  assert.equal(VERLAUF_COPY.top3, "Top 3 in Ihrer Zielregion");
  assert.equal(VERLAUF_COPY.missingRun, "Für diese Zielregion liegt noch kein Analyselauf vor.");
  assert.equal(VERLAUF_COPY.startAnalysis, "Musteranalyse starten");
});

test("multi coverage draws a trend from present points only", () => {
  const yearlySeries: YearlySeries[] = [
    series({
      metricId: "bevoelkerung",
      coverage: "multi",
      points: [
        { period: "2023", status: "present", value: 1000 },
        { period: "2024", status: "absent" },
        { period: "2025", status: "present", value: 1200 },
      ],
    }),
  ];
  const hero = buildVerlaufHero({
    pattern: { ...pattern, yearlySeries },
    recommendations: setWith([item], { yearlySeries }),
  });
  assert.ok(hero);
  assert.equal(hero.engine, "yearlySeries");
  assert.equal(hero.hasYearlySeries, true);
  assert.equal(hero.change, "Bevölkerung: 1.000 (2023) → 1.200 (2025)");
  assert.equal(hero.series[0]?.showTrend, true);
  assert.equal(hero.series[0]?.points[1]?.display, ABSENT_LABEL);
  assert.equal(hero.series[0]?.points[1]?.value, undefined);
  assert.equal(hero.nextSentence, item.rationale);
  assert.doesNotMatch(JSON.stringify(hero), banned);
});

test("coverage single shows the present point and does not draw a trend", () => {
  const yearlySeries: YearlySeries[] = [
    series({
      metricId: "pendler",
      coverage: "single",
      requestedLevel: "stadtteil",
      requestedGeoKey: "stadtteil:1",
      sourceLevel: "gemeinde",
      sourceGeoKey: "11000000",
      points: [
        { period: "2023", status: "absent" },
        { period: "2024", status: "present", value: 12 },
        { period: "2025", status: "absent" },
      ],
    }),
  ];
  const hero = buildVerlaufHero({ pattern: { ...pattern, yearlySeries }, recommendations: null });
  assert.ok(hero);
  assert.equal(hero.change, VERLAUF_COPY.noTrend);
  assert.equal(hero.series[0]?.showTrend, false);
  assert.equal(hero.series[0]?.points[1]?.display, "12");
  assert.equal(hero.series[0]?.sourceNote, "Gemeindewerte, nicht lokale Werte der gewählten Ebene (Stadtteil).");
  assert.doesNotMatch(hero.change, /→/);
  assert.doesNotMatch(JSON.stringify(hero.series), /Steigung|Trendlinie/);
});

test("coverage none and absent points say liegt nicht vor, never 0, null, or {}", () => {
  const yearlySeries: YearlySeries[] = [
    series({
      metricId: "arbeitsmarkt",
      coverage: "none",
      points: [
        { period: "2023", status: "absent" },
        { period: "2024", status: "absent" },
        { period: "2025", status: "absent" },
      ],
    }),
  ];
  const hero = buildVerlaufHero({ pattern: { ...pattern, yearlySeries }, recommendations: null });
  assert.ok(hero);
  assert.equal(hero.change, VERLAUF_COPY.noPoints);
  assert.equal(hero.series[0]?.showTrend, false);
  for (const point of hero.series[0]?.points ?? []) {
    assert.equal(point.status, "absent");
    assert.equal(point.display, "liegt nicht vor");
    assert.equal(point.value, undefined);
  }
  const dumped = JSON.stringify(hero.series);
  assert.doesNotMatch(dumped, /"value":0/);
  assert.doesNotMatch(dumped, /"display":"0"/);
  assert.doesNotMatch(dumped, /"display":"null"/);
  assert.doesNotMatch(dumped, /"display":\{\}/);
});

test("a stored 0 is present and is not treated as fehlt", () => {
  const yearlySeries: YearlySeries[] = [
    series({
      metricId: "bevoelkerung",
      coverage: "single",
      points: [{ period: "2024", status: "present", value: 0 }],
    }),
  ];
  const hero = buildVerlaufHero({ pattern: { ...pattern, yearlySeries }, recommendations: null });
  assert.ok(hero);
  assert.equal(hero.series[0]?.points[0]?.status, "present");
  assert.equal(hero.series[0]?.points[0]?.display, "0");
  assert.equal(hero.series[0]?.points[0]?.value, 0);
  assert.notEqual(hero.series[0]?.points[0]?.display, ABSENT_LABEL);
});

test("sourceLevel kreis on a PLZ request is labeled as Kreiswerte", () => {
  assert.equal(
    sourceAttribution({ requestedLevel: "plz", sourceLevel: "kreis" }),
    "Kreiswerte, nicht lokale Werte der gewählten Ebene (PLZ).",
  );
  assert.equal(sourceAttribution({ requestedLevel: "gemeinde", sourceLevel: "gemeinde" }), null);
  assert.equal(sourceAttribution({ requestedLevel: "kreis", sourceLevel: "kreis" }), null);
});

test("store monthly revenue is not part of yearlySeries", () => {
  const yearlySeries: YearlySeries[] = [
    series({
      metricId: "bevoelkerung",
      coverage: "single",
      points: [{ period: "2024", status: "present", value: 3 }],
    }),
    series({
      metricId: "umsatz",
      coverage: "multi",
      points: [
        { period: "2023", status: "present", value: 88000 },
        { period: "2025", status: "present", value: 99000 },
      ],
    }),
    series({
      metricId: "app.store_monthly_revenue",
      coverage: "multi",
      points: [
        { period: "2023", status: "present", value: 1 },
        { period: "2025", status: "present", value: 2 },
      ],
    }),
  ];
  const views = kleinraumSeries(yearlySeries);
  assert.deepEqual(
    views.map((item) => item.metricId),
    ["bevoelkerung"],
  );
  const revenue: MonthlyRevenuePoint[] = [
    { year: 2025, month: 1, revenueEur: 88000, updatedAt: "2026-10-03T12:00:00.000Z" },
  ];
  const hero = buildVerlaufHero({
    pattern: { ...pattern, yearlySeries },
    recommendations: setWith([item], { yearlySeries }),
    revenue,
  });
  assert.ok(hero);
  assert.doesNotMatch(hero.change, /88000|99000/);
  assert.equal(optionalRevenueCount(revenue), 1);
  assert.equal(
    hero.series.some((item) => item.metricId === "umsatz" || item.metricId === "app.store_monthly_revenue"),
    false,
  );
});

test("without yearlySeries the hero invents no yearly means or dataset names", () => {
  assert.equal(buildVerlaufHero({ pattern: null, recommendations: null }), null);
  const hero = buildVerlaufHero({ pattern, recommendations: null });
  assert.ok(hero);
  assert.equal(hero.hasYearlySeries, false);
  assert.equal(hero.engine, "pattern");
  assert.deepEqual(hero.series, []);
  assert.deepEqual(hero.months, []);
  assert.equal(hero.change, pattern.summary);
  assert.doesNotMatch(hero.change, /2023|2024|2025/);
  assert.doesNotMatch(JSON.stringify(hero), /yearlySeries fehlt|MISSING_CONTRACT|Beschäftigte/);
});

test("months from the recommendation window are a thin row, not a table", () => {
  assert.deepEqual(monthRow({ from: "2026-04", to: "2026-09" }), ["Apr", "Mai", "Jun", "Jul", "Aug", "Sep"]);
  assert.deepEqual(monthRow(null), []);
});

test("street addresses come from the recommendation title when the API sends one", () => {
  assert.equal(streetAddress(item), "Nordstraße 12, Mitte");
  assert.equal(
    streetAddress({ ...item, title: "Nordstraße 12", location: { ...item.location, name: "Nordstraße 12" } }),
    "Nordstraße 12",
  );
});

test("Stadtbezirk, Stadtteil, Ortsteil and PLZ stay selectable and Gemeinde stays a municipality", () => {
  assert.deepEqual(SELECTABLE_AREA_LEVELS, ["Stadtbezirk", "Stadtteil", "Ortsteil", "PLZ"]);
  assert.equal(municipalityNeedsSubarea(), false);
  const gemeinde = regionView({
    label: "Nordstadt",
    grain: "ags",
    geoKey: "11000000",
    ags: "11000000",
    level: "gemeinde",
    lon: null,
    lat: null,
    updatedAt: "2026-10-03T12:00:00.000Z",
  } as TargetRegion);
  assert.equal(gemeinde.badge, "Gemeinde");
  assert.equal(gemeinde.error, null);
  assert.equal(catalogBadge({ level: "bezirk", grain: "ags", geoKey: "11000001" }), "Bezirk");
  assert.equal(regionView(null).error, null);
});

test("Verlauf copy keeps Frequenz, Miete, München and demo layers out", () => {
  assert.doesNotMatch(JSON.stringify(VERLAUF_COPY), banned);
  assert.match(VERLAUF_COPY.revenueOptional, /optional/);
  assert.match(VERLAUF_COPY.levels, /Ortsteil/);
  assert.equal(ABSENT_LABEL, "liegt nicht vor");
});

test("Verlauf page and proof map do not load demo-gemeinden", () => {
  const page = readFileSync(new URL("../../components/verlauf-page.tsx", import.meta.url), "utf8");
  const proof = readFileSync(new URL("../../components/proof-map.tsx", import.meta.url), "utf8");
  const standorte = readFileSync(new URL("../../components/standorte-page.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("demo-gemeinden"), false);
  assert.equal(page.includes("DEFAULT_LAYER_ID"), false);
  assert.equal(proof.includes("demo-gemeinden"), false);
  assert.equal(proof.includes("DEFAULT_LAYER_ID"), false);
  assert.match(standorte, /POST_STANDORTE_HREF/);
  assert.match(standorte, />\s*Verlauf\s*</);
  assert.match(page, /VERLAUF_COPY\.missingRun/);
  assert.match(page, /VERLAUF_COPY\.startAnalysis/);
  assert.match(page, /loadPatternForMarkedRegion/);
  assert.equal(page.includes("createAnalysisRun"), false);
});
