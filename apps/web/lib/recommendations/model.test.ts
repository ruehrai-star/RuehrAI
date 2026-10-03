import assert from "node:assert/strict";
import { test } from "node:test";
import type { Recommendation, RecommendationSet } from "../api/types.ts";
import {
  RECOMMENDATION_COPY,
  formatAddress,
  formatLocationMeta,
  formatScore,
  formatWindow,
  rankLabel,
  recommendationEmptyCopy,
  recommendationStatus,
  recommendationSubtitle,
  shortCriteria,
} from "./model.ts";

const item: Recommendation = {
  id: "plz5:80801",
  rank: 1,
  title: "Schwabing",
  location: { geoKey: "80801", grain: "plz5", lon: 11.58, lat: 48.16, name: "Schwabing" },
  score: 1,
  rationale: "Am Standort Schwabing passt das Muster.",
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

function setWith(items: Recommendation[], reason: string | null): RecommendationSet {
  return {
    id: "3",
    runId: "15",
    createdAt: "2026-09-29T12:00:00.000Z",
    window: { from: "2026-04", to: "2026-09" },
    count: items.length,
    reason,
    pattern: {
      source: "heuristic",
      summary: "Einwohner steigen mit dem Umsatz.",
      revenueDirection: "up",
      criteria: [{ key: "einwohner", label: "Einwohner", direction: "up", evidence: "steigt" }],
    },
    items,
  };
}

test("UX-Gate labels for Empfehlungen stay exact", () => {
  assert.equal(RECOMMENDATION_COPY.title, "Empfehlungen");
  assert.equal(RECOMMENDATION_COPY.subtitle, "Top 3 in Ihrer Zielregion");
  assert.equal(RECOMMENDATION_COPY.subtitlePlural, "Top 3 in Ihren Zielregionen");
  assert.equal(RECOMMENDATION_COPY.patternHeading, "Abgeleitetes Muster");
  assert.equal(RECOMMENDATION_COPY.address, "Adresse");
  assert.equal(RECOMMENDATION_COPY.rationale, "Begründung");
  assert.equal(RECOMMENDATION_COPY.details, "Details");
  assert.equal(RECOMMENDATION_COPY.empty, "Keine passenden Standorte in der Zielregion.");
  assert.equal(RECOMMENDATION_COPY.emptyPlural, "Keine passenden Standorte in den Zielregionen.");
  assert.equal(rankLabel(1), "Rang 1");
  assert.equal(recommendationSubtitle(0), null);
  assert.equal(recommendationEmptyCopy(0), null);
  assert.equal(recommendationSubtitle(1), "Top 3 in Ihrer Zielregion");
  assert.equal(recommendationEmptyCopy(1), "Keine passenden Standorte in der Zielregion.");
  assert.equal(recommendationSubtitle(2), "Top 3 in Ihren Zielregionen");
  assert.equal(recommendationEmptyCopy(2), "Keine passenden Standorte in den Zielregionen.");
});

test("a card address, score, window, and short criteria stay in German", () => {
  assert.equal(formatAddress(item), "Schwabing");
  assert.equal(formatAddress({ ...item, title: "Leopoldstraße 12", location: { ...item.location, name: "Schwabing" } }), "Leopoldstraße 12, Schwabing");
  assert.equal(formatLocationMeta(item), "PLZ");
  assert.equal(
    formatLocationMeta({
      ...item,
      location: { ...item.location, grain: "ags", geoKey: "11000001" },
    }),
    "Bezirk",
  );
  assert.equal(
    formatLocationMeta({
      ...item,
      location: { ...item.location, grain: "ags", geoKey: "09162000" },
    }),
    "Gemeinde",
  );
  assert.equal(
    formatLocationMeta({
      ...item,
      location: { ...item.location, grain: "ags", geoKey: "14713000", level: "ortsteil" },
    }),
    "Ortsteil",
  );
  assert.equal(
    formatLocationMeta({
      ...item,
      location: {
        ...item.location,
        grain: "ags",
        geoKey: "14713000",
        level: "ortsteil",
        parentLabel: "Leipzig",
      },
    }),
    "Ortsteil Leipzig",
  );
  assert.equal(
    formatLocationMeta({
      ...item,
      location: {
        ...item.location,
        grain: "ags",
        geoKey: "11000001",
        level: "stadtteil",
        parentName: "Berlin",
      } as Recommendation["location"],
    }),
    "Stadtteil",
  );
  assert.equal(formatScore(1), "Passung 100\u00a0%");
  assert.equal(formatWindow({ from: "2026-04", to: "2026-09" }), "April 2026 – September 2026");
  assert.deepEqual(shortCriteria(setWith([item], null).pattern), ["Einwohner · steigend"]);
});

test("recommendation copy never shows the catalog key", () => {
  const bezirk = {
    ...item,
    id: "ags:11000001",
    location: { ...item.location, grain: "ags" as const, geoKey: "11000001" },
  };
  const prefixed = {
    ...item,
    id: "plz5:80801",
    location: { ...item.location, geoKey: "plz5:80801" },
  };
  const withParent = {
    ...item,
    location: {
      ...item.location,
      grain: "ags" as const,
      geoKey: "14713000",
      level: "ortsteil" as const,
      parentLabel: "Leipzig",
    },
  };
  const keyedTitle = formatAddress({ ...item, title: "plz5:80801", location: { ...item.location, name: null } });
  const visible = [
    formatAddress(item),
    keyedTitle,
    formatLocationMeta(item),
    formatLocationMeta(bezirk),
    formatLocationMeta(prefixed),
    formatLocationMeta(withParent),
  ].join(" ");
  assert.equal(keyedTitle, "");
  for (const key of ["80801", "11000001", "14713000", "plz5:80801", "ags:11000001", item.id, item.location.geoKey]) {
    assert.equal(visible.includes(key), false, `catalog key leaked: ${key}`);
  }
  assert.equal(visible.includes("PLZ 80801"), false);
  assert.equal(visible.includes("Bezirk 11000001"), false);
});

test("one match surfaces the thin-region hint and the Backend reason", () => {
  const reason = "In der Zielregion liegt nur 1 Standort mit positiver Musterentwicklung in den letzten sechs Monaten vor.";
  assert.deepEqual(recommendationStatus(setWith([item], reason)), { empty: false, thin: true, reason });
});

test("zero matches keep the empty sentence inside the Backend reason", () => {
  const reason =
    "Keine passenden Standorte in der Zielregion. Das Muster hat sich dort in den letzten sechs Monaten nicht positiv entwickelt.";
  assert.deepEqual(recommendationStatus(setWith([], reason)), { empty: false, thin: false, reason });
});

test("zero matches without that sentence still show the empty line", () => {
  const reason = "In der Zielregion wurden für die letzten sechs Monate keine Brain-Fakten gefunden.";
  assert.deepEqual(recommendationStatus(setWith([], reason)), { empty: true, thin: false, reason });
});

test("three matches hide the thin hint and a null reason", () => {
  const full = setWith(
    [item, { ...item, id: "plz5:80802", rank: 2 }, { ...item, id: "plz5:80803", rank: 3 }],
    null,
  );
  assert.deepEqual(recommendationStatus(full), { empty: false, thin: false, reason: null });
});
