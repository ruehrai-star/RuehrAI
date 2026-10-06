import assert from "node:assert/strict";
import { test } from "node:test";
import type { Recommendation, RecommendationSet } from "../api/types.ts";
import type { PatternDatasetProfile } from "@ruehrai/api-contracts";
import {
  RECOMMENDATION_COPY,
  buildPatternProfile,
  buildTrefferCard,
  buildTrefferlisteCards,
  formatAddress,
  formatLocationMeta,
  formatScore,
  formatWindow,
  hasDrawableGeometry,
  headingForMarkedRegion,
  hitBadge,
  inheritedLabel,
  rankLabel,
  recommendationEmptyCopy,
  recommendationStatus,
  recommendationSubtitle,
  shortCriteria,
  topHits,
  trendSummary,
  visibleHits,
} from "./model.ts";

const polygon = {
  type: "Polygon" as const,
  coordinates: [
    [
      [13.3, 52.4],
      [13.4, 52.4],
      [13.4, 52.5],
      [13.3, 52.5],
      [13.3, 52.4],
    ],
  ],
};

function item(partial: Partial<Recommendation> & Pick<Recommendation, "id" | "rank">): Recommendation {
  return {
    title: "Lankwitz",
    kind: "ortsteil",
    location: { geoKey: "ortsteil:osm:5712247", grain: "other", lon: 13.35, lat: 52.43, name: "Lankwitz" },
    score: 1,
    rationale: "Am Standort Lankwitz passt das Muster.",
    criteriaEvidence: [
      {
        key: "einwohner",
        label: "Einwohner",
        direction: "up",
        patternDirection: "up",
        evidence: "Einwohner steigt in den letzten drei Jahren.",
        coverage: "series",
        scope: "local",
        sourceLevel: "ortsteil",
        baseline: "per_1000_inhabitants",
        baselineMatch: true,
        baselineMethod: "official",
        normalizedValue: 12,
        rawValue: 2400,
        points: [
          { period: "2023", status: "present", value: 2200, normalizedValue: 11, baselineMethod: "official" },
          { period: "2024", status: "present", value: 2300, normalizedValue: 11.5, baselineMethod: "official" },
          { period: "2025", status: "present", value: 2400, normalizedValue: 12, baselineMethod: "official" },
        ],
      },
    ],
    source: "heuristic",
    geometry: polygon,
    trend: { direction: "up", summary: "Einwohner steigt seit drei Jahren, je 1.000 Einwohner." },
    ...partial,
    location: {
      geoKey: "ortsteil:osm:5712247",
      grain: "other",
      lon: 13.35,
      lat: 52.43,
      name: "Lankwitz",
      ...partial.location,
    },
  };
}

const patternDataset: PatternDatasetProfile = {
  metricId: "einwohner",
  baseline: "per_1000_inhabitants",
  sourceLevel: "ortsteil",
  sourceGeoKey: "bestand",
  baselineMatch: true,
  baselineMethod: "official",
  yearlySeries: {
    metricId: "einwohner",
    requestedLevel: "ortsteil",
    requestedGeoKey: "bestand",
    sourceLevel: "ortsteil",
    sourceGeoKey: "bestand",
    granularity: "year",
    coverage: "series",
    points: [
      { period: "2023", status: "present", value: 10, normalizedValue: 10 },
      { period: "2024", status: "present", value: 11, normalizedValue: 11 },
      { period: "2025", status: "present", value: 12, normalizedValue: 12 },
    ],
  },
  criterion: {
    key: "einwohner",
    label: "Einwohner",
    direction: "up",
    evidence: "steigt",
  },
};

function setWith(items: Recommendation[], reason: string | null = null): RecommendationSet {
  return {
    id: "3",
    runId: "15",
    createdAt: "2026-09-29T12:00:00.000Z",
    window: { from: "2023", to: "2025" },
    count: items.length,
    reason,
    pattern: {
      source: "heuristic",
      summary: "Einwohner steigen mit dem Umsatz.",
      revenueDirection: "up",
      criteria: [{ key: "einwohner", label: "Einwohner", direction: "up", evidence: "steigt" }],
    },
    patternByDataset: [patternDataset],
    items,
  };
}

const markedGemeinde = {
  label: "Berlin",
  geoKey: "11000000",
  grain: "ags" as const,
  level: "gemeinde" as const,
};

test("UX-Gate labels for Empfehlungen stay exact", () => {
  assert.equal(RECOMMENDATION_COPY.title, "Empfehlungen");
  assert.equal(RECOMMENDATION_COPY.subtitle, "Top 3 in Ihrer Zielregion");
  assert.equal(RECOMMENDATION_COPY.patternHeading, "Muster der Bestandsstandorte");
  assert.equal(RECOMMENDATION_COPY.details, "Details");
  assert.equal(RECOMMENDATION_COPY.empty, "Keine passenden Standorte in der Zielregion.");
  assert.equal(RECOMMENDATION_COPY.missingRun, "Für diese Zielregion liegt noch kein Analyselauf vor.");
  assert.equal(RECOMMENDATION_COPY.startAnalysis, "Musteranalyse starten");
  assert.equal(RECOMMENDATION_COPY.analysisRunning, "Analyse läuft …");
  assert.equal(RECOMMENDATION_COPY.analysisFailed, "Analyse fehlgeschlagen.");
  assert.equal(RECOMMENDATION_COPY.missingGeometry, "Die Fläche kann noch nicht gezeichnet werden.");
  assert.equal(RECOMMENDATION_COPY.missingValue, "liegt nicht vor");
  assert.equal(rankLabel(1), "Rang 1");
  assert.equal(recommendationSubtitle(0), null);
  assert.equal(recommendationEmptyCopy(0), null);
  assert.equal(recommendationSubtitle(1), "Top 3 in Ihrer Zielregion");
  assert.equal(recommendationEmptyCopy(1), "Keine passenden Standorte in der Zielregion.");
  assert.equal(recommendationSubtitle(2), "Top 3 in Ihrer Zielregion");
  assert.equal(recommendationEmptyCopy(2), "Keine passenden Standorte in der Zielregion.");
  assert.equal(recommendationSubtitle("Berlin, Gemeinde"), "Top 3 in Ihrer Zielregion Berlin, Gemeinde");
  assert.equal(headingForMarkedRegion(markedGemeinde), "Top 3 in Ihrer Zielregion Berlin, Gemeinde");
});

test("a card address, score, window, and short criteria stay in German", () => {
  const plz = item({
    id: "plz5:80801",
    rank: 1,
    title: "Schwabing",
    kind: "plz",
    location: { geoKey: "80801", grain: "plz5", lon: 11.58, lat: 48.16, name: "Schwabing" },
  });
  assert.equal(formatAddress(plz), "Schwabing");
  assert.equal(
    formatAddress({ ...plz, title: "Leopoldstraße 12", location: { ...plz.location, name: "Schwabing" } }),
    "Leopoldstraße 12, Schwabing",
  );
  assert.equal(formatLocationMeta(plz), "PLZ");
  assert.equal(formatScore(1), "Passung 100\u00a0%");
  assert.equal(formatWindow({ from: "2026-04", to: "2026-09" }), "April 2026 – September 2026");
  assert.equal(formatWindow({ from: "2023", to: "2025" }), "2023 – 2025");
  assert.deepEqual(shortCriteria(setWith([plz]).pattern), ["Einwohner · steigend"]);
});

test("badge mapping uses kind and catalog prefixes, never geoKey", () => {
  assert.equal(hitBadge(item({ id: "lor:plr:01100101", rank: 1, kind: "lor", location: { geoKey: "lor:plr:01100101", grain: "other", lon: null, lat: null, name: "PLR" } })), "LOR");
  assert.equal(hitBadge(item({ id: "koeln:sq:12", rank: 1, kind: "quartier", location: { geoKey: "koeln:sq:12", grain: "other", lon: null, lat: null, name: "Belgisches Viertel" } })), "Quartier");
  assert.equal(hitBadge(item({ id: "grid100:1", rank: 1, kind: "grid100", location: { geoKey: "grid100:1", grain: "grid100", lon: null, lat: null, name: "Zelle" } })), "Raster");
  const visible = [
    hitBadge(item({ id: "lor:plr:01100101", rank: 1, kind: "lor", location: { geoKey: "lor:plr:01100101", grain: "other", lon: null, lat: null, name: "Planungsraum" } })),
    hitBadge(item({ id: "koeln:sq:12", rank: 1, kind: "quartier", location: { geoKey: "koeln:sq:12", grain: "other", lon: null, lat: null, name: "Quartier" } })),
  ].join(" ");
  assert.equal(visible.includes("lor:plr"), false);
  assert.equal(visible.includes("koeln:sq"), false);
});

test("recommendation copy never shows the catalog key", () => {
  const keyed = item({
    id: "plz5:80801",
    rank: 1,
    title: "plz5:80801",
    kind: "plz",
    location: { geoKey: "plz5:80801", grain: "plz5", lon: 11.58, lat: 48.16, name: null },
  });
  const visible = [formatAddress(keyed), formatLocationMeta(keyed), hitBadge(keyed)].join(" ");
  assert.equal(formatAddress(keyed), "");
  for (const key of ["80801", "plz5:80801", keyed.id, keyed.location.geoKey]) {
    assert.equal(visible.includes(key), false, `catalog key leaked: ${key}`);
  }
});

test("smallest area comes first; Zielregion and enclosing areas are not hits", () => {
  const lor = item({
    id: "lor:plr:1",
    rank: 2,
    kind: "lor",
    title: "Planungsraum",
    location: { geoKey: "lor:plr:1", grain: "other", lon: null, lat: null, name: "Planungsraum" },
  });
  const ortsteil = item({
    id: "ortsteil:osm:1",
    rank: 1,
    kind: "ortsteil",
    title: "Lankwitz",
    location: { geoKey: "ortsteil:osm:1", grain: "other", lon: null, lat: null, name: "Lankwitz" },
  });
  const berlin = item({
    id: "ags:11000000",
    rank: 3,
    kind: "gemeinde",
    title: "Berlin",
    location: { geoKey: "11000000", grain: "ags", lon: null, lat: null, name: "Berlin" },
  });
  const ordered = visibleHits([ortsteil, berlin, lor], markedGemeinde);
  assert.deepEqual(
    ordered.map((hit) => hit.location.name),
    ["Planungsraum", "Lankwitz"],
  );
});

test("part and parent are never both hits", () => {
  const child = item({
    id: "lor:plr:1",
    rank: 1,
    kind: "lor",
    title: "Planungsraum",
    location: { geoKey: "lor:plr:1", grain: "other", lon: null, lat: null, name: "Planungsraum", parentLabel: "Lankwitz" },
  });
  const parent = item({
    id: "ortsteil:osm:1",
    rank: 2,
    kind: "ortsteil",
    title: "Lankwitz",
    location: { geoKey: "ortsteil:osm:1", grain: "other", lon: null, lat: null, name: "Lankwitz" },
  });
  const kept = visibleHits([child, parent], markedGemeinde);
  assert.deepEqual(
    kept.map((hit) => hit.location.name),
    ["Planungsraum"],
  );
});

test("address rows stay out of the list until addresses are available", () => {
  const address = item({
    id: "address:1",
    rank: 1,
    kind: "address",
    title: "Weg 1",
    location: { geoKey: "address:1", grain: "address", lon: 13.3, lat: 52.4, name: "Weg 1" },
  });
  assert.equal(visibleHits([address], markedGemeinde).length, 0);
});

test("inherited criteria sit at the end, stay grey copy, and do not count for rank", () => {
  const hit = item({
    id: "lor:plr:1",
    rank: 1,
    kind: "lor",
    criteriaEvidence: [
      {
        key: "einwohner",
        metricId: "einwohner",
        label: "Einwohner",
        direction: "up",
        patternDirection: "up",
        evidence: "steigt",
        coverage: "series",
        scope: "local",
        sourceLevel: "lor",
        baseline: "per_1000_inhabitants",
        baselineMatch: true,
        normalizedValue: 2,
        points: [{ period: "2025", status: "present", value: 2, normalizedValue: 2 }],
      },
      {
        key: "unfallatlas",
        metricId: "unfallatlas",
        label: "Unfälle",
        direction: "down",
        patternDirection: "down",
        evidence: "fällt auf Gemeindeebene",
        coverage: "series",
        scope: "inherited",
        sourceLevel: "gemeinde",
        baseline: "per_1000_inhabitants",
        normalizedValue: 1,
      },
    ],
  });
  const card = buildTrefferCard(hit, [patternDataset]);
  assert.equal(card.criteria.length, 1);
  assert.equal(card.inherited.length, 1);
  assert.equal(card.inherited[0]?.inheritedLabel, "vererbt von Gemeinde");
  assert.equal(inheritedLabel("gemeinde"), "vererbt von Gemeinde");
  assert.equal(card.criteria[0]?.label, "Einwohner");
});

test("coverage single shows a Stichtag number and no line; none is liegt nicht vor", () => {
  const single = item({
    id: "plz5:12247",
    rank: 1,
    kind: "plz",
    trend: undefined,
    criteriaEvidence: [
      {
        key: "zensus",
        label: "Gebäude",
        direction: "unknown",
        patternDirection: "unknown",
        evidence: "Stichtag 2022",
        kind: "stichtag",
        coverage: "single",
        scope: "local",
        sourceLevel: "plz",
        baseline: "per_km2",
        baselineMethod: "official",
        normalizedValue: 18.4,
        rawValue: 184,
        points: [{ period: "2022", status: "present", value: 184, normalizedValue: 18.4 }],
      },
    ],
  });
  const none = item({
    id: "plz5:12248",
    rank: 2,
    kind: "plz",
    trend: undefined,
    criteriaEvidence: [
      {
        key: "zensus",
        label: "Gebäude",
        direction: "unknown",
        patternDirection: "unknown",
        evidence: "liegt nicht vor",
        kind: "absent",
        coverage: "none",
        scope: "local",
        sourceLevel: "plz",
      },
    ],
  });
  const singleCard = buildTrefferCard(single, undefined);
  const noneCard = buildTrefferCard(none, undefined);
  assert.equal(singleCard.criteria[0]?.coverage, "single");
  assert.equal(singleCard.criteria[0]?.stichtagValue, "18,4");
  assert.equal(singleCard.criteria[0]?.stichtagYear, "2022");
  assert.equal(singleCard.criteria[0]?.series.length, 0);
  assert.equal(singleCard.criteria[0]?.direction, null);
  assert.equal(singleCard.trendSummary, null);
  assert.equal(noneCard.criteria[0]?.missing, true);
  assert.equal(noneCard.criteria[0]?.coverage, "none");
  assert.equal(noneCard.criteria[0]?.details.evidence, "liegt nicht vor");
});

test("baselineMatch false or missing pattern shows liegt nicht vor on the pattern line", () => {
  const hit = item({
    id: "lor:plr:1",
    rank: 1,
    kind: "lor",
    criteriaEvidence: [
      {
        key: "einwohner",
        metricId: "einwohner",
        label: "Einwohner",
        direction: "up",
        patternDirection: "up",
        evidence: "steigt",
        coverage: "series",
        scope: "local",
        sourceLevel: "lor",
        baseline: "per_km2",
        baselineMatch: false,
        normalizedValue: 3,
        points: [{ period: "2025", status: "present", value: 3, normalizedValue: 3 }],
      },
    ],
  });
  const mismatch: PatternDatasetProfile = {
    ...patternDataset,
    baseline: "per_1000_inhabitants",
    baselineMatch: false,
  };
  const card = buildTrefferCard(hit, [mismatch]);
  assert.equal(card.criteria[0]?.patternMissing, true);
  assert.deepEqual(card.criteria[0]?.patternSeries, []);
});

test("a pattern criterion without hit evidence still keeps a liegt nicht vor row", () => {
  const hit = item({
    id: "lor:plr:1",
    rank: 1,
    kind: "lor",
    criteriaEvidence: [],
  });
  const extra: PatternDatasetProfile = {
    ...patternDataset,
    metricId: "unfallatlas",
    criterion: { ...patternDataset.criterion, key: "unfallatlas", label: "Unfälle" },
  };
  const card = buildTrefferCard(hit, [patternDataset, extra]);
  assert.equal(card.criteria.length, 2);
  assert.equal(card.criteria.every((row) => row.missing), true);
  assert.equal(card.criteria[1]?.label, "Unfälle");
});

test("no trend or unknown direction yields no Entwicklungssatz", () => {
  const missing = item({ id: "a", rank: 1, trend: undefined });
  const unknown = item({ id: "b", rank: 1, trend: { direction: "unknown", summary: "sollte nicht erscheinen" } });
  const empty = item({ id: "c", rank: 1, trend: { direction: "up", summary: "   " } });
  assert.equal(trendSummary(missing), null);
  assert.equal(trendSummary(unknown), null);
  assert.equal(trendSummary(empty), null);
  assert.equal(trendSummary(item({ id: "d", rank: 1 })), "Einwohner steigt seit drei Jahren, je 1.000 Einwohner.");
});

test("missing geometry is listed and never replaced by a rectangle or point", () => {
  const hit = item({
    id: "lor:plr:1",
    rank: 1,
    kind: "lor",
    geometry: null,
    geometryUnavailableReason: "Schnittfläche leer",
    location: { geoKey: "lor:plr:1", grain: "other", lon: 13.3, lat: 52.4, name: "Planungsraum" },
  });
  const card = buildTrefferCard(hit, [patternDataset]);
  assert.equal(hasDrawableGeometry(hit), false);
  assert.equal(card.geometryMissing, true);
  assert.equal(card.geometryHint, "Die Fläche kann noch nicht gezeichnet werden.");
  assert.equal(card.name, "Planungsraum");
  assert.equal(JSON.stringify(card).includes("Schnittfläche leer"), false);
  assert.equal(JSON.stringify(card).includes("13.3"), false);
});

test("top three after filter stay bound to the marked Zielregion", () => {
  const cards = buildTrefferlisteCards(
    setWith([
      item({ id: "lor:plr:1", rank: 1, kind: "lor", title: "Eins", location: { geoKey: "lor:plr:1", grain: "other", lon: null, lat: null, name: "Eins" } }),
      item({ id: "lor:plr:2", rank: 2, kind: "lor", title: "Zwei", location: { geoKey: "lor:plr:2", grain: "other", lon: null, lat: null, name: "Zwei" } }),
      item({ id: "ags:11000000", rank: 3, kind: "gemeinde", title: "Berlin", location: { geoKey: "11000000", grain: "ags", lon: null, lat: null, name: "Berlin" } }),
    ]),
    markedGemeinde,
  );
  assert.deepEqual(
    cards.map((card) => card.name),
    ["Eins", "Zwei"],
  );
  assert.equal(topHits(setWith([]).items, markedGemeinde).length, 0);
});

test("pattern profile lists datasets without ids or method codes", () => {
  const rows = buildPatternProfile([patternDataset]);
  assert.equal(rows[0]?.label, "Einwohner");
  assert.equal(rows[0]?.levelBadge, "Ortsteil");
  assert.equal(rows[0]?.baselineLabel, "je 1.000 Einwohner");
  assert.equal(rows[0]?.methodLabel, "amtlich");
  const visible = `${rows[0]?.label} ${rows[0]?.levelBadge} ${rows[0]?.baselineLabel} ${rows[0]?.methodLabel}`;
  assert.equal(visible.includes("einwohner"), false);
  assert.equal(visible.includes("official"), false);
  assert.equal(visible.includes("bestand"), false);
});

test("one match surfaces the thin-region hint and the Backend reason", () => {
  const reason = "In der Zielregion liegt nur 1 Standort mit positiver Musterentwicklung in den letzten sechs Monaten vor.";
  assert.deepEqual(recommendationStatus(setWith([item({ id: "a", rank: 1 })], reason)), { empty: false, thin: true, reason });
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
  const full = setWith([
    item({ id: "a", rank: 1 }),
    item({ id: "b", rank: 2 }),
    item({ id: "c", rank: 3 }),
  ]);
  assert.deepEqual(recommendationStatus(full), { empty: false, thin: false, reason: null });
});
