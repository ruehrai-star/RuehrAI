import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecommendationEvidence } from "@ruehrai/api-contracts";
import {
  PROXIMITY_COPY,
  PROXIMITY_HIGH,
  PROXIMITY_MEDIUM,
  proximityBand,
  proximityLabel,
  proximityLabelFromEvidence,
} from "./proximity.ts";

const evidence = (partial: Partial<RecommendationEvidence> = {}): RecommendationEvidence => ({
  key: "einwohner",
  label: "Einwohner",
  direction: "up",
  patternDirection: "up",
  evidence: "Einwohner steigt in den letzten drei Jahren.",
  kind: "trend",
  coverage: "series",
  scope: "local",
  ...partial,
});

function assertNoRawNumber(text: string, value: number): void {
  const variants = new Set([
    String(value),
    String(value).replace(".", ","),
    new Intl.NumberFormat("de-DE").format(value),
    new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 }).format(value),
  ]);
  for (const variant of variants) {
    assert.equal(text.includes(variant), false, `${text} leaked ${variant}`);
  }
}

test("proximity bands use 0.67 and 0.34 inclusive; 0.33 is gering", () => {
  assert.equal(PROXIMITY_HIGH, 0.67);
  assert.equal(PROXIMITY_MEDIUM, 0.34);
  assert.equal(proximityBand(1), PROXIMITY_COPY.high);
  assert.equal(proximityBand(0.67), PROXIMITY_COPY.high);
  assert.equal(proximityBand(0.669), PROXIMITY_COPY.medium);
  assert.equal(proximityBand(0.34), PROXIMITY_COPY.medium);
  assert.equal(proximityBand(0.33), PROXIMITY_COPY.low);
  assert.equal(proximityBand(0), PROXIMITY_COPY.low);
});

test("liegt nicht vor only for absent evidence; inherited and neutral omit the line", () => {
  assert.equal(proximityLabelFromEvidence(undefined), "Nähe zum Filialmuster: liegt nicht vor");
  assert.equal(
    proximityLabelFromEvidence(evidence({ kind: "absent", coverage: "none", evidence: "liegt nicht vor" })),
    "Nähe zum Filialmuster: liegt nicht vor",
  );
  assert.equal(proximityLabelFromEvidence(evidence({ coverage: "none" })), "Nähe zum Filialmuster: liegt nicht vor");
  assert.equal(proximityLabelFromEvidence(evidence({ scope: "inherited" })), null);
  assert.equal(proximityLabelFromEvidence(evidence({ scope: "inherited", kind: "absent", coverage: "none" })), null);
  assert.equal(proximityLabelFromEvidence(evidence({ proximity: 0.8, scope: "inherited" })), null);
  assert.equal(proximityLabelFromEvidence(evidence()), null);
  assert.equal(proximityLabelFromEvidence(evidence({ proximity: Number.NaN })), null);
  assert.equal(proximityLabel(0), "Nähe zum Filialmuster: gering");
  assert.equal(proximityLabelFromEvidence(evidence({ proximity: 0 })), "Nähe zum Filialmuster: gering");
});

test("proximity labels never include the raw number", () => {
  const samples = [1, 0.67, 0.66, 0.34, 0.33, 0, 0.5, 0.999];
  for (const value of samples) {
    const text = proximityLabel(value);
    assertNoRawNumber(text, value);
    assert.match(text, /^Nähe zum Filialmuster: (hoch|mittel|gering)$/);
    assert.equal(proximityLabelFromEvidence(evidence({ proximity: value })), text);
  }
  assert.equal(proximityLabel(0.67), "Nähe zum Filialmuster: hoch");
  assert.equal(proximityLabel(0.34), "Nähe zum Filialmuster: mittel");
  assert.equal(proximityLabel(0.33), "Nähe zum Filialmuster: gering");
});
