import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AnalysisRun } from "@ruehrai/api-contracts";
import {
  ANALYSIS_FAILURE_COPY,
  ANALYSIS_RUN_FAILURE_REASONS,
  CHOOSE_TARGET_REGION_HREF,
  MARKED_TARGET_REGION_NOT_FOUND_CODE,
  analysisFailureFromHttp,
  analysisFailureMessage,
  clientDeadlineMessage,
  isAnalysisRunFailureReason,
  isMarkedTargetRegionMissingCopy,
  isMarkedTargetRegionNotFound,
  isMarkedTargetRegionNotFoundCode,
  markedTargetRegionMissingMessage,
} from "./failure.ts";
import { ApiError } from "../api/types.ts";
import { containsInternalKey } from "../format.ts";

function line(detail: string): string {
  return `${ANALYSIS_FAILURE_COPY.prefix}${detail}`;
}

test("client failureReason keys match the OpenAPI closed enum exactly", () => {
  assert.deepEqual([...ANALYSIS_RUN_FAILURE_REASONS], [
    "timeout",
    "pattern_failed",
    "set_save_failed",
    "interrupted",
    "internal_error",
  ]);
  const official: Array<NonNullable<AnalysisRun["failureReason"]>> = [
    "timeout",
    "pattern_failed",
    "set_save_failed",
    "interrupted",
    "internal_error",
  ];
  assert.deepEqual([...ANALYSIS_RUN_FAILURE_REASONS], official);
  for (const key of official) assert.equal(isAnalysisRunFailureReason(key), true);
  assert.equal(isAnalysisRunFailureReason("timed_out"), false);
  assert.equal(isAnalysisRunFailureReason("PATTERN_FAILED"), false);
});

test("closed failureReason values map to prefixed German text and never leak the key", () => {
  assert.equal(analysisFailureMessage("timeout"), line(ANALYSIS_FAILURE_COPY.timeout));
  assert.equal(
    analysisFailureMessage("pattern_failed"),
    line(ANALYSIS_FAILURE_COPY.pattern),
  );
  assert.equal(analysisFailureMessage("set_save_failed"), line(ANALYSIS_FAILURE_COPY.setSave));
  assert.equal(
    analysisFailureMessage("interrupted"),
    "Analyse fehlgeschlagen: Die Analyse wurde unterbrochen.",
  );
  assert.equal(analysisFailureMessage("internal_error"), line(ANALYSIS_FAILURE_COPY.unexpected));
  for (const key of ANALYSIS_RUN_FAILURE_REASONS) {
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
  assert.equal(analysisFailureMessage("PATTERN_FAILED"), unexpected);
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
});

test("HTTP 404 is a generic failure; gateway status codes are not timeout copy", () => {
  assert.equal(analysisFailureFromHttp(404), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(404, "Die Analyse wurde nicht gefunden."), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(504), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(502, "Bad Gateway"), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(408, "Gateway Time-out"), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(500, "internal_error"), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(500, "set_save_failed"), line(ANALYSIS_FAILURE_COPY.setSave));
  assert.equal(analysisFailureFromHttp(504).includes("zu lange gedauert"), false);
});

test("POST /analysis/runs 400 for more than 200 Zielregionen is a German limit, not a generic failure", () => {
  assert.equal(
    analysisFailureFromHttp(400, "Bitte wählen Sie höchstens 200 Zielregionen."),
    ANALYSIS_FAILURE_COPY.tooManyTargetRegions,
  );
  assert.equal(
    analysisFailureFromHttp(400, "Too many target regions: maximum is 200"),
    ANALYSIS_FAILURE_COPY.tooManyTargetRegions,
  );
  assert.equal(
    analysisFailureFromHttp(400, "targetRegions must contain no more than 200 elements"),
    ANALYSIS_FAILURE_COPY.tooManyTargetRegions,
  );
  assert.equal(ANALYSIS_FAILURE_COPY.tooManyTargetRegions, "Bitte wählen Sie höchstens 200 Zielregionen.");
  assert.equal(analysisFailureFromHttp(400, "internal_error"), line(ANALYSIS_FAILURE_COPY.unexpected));
  assert.equal(analysisFailureFromHttp(400, "Die Angaben sind ungültig."), line(ANALYSIS_FAILURE_COPY.unexpected));
});

test("the client safety deadline uses the timeout sentence", () => {
  assert.equal(clientDeadlineMessage(), line(ANALYSIS_FAILURE_COPY.timeout));
  assert.equal(clientDeadlineMessage().includes("timeout"), false);
});

test("POST /analysis/runs 404 with marked_target_region_not_found is a dedicated sentence, not a generic 404", () => {
  const dedicated = ANALYSIS_FAILURE_COPY.markedTargetRegionMissing;
  assert.equal(dedicated, "Diese Zielregion ist nicht mehr gespeichert. Bitte wählen Sie sie neu.");
  assert.equal(MARKED_TARGET_REGION_NOT_FOUND_CODE, "marked_target_region_not_found");
  assert.equal(
    analysisFailureFromHttp(404, "Die markierte Zielregion gehört nicht zu diesem Konto.", MARKED_TARGET_REGION_NOT_FOUND_CODE),
    dedicated,
  );
  assert.equal(analysisFailureFromHttp(404, "Not Found", " marked_target_region_not_found "), dedicated);
  assert.equal(dedicated.startsWith(ANALYSIS_FAILURE_COPY.prefix), false);
  assert.equal(dedicated.includes(MARKED_TARGET_REGION_NOT_FOUND_CODE), false);
  assert.equal(isMarkedTargetRegionNotFoundCode(MARKED_TARGET_REGION_NOT_FOUND_CODE), true);
  assert.equal(isMarkedTargetRegionNotFoundCode("internal_error"), false);
  assert.equal(
    isMarkedTargetRegionNotFound(
      new ApiError("Die markierte Zielregion gehört nicht zu diesem Konto.", 404, MARKED_TARGET_REGION_NOT_FOUND_CODE),
    ),
    true,
  );
  assert.equal(isMarkedTargetRegionNotFound(new ApiError("Die Analyse wurde nicht gefunden.", 404)), false);
  assert.equal(
    isMarkedTargetRegionNotFound(new ApiError("Die markierte Zielregion gehört nicht zu diesem Konto.", 404)),
    false,
  );
});

test("a known Zielregion name is quoted in the missing-mark sentence; unknown or key-like values keep the generic text", () => {
  const generic = ANALYSIS_FAILURE_COPY.markedTargetRegionMissing;
  assert.equal(markedTargetRegionMissingMessage(null), generic);
  assert.equal(markedTargetRegionMissingMessage(""), generic);
  assert.equal(markedTargetRegionMissingMessage("   "), generic);
  assert.equal(markedTargetRegionMissingMessage("ortsteil:osm:162894"), generic);
  assert.equal(markedTargetRegionMissingMessage("lor:plr:07400823"), generic);
  assert.equal(markedTargetRegionMissingMessage("ags:09162000"), generic);
  assert.equal(
    markedTargetRegionMissingMessage("Tempelhof"),
    "Die Zielregion „Tempelhof“ ist nicht mehr gespeichert. Bitte wählen Sie sie neu.",
  );
  assert.equal(
    markedTargetRegionMissingMessage("Tempelhof (Berlin)"),
    "Die Zielregion „Tempelhof (Berlin)“ ist nicht mehr gespeichert. Bitte wählen Sie sie neu.",
  );
  assert.equal(
    markedTargetRegionMissingMessage("Tempelhof (ortsteil:osm:162894)"),
    "Die Zielregion „Tempelhof“ ist nicht mehr gespeichert. Bitte wählen Sie sie neu.",
  );
  const named = markedTargetRegionMissingMessage("Tempelhof");
  assert.equal(named.includes("ortsteil"), false);
  assert.equal(named.includes("geoKey"), false);
  assert.equal(named.includes("162894"), false);
  assert.equal(containsInternalKey(named), false);
  assert.equal(isMarkedTargetRegionMissingCopy(generic), true);
  assert.equal(isMarkedTargetRegionMissingCopy(named), true);
  assert.equal(isMarkedTargetRegionMissingCopy(line(ANALYSIS_FAILURE_COPY.unexpected)), false);
  assert.equal(isMarkedTargetRegionMissingCopy("Die Analyse wurde nicht gefunden."), false);
});

test("other 404s and errors stay on the generic mapping", () => {
  const unexpected = line(ANALYSIS_FAILURE_COPY.unexpected);
  assert.equal(analysisFailureFromHttp(404), unexpected);
  assert.equal(analysisFailureFromHttp(404, "Die Analyse wurde nicht gefunden."), unexpected);
  assert.equal(
    analysisFailureFromHttp(404, "Die markierte Zielregion gehört nicht zu diesem Konto."),
    unexpected,
  );
  assert.equal(analysisFailureFromHttp(404, "Not Found", "run_not_found"), unexpected);
  assert.equal(analysisFailureFromHttp(404, null, "marked_target_region_missing"), unexpected);
  assert.equal(analysisFailureFromHttp(400, null, MARKED_TARGET_REGION_NOT_FOUND_CODE), unexpected);
  assert.equal(analysisFailureFromHttp(500, "internal_error", MARKED_TARGET_REGION_NOT_FOUND_CODE), unexpected);
});

test("Empfehlungen and Musteranalyse show the dedicated sentence plus Zielregion picker and clear the stale mark", () => {
  const notice = readFileSync(new URL("../../components/marked-region-missing.tsx", import.meta.url), "utf8");
  const empfehlungen = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  const muster = readFileSync(new URL("../../components/musteranalyse-page.tsx", import.meta.url), "utf8");
  const region = readFileSync(new URL("../../components/region-section.tsx", import.meta.url), "utf8");
  assert.equal(CHOOSE_TARGET_REGION_HREF, "/standorte#zielregion");
  assert.equal(ANALYSIS_FAILURE_COPY.chooseTargetRegion, "Zielregion wählen");
  assert.match(notice, /markedTargetRegionMissingMessage/);
  assert.match(notice, /href=\{CHOOSE_TARGET_REGION_HREF\}/);
  assert.match(notice, /ANALYSIS_FAILURE_COPY\.chooseTargetRegion/);
  assert.match(empfehlungen, /isMarkedTargetRegionNotFound\(caught\)/);
  assert.match(empfehlungen, /clearMarkedKey\(\)/);
  assert.match(empfehlungen, /markedTargetRegionMissingMessage/);
  assert.match(empfehlungen, /runRegionEntryLabel\(current, regions\)/);
  assert.match(empfehlungen, /<MarkedRegionMissingNotice message=\{runError\} \/>/);
  assert.match(empfehlungen, /isMarkedTargetRegionMissingCopy\(runError\)/);
  assert.match(muster, /isMarkedTargetRegionNotFound\(caught\)/);
  assert.match(muster, /clearMarkedKey\(\)/);
  assert.match(muster, /markedTargetRegionMissingMessage/);
  assert.match(muster, /<MarkedRegionMissingNotice message=\{actionError\} \/>/);
  assert.match(muster, /isMarkedTargetRegionMissingCopy\(actionError\)/);
  assert.match(muster, /showMarkedRegionMissing \? null/);
  assert.match(region, /hash === "#zielregion"/);
  assert.match(region, /searchRef\.current\?\.focus\(\)/);
  assert.match(region, /id="region-q"/);
});
