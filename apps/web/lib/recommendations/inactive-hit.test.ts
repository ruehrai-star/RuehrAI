import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RecommendationEvidence } from "@ruehrai/api-contracts";
import { INACTIVE_HIT_COPY, isInactiveHit, isOwnTrendEvidence } from "./inactive-hit.ts";

const localTrend: RecommendationEvidence = {
  key: "einwohner",
  label: "Einwohner",
  direction: "up",
  patternDirection: "up",
  evidence: "Einwohner steigt in den letzten drei Jahren.",
  kind: "trend",
  coverage: "series",
  scope: "local",
  sourceLevel: "ortsteil",
};

const inherited: RecommendationEvidence = {
  ...localTrend,
  key: "kaufkraft",
  label: "Kaufkraft",
  scope: "inherited",
  sourceLevel: "gemeinde",
};

const stichtag: RecommendationEvidence = {
  ...localTrend,
  key: "flaeche",
  label: "Fläche",
  kind: "stichtag",
  coverage: "single",
};

const absent: RecommendationEvidence = {
  ...localTrend,
  key: "leerstand",
  label: "Leerstand",
  kind: "absent",
  coverage: "none",
  evidence: "liegt nicht vor",
};

test("OpenAPI 0.19.5 has no item nAktiv field; inactive means no own Verlauf", () => {
  const source = readFileSync(new URL("./inactive-hit.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /item\.nAktiv|\.nActive|activeCount|hasLocalData/);
  assert.match(source, /criteriaEvidence/);
  assert.equal(
    INACTIVE_HIT_COPY,
    "Für diese Fläche liegen keine eigenen Verlaufsdaten vor. Die Einordnung beruht auf übergeordneten Werten.",
  );
  assert.equal(isOwnTrendEvidence(localTrend), true);
  assert.equal(isOwnTrendEvidence(inherited), false);
  assert.equal(isOwnTrendEvidence(stichtag), false);
  assert.equal(isOwnTrendEvidence(absent), false);
  assert.equal(isOwnTrendEvidence({ ...localTrend, coverage: "single", kind: "trend" }), false);
  assert.equal(isInactiveHit({ criteriaEvidence: [localTrend] }), false);
  assert.equal(isInactiveHit({ criteriaEvidence: [inherited, stichtag] }), true);
  assert.equal(isInactiveHit({ criteriaEvidence: [stichtag] }), true);
  assert.equal(isInactiveHit({ criteriaEvidence: [absent] }), true);
  assert.equal(isInactiveHit({ criteriaEvidence: [] }), true);
  assert.equal(isInactiveHit({ criteriaEvidence: [inherited, localTrend] }), false);
});
