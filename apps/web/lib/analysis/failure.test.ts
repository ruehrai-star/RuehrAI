import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYSIS_FAILURE_COPY,
  analysisFailureFromHttp,
  analysisFailureMessage,
  clientDeadlineMessage,
} from "./failure.ts";

function line(detail: string): string {
  return `${ANALYSIS_FAILURE_COPY.prefix}${detail}`;
}

test("closed failureReason values map to prefixed German text and never leak the key", () => {
  assert.equal(analysisFailureMessage("timeout"), line(ANALYSIS_FAILURE_COPY.timeout));
  assert.equal(analysisFailureMessage("pattern_failed"), line(ANALYSIS_FAILURE_COPY.pattern));
  assert.equal(analysisFailureMessage("set_save_failed"), line(ANALYSIS_FAILURE_COPY.setSave));
  assert.equal(analysisFailureMessage("interrupted"), line(ANALYSIS_FAILURE_COPY.interrupted));
  assert.equal(analysisFailureMessage("internal_error"), line(ANALYSIS_FAILURE_COPY.unexpected));
  for (const key of ["timeout", "pattern_failed", "set_save_failed", "interrupted", "internal_error"]) {
    const text = analysisFailureMessage(key);
    assert.equal(text.includes(key), false, `leaked ${key} in ${text}`);
    assert.match(text, /^Analyse fehlgeschlagen: /);
  }
});

test("unknown, empty, and unsafe values use the unexpected sentence", () => {
  const unexpected = line(ANALYSIS_FAILURE_COPY.unexpected);
  assert.equal(analysisFailureMessage(null), unexpected);
  assert.equal(analysisFailureMessage(""), unexpected);
  assert.equal(analysisFailureMessage("   "), unexpected);
  assert.equal(analysisFailureMessage("brain_search_failed"), unexpected);
  assert.equal(analysisFailureMessage("PATTERN_FAILED"), line(ANALYSIS_FAILURE_COPY.pattern));
  assert.equal(analysisFailureMessage("22P02"), unexpected);
  assert.equal(analysisFailureMessage("504"), unexpected);
  assert.equal(analysisFailureMessage("timed_out"), unexpected);
  assert.equal(analysisFailureMessage("Die Berechnung hat zu lange gedauert."), unexpected);
  assert.equal(analysisFailureMessage('relation "app.analysis_runs" does not exist'), unexpected);
  assert.equal(analysisFailureMessage("SELECT * FROM geo.facts WHERE id = 1"), unexpected);
  assert.equal(
    analysisFailureMessage("Error: boom\n    at Module.run (apps/backend/src/analysis/analysis.service.ts:188:13)"),
    unexpected,
  );
  assert.equal(analysisFailureMessage("ECONNREFUSED"), unexpected);
  assert.equal(analysisFailureMessage('{"stack":"Error: x"}'), unexpected);
  assert.equal(analysisFailureMessage("Die Filialen liegen zu weit auseinander."), unexpected);
});

test("HTTP 404 is a generic failure; gateway timeouts map to timeout", () => {
  assert.equal(analysisFailureFromHttp(404), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(404, "Die Analyse wurde nicht gefunden."), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(504), line(ANALYSIS_FAILURE_COPY.timeout));
  assert.equal(analysisFailureFromHttp(408, "Gateway Time-out"), line(ANALYSIS_FAILURE_COPY.timeout));
  assert.equal(analysisFailureFromHttp(500, "internal_error"), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(500, "set_save_failed"), line(ANALYSIS_FAILURE_COPY.setSave));
});

test("the client safety deadline uses the timeout sentence", () => {
  assert.equal(clientDeadlineMessage(), line(ANALYSIS_FAILURE_COPY.timeout));
  assert.equal(clientDeadlineMessage().includes("timeout"), false);
});
