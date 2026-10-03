import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AnalysisPattern,
  MonthlyRevenuePoint,
  Recommendation,
  RecommendationSet,
  TargetRegion,
} from "@ruehrai/api-contracts";
import { grainLabel } from "../format.ts";
import {
  MISSING_CONTRACT_FIELD,
  POST_STANDORTE_HREF,
  SELECTABLE_AREA_LEVELS,
  VERLAUF_COPY,
  buildVerlaufHero,
  isPostStandorteMap,
  monthRow,
  municipalityNeedsSubarea,
  optionalRevenueCount,
  regionView,
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

function setWith(items: Recommendation[]): RecommendationSet {
  return {
    id: "3",
    runId: "15",
    createdAt: "2026-10-03T12:00:00.000Z",
    window: { from: "2026-04", to: "2026-09" },
    count: items.length,
    reason: null,
    pattern,
    items,
  };
}

const banned = /Frequenz|Miete|München|09162000|demo-gemeinden|Beschäftigte im Block|Könneritzstraße|409|441|478/i;

test("after Standorte the path is Verlauf, not the map", () => {
  assert.equal(POST_STANDORTE_HREF, "/verlauf");
  assert.notEqual(POST_STANDORTE_HREF, "/");
  assert.equal(isPostStandorteMap(), false);
  assert.equal(VERLAUF_COPY.title, "Verlauf");
  assert.equal(VERLAUF_COPY.heroHeading, "Abgeleitetes Muster");
  assert.equal(VERLAUF_COPY.top3, "Top 3 in Ihrer Zielregion");
});

test("the hero is the change and the next step from real fields, not revenue", () => {
  const revenue: MonthlyRevenuePoint[] = [
    { year: 2025, month: 1, revenueEur: 88000, updatedAt: "2026-10-03T12:00:00.000Z" },
  ];
  const hero = buildVerlaufHero({
    pattern,
    recommendations: setWith([item]),
    revenue,
  });
  assert.ok(hero);
  assert.equal(hero.change, "Die Kleinraumkriterien steigen in der Zielregion.");
  assert.equal(hero.engine, "pattern");
  assert.equal(hero.hasYearlySeries, false);
  assert.equal(hero.missingContractField, MISSING_CONTRACT_FIELD);
  assert.equal(MISSING_CONTRACT_FIELD, "AnalysisPattern.yearlySeries");
  assert.equal(hero.nextSentence, item.rationale);
  assert.equal(hero.nextAddress, "Nordstraße 12, Mitte");
  assert.equal(hero.top3[0]?.address, "Nordstraße 12, Mitte");
  assert.doesNotMatch(hero.change, /88000/);
  assert.doesNotMatch(JSON.stringify(hero), banned);
  assert.equal(optionalRevenueCount(revenue), 1);
});

test("without a pattern there is no invented yearly series", () => {
  assert.equal(buildVerlaufHero({ pattern: null, recommendations: null }), null);
  const hero = buildVerlaufHero({ pattern, recommendations: null });
  assert.ok(hero);
  assert.equal(hero.hasYearlySeries, false);
  assert.deepEqual(hero.months, []);
  assert.equal(hero.nextSentence, null);
  assert.equal(hero.top3.length, 0);
  assert.doesNotMatch(hero.change, /2023|2024|2025/);
});

test("months from the recommendation window are a thin row, not a table", () => {
  assert.deepEqual(monthRow({ from: "2026-04", to: "2026-09" }), ["Apr", "Mai", "Jun", "Jul", "Aug", "Sep"]);
  assert.deepEqual(monthRow(null), []);
  const hero = buildVerlaufHero({ pattern, recommendations: setWith([item]) });
  assert.ok(hero);
  assert.deepEqual(hero.months, ["Apr", "Mai", "Jun", "Jul", "Aug", "Sep"]);
});

test("street addresses come from the recommendation title when the API sends one", () => {
  assert.equal(streetAddress(item), "Nordstraße 12, Mitte");
  assert.equal(streetAddress({ ...item, title: "Nordstraße 12", location: { ...item.location, name: "Nordstraße 12" } }), "Nordstraße 12");
});

test("Stadtbezirk, Stadtteil, Ortsteil and PLZ stay selectable and Gemeinde stays a municipality", () => {
  assert.deepEqual(SELECTABLE_AREA_LEVELS, ["Stadtbezirk", "Stadtteil", "Ortsteil", "PLZ"]);
  assert.equal(municipalityNeedsSubarea(), false);
  const gemeinde = regionView({
    label: "Nordstadt",
    grain: "ags",
    geoKey: "11000000",
    ags: "11000000",
    lon: null,
    lat: null,
    updatedAt: "2026-10-03T12:00:00.000Z",
  } as TargetRegion);
  assert.equal(gemeinde.badge, "Gemeinde");
  assert.equal(gemeinde.error, null);
  assert.equal(grainLabel("ags", "11000001"), "Bezirk");
  assert.equal(grainLabel("ags", "11000012"), "Bezirk");
  assert.equal(regionView(null).error, null);
});

test("Verlauf copy keeps Frequenz, Miete, München and demo layers out", () => {
  assert.doesNotMatch(JSON.stringify(VERLAUF_COPY), banned);
  assert.match(VERLAUF_COPY.revenueOptional, /optional/);
  assert.match(VERLAUF_COPY.levels, /Ortsteil/);
});
