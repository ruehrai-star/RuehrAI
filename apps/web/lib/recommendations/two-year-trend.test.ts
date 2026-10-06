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
  points: [
    { period: "2024", status: "present", value: 10, normalizedValue: 10 },
    { period: "2025", status: "present", value: 12, normalizedValue: 12 },
  ],
};

test("Trend aus 2 Jahren is the exact UI text when the flag is set", () => {
  assert.equal(TWO_YEAR_TREND_LABEL, "Trend aus 2 Jahren");
  assert.equal(formatTwoYearTrendLabel(true), "Trend aus 2 Jahren");
  assert.equal(formatTwoYearTrendLabel(false), null);
});

test("adapter waits on the #79 contract field and does not invent a name or count points", () => {
  const source = readFileSync(new URL("./two-year-trend.ts", import.meta.url), "utf8");
  assert.match(source, /TODO\(#79\)/);
  assert.doesNotMatch(source, /evidence\.\w+/);
  assert.doesNotMatch(source, /points\.length/);
  assert.equal(twoYearTrendLabelFromEvidence(twoYearEvidence), null);
  assert.equal(twoYearTrendLabelFromEvidence(undefined), null);
  assert.equal(twoYearTrendLabelFromEvidence({ ...twoYearEvidence, coverage: "single", kind: "stichtag" }), null);
});
