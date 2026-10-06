import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RecommendationEvidence } from "@ruehrai/api-contracts";
import {
  TWO_YEAR_TREND_LABEL,
  formatTwoYearTrendLabel,
  twoYearTrendLabelFromEvidence,
} from "./two-year-trend.ts";

const twoYearEvidence: RecommendationEvidence = {
  key: "einwohner",
  label: "Einwohner",
  direction: "up",
  patternDirection: "up",
  evidence: "Einwohner steigt zwischen 2024 und 2025.",
  kind: "trend",
  coverage: "series",
  scope: "local",
  trendYears: 2,
  points: [
    { period: "2024", status: "present", value: 10, normalizedValue: 10 },
    { period: "2025", status: "present", value: 12, normalizedValue: 12 },
  ],
};

test("Trend aus 2 Jahren uses official trendYears === 2 and never counts points", () => {
  const source = readFileSync(new URL("./two-year-trend.ts", import.meta.url), "utf8");
  assert.match(source, /trendYears/);
  assert.doesNotMatch(source, /points\.length/);
  assert.equal(TWO_YEAR_TREND_LABEL, "Trend aus 2 Jahren");
  assert.equal(formatTwoYearTrendLabel(true), "Trend aus 2 Jahren");
  assert.equal(formatTwoYearTrendLabel(false), null);
  assert.equal(twoYearTrendLabelFromEvidence(twoYearEvidence), "Trend aus 2 Jahren");
  assert.equal(twoYearTrendLabelFromEvidence({ ...twoYearEvidence, trendYears: 3 }), null);
  assert.equal(twoYearTrendLabelFromEvidence({ ...twoYearEvidence, trendYears: undefined }), null);
  assert.equal(twoYearTrendLabelFromEvidence(undefined), null);
  assert.equal(
    twoYearTrendLabelFromEvidence({ ...twoYearEvidence, coverage: "single", kind: "stichtag", trendYears: 2 }),
    null,
  );
});

test("two present years without trendYears do not invent the label", () => {
  assert.equal(
    twoYearTrendLabelFromEvidence({
      key: twoYearEvidence.key,
      label: twoYearEvidence.label,
      direction: twoYearEvidence.direction,
      patternDirection: twoYearEvidence.patternDirection,
      evidence: twoYearEvidence.evidence,
      kind: twoYearEvidence.kind,
      coverage: twoYearEvidence.coverage,
      scope: twoYearEvidence.scope,
      points: twoYearEvidence.points,
    }),
    null,
  );
});
