import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AnalysisBrain, AnalysisInput } from "@ruehrai/api-contracts";
import {
  ANALYSIS_COPY,
  brainStatusText,
  criterionDirectionLabel,
  formatAnalysisSummary,
  patternSourceLabel,
  revenueDirectionLabel,
  revenueMonthCount,
} from "./model.ts";

const input: AnalysisInput = {
  region: {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    ags: "09162000",
    plz: null,
    lon: 11.5,
    lat: 48.1,
    updatedAt: "2026-09-29T11:00:00.000Z",
  },
  stores: [
    {
      id: "3",
      label: "Nord",
      street: "Weg 1",
      postalCode: "80331",
      city: "München",
      points: [
        { year: 2026, month: 1, revenueEur: 10 },
        { year: 2026, month: 2, revenueEur: null },
        { year: 2026, month: 3, revenueEur: 12 },
      ],
      changes: [],
    },
    {
      id: "4",
      street: "Weg 2",
      postalCode: "80333",
      city: "München",
      points: [{ year: 2026, month: 1, revenueEur: 0 }],
      changes: [],
    },
  ],
  revenueDirection: "up",
  capturedAt: "2026-09-29T12:00:00.000Z",
};

test("UX-Gate labels for the analysis start stay exact", () => {
  assert.equal(ANALYSIS_COPY.title, "Musteranalyse");
  assert.equal(ANALYSIS_COPY.help, "Aus Ihren Standorten und Umsätzen leiten wir ein Kriterien-Muster ab.");
  assert.equal(ANALYSIS_COPY.summary, "Zielregion · Filialen · Monate Umsatz");
  assert.equal(ANALYSIS_COPY.start, "Analyse starten");
  assert.equal(ANALYSIS_COPY.restart, "Erneut starten");
  assert.equal(ANALYSIS_COPY.restart, "Erneut starten");
  assert.equal(ANALYSIS_COPY.back, "Zurück zu Standorten");
  assert.equal(ANALYSIS_COPY.empty, "Keine Analyse ausgewählt.");
  assert.equal(ANALYSIS_COPY.running, "Analyse läuft …");
  assert.equal(ANALYSIS_COPY.failed, "Analyse fehlgeschlagen. Bitte erneut versuchen.");
  assert.equal(ANALYSIS_COPY.deadline, "Analyse fehlgeschlagen: Die Berechnung hat zu lange gedauert.");
  assert.equal(ANALYSIS_COPY.briefHeading, "Kurzfassung");
});

test("summary counts stores and months that have a revenue, including zero", () => {
  assert.equal(revenueMonthCount(input), 3);
  assert.equal(
    formatAnalysisSummary(input),
    "Zielregion: München · Filialen: 2 · Monate Umsatz: 3",
  );
  const six = {
    ...input,
    region: { ...input.region, label: "Innenstadt", parentLabel: "Köln", geoKey: "stadtbezirk:koeln:innenstadt" },
    regions: [
      { ...input.region, label: "Innenstadt", parentLabel: "Köln", geoKey: "a" },
      { ...input.region, label: "Rodenkirchen", parentLabel: "Köln", geoKey: "b" },
      { ...input.region, label: "Lindenthal", parentLabel: "Köln", geoKey: "c" },
      { ...input.region, label: "Ehrenfeld", parentLabel: "Köln", geoKey: "d" },
      { ...input.region, label: "Nippes", parentLabel: "Köln", geoKey: "e" },
      { ...input.region, label: "Chorweiler", parentLabel: "Köln", geoKey: "f" },
    ],
  };
  assert.equal(
    formatAnalysisSummary(six),
    "Zielregion: Innenstadt (Köln) + 5 weitere · Filialen: 2 · Monate Umsatz: 3",
  );
  assert.equal(formatAnalysisSummary(six).includes("geoKey"), false);
  assert.equal(revenueDirectionLabel("up"), "steigend");
  assert.equal(revenueDirectionLabel("down"), "fallend");
  assert.equal(revenueDirectionLabel("flat"), "unverändert");
  assert.equal(criterionDirectionLabel("unknown"), "ohne erkennbare Richtung");
  assert.equal(patternSourceLabel("llm"), "Sprachmodell");
  assert.equal(patternSourceLabel("heuristic"), "Heuristik");
});

test("brain status names vector search and the SQL filter with its reason", () => {
  const vector: AnalysisBrain = { mode: "vector", vectorUnavailableReason: null, factCount: 1, facts: [] };
  assert.deepEqual(brainStatusText(vector), { mode: "Vektorsuche · 1 Fakt", detail: null, tone: "status" });

  const sql: AnalysisBrain = {
    mode: "sql",
    vectorUnavailableReason: "embeddings_unreachable",
    factCount: 2,
    facts: [],
  };
  assert.deepEqual(brainStatusText(sql), {
    mode: "Filter ohne Vektor · 2 Fakten",
    detail: "Einbettungen sind nicht erreichbar.",
    tone: "info",
  });

  const sqlWithoutReason: AnalysisBrain = { mode: "sql", factCount: 0, facts: [] };
  assert.equal(brainStatusText(sqlWithoutReason).detail, null);
  assert.equal(brainStatusText(sqlWithoutReason).tone, "status");
  const noEmbeddings = brainStatusText({ ...sql, vectorUnavailableReason: "no_embeddings_in_region" });
  assert.equal(noEmbeddings.detail, "In der Zielregion liegen keine Einbettungen vor.");
  assert.equal(noEmbeddings.tone, "info");
});

test("Musteranalyse shows embedding notes as info, not as an error", () => {
  const page = readFileSync(new URL("../../components/musteranalyse-page.tsx", import.meta.url), "utf8");
  assert.match(page, /brain\.tone === "info" \? "hint"/);
  assert.doesNotMatch(page, /brain\.detail[\s\S]{0,80}message-error/);
});
