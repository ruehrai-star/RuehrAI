import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYSIS_FAILURE_COPY,
  analysisFailureFromHttp,
  analysisFailureMessage,
} from "./failure.ts";

test("empty and unknown keys become a generic German sentence", () => {
  assert.equal(analysisFailureMessage(null), ANALYSIS_FAILURE_COPY.generic);
  assert.equal(analysisFailureMessage(""), ANALYSIS_FAILURE_COPY.generic);
  assert.equal(analysisFailureMessage("   "), ANALYSIS_FAILURE_COPY.generic);
  assert.equal(analysisFailureMessage("brain_search_failed"), `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.brain}`);
  assert.equal(analysisFailureMessage("PATTERN_FAILED"), `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.pattern}`);
  assert.equal(analysisFailureMessage("22P02"), ANALYSIS_FAILURE_COPY.generic);
  assert.equal(analysisFailureMessage("504"), `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`);
});

test("timeout categories map to the duration sentence, never a code", () => {
  assert.equal(
    analysisFailureMessage("timeout"),
    `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`,
  );
  assert.equal(
    analysisFailureMessage("timed_out"),
    `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`,
  );
  assert.equal(
    analysisFailureMessage("gateway_timeout"),
    `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`,
  );
  assert.equal(
    analysisFailureMessage("Die Berechnung hat zu lange gedauert."),
    `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`,
  );
  assert.equal(analysisFailureFromHttp(504), `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`);
  assert.equal(analysisFailureFromHttp(408, "Gateway Time-out"), `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.timeout}`);
});

test("SQL, stacks, and English exception text stay hidden", () => {
  assert.equal(
    analysisFailureMessage('relation "app.analysis_runs" does not exist'),
    ANALYSIS_FAILURE_COPY.generic,
  );
  assert.equal(
    analysisFailureMessage("SELECT * FROM geo.facts WHERE id = 1"),
    ANALYSIS_FAILURE_COPY.generic,
  );
  assert.equal(
    analysisFailureMessage("Error: boom\n    at Module.run (apps/backend/src/analysis/analysis.service.ts:188:13)"),
    ANALYSIS_FAILURE_COPY.generic,
  );
  assert.equal(analysisFailureMessage("ECONNREFUSED"), ANALYSIS_FAILURE_COPY.generic);
  assert.equal(analysisFailureMessage('{"stack":"Error: x"}'), ANALYSIS_FAILURE_COPY.generic);
});

test("a safe German backend sentence is shown with the failed prefix", () => {
  assert.equal(
    analysisFailureMessage("Die Monatsumsätze reichen für eine Musteranalyse nicht aus."),
    `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.revenue}`,
  );
  assert.equal(
    analysisFailureMessage("Keine Zielregion gespeichert. Bitte zuerst eine Zielregion anlegen."),
    `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.region}`,
  );
  assert.equal(
    analysisFailureMessage("Die Brain-Suche ist fehlgeschlagen."),
    `${ANALYSIS_FAILURE_COPY.prefix}${ANALYSIS_FAILURE_COPY.brain}`,
  );
  assert.equal(
    analysisFailureMessage("Die Filialen liegen zu weit auseinander."),
    `${ANALYSIS_FAILURE_COPY.prefix}Die Filialen liegen zu weit auseinander.`,
  );
  assert.equal(
    analysisFailureMessage("Analyse fehlgeschlagen: Bitte später erneut versuchen."),
    "Analyse fehlgeschlagen: Bitte später erneut versuchen.",
  );
  assert.equal(analysisFailureMessage("Die Analyse ist fehlgeschlagen. Bitte erneut versuchen."), ANALYSIS_FAILURE_COPY.generic);
});

test("never returns the raw input when it looks like a key or code", () => {
  for (const raw of ["brain_search_failed", "SQLSTATE", "504", "ECONNRESET", "timed_out"]) {
    const text = analysisFailureMessage(raw);
    assert.equal(text.includes(raw), false, `leaked ${raw} in ${text}`);
    assert.match(text, /Analyse fehlgeschlagen/);
  }
});
