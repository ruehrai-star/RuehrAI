import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Recommendation, RecommendationSet } from "../api/types.ts";
import type { PatternDatasetProfile } from "@ruehrai/api-contracts";
import {
  RECOMMENDATION_COPY,
  SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT,
  areaKindBadge,
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
  hitName,
  inheritedLabel,
  intersectionLine,
  mapDisplayName,
  overlapDetailLines,
  overlapLageSentence,
  rankLabel,
  recommendationEmptyCopy,
  recommendationStatus,
  recommendationSubtitle,
  seriesLevelBadge,
  shortCriteria,
  stichtagCopy,
  topHits,
  trefferStatusCopy,
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
    targetRegionGeoKey: "ortsteil:osm:5712247",
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
  assert.equal(RECOMMENDATION_COPY.loading, "Wird geladen …");
  assert.equal(RECOMMENDATION_COPY.analysisRunning, "Analyse läuft …");
  assert.equal(RECOMMENDATION_COPY.analysisFailed, "Analyse fehlgeschlagen.");
  assert.equal(RECOMMENDATION_COPY.loadFailed, "Der Stand konnte gerade nicht geladen werden.");
  assert.equal(RECOMMENDATION_COPY.retryLoad, "Erneut versuchen");
  assert.equal(RECOMMENDATION_COPY.restartAnalysis, "Erneut starten");
  assert.equal(RECOMMENDATION_COPY.analysisDeadline, "Analyse fehlgeschlagen: Die Berechnung hat zu lange gedauert.");
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
  assert.equal(headingForMarkedRegion(markedGemeinde), "Top 3 in Ihrer Zielregion Berlin");
  assert.equal(headingForMarkedRegion(null), null);
});

test("Trefferliste heading is always singular for the currently marked Zielregion", () => {
  const markedRodenkirchen = {
    label: "Rodenkirchen",
    geoKey: "stadtbezirk:koeln:rodenkirchen",
    grain: "ags" as const,
    level: "gemeinde" as const,
    parentLabel: "Köln",
  };
  assert.equal(headingForMarkedRegion(markedRodenkirchen), "Top 3 in Ihrer Zielregion Rodenkirchen (Köln)");
  assert.equal(headingForMarkedRegion(markedGemeinde), "Top 3 in Ihrer Zielregion Berlin");
  assert.equal(RECOMMENDATION_COPY.subtitle, "Top 3 in Ihrer Zielregion");
  assert.equal(RECOMMENDATION_COPY.subtitlePlural, "Top 3 in Ihren Zielregionen");
  assert.equal(headingForMarkedRegion(markedRodenkirchen)?.includes("Zielregionen"), false);
  assert.equal(headingForMarkedRegion(markedRodenkirchen)?.includes("weitere"), false);
  assert.equal(headingForMarkedRegion(markedRodenkirchen)?.includes("Innenstadt"), false);

  const page = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  assert.match(page, /headingForMarkedRegion\(marked\)/);
  assert.equal(page.includes("subtitlePlural"), false);
  assert.equal(page.includes("formatRunRegionLabel"), false);
  assert.match(page, /<h1>\{heading \?\? RECOMMENDATION_COPY\.title\}<\/h1>/);
  assert.match(page, /\{standPrefix \?[\s\S]*<RunRegionLabel regions=\{runRegions\} \/>[\s\S]*<h1>\{heading \?\? RECOMMENDATION_COPY\.title\}<\/h1>/);
  assert.match(page, /RECOMMENDATION_COPY\.empty/);
  assert.equal(page.includes("emptyPlural"), false);
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
  assert.equal(hitBadge(item({ id: "lor:plr:01100101", rank: 1, kind: "lor", location: { geoKey: "lor:plr:01100101", grain: "other", lon: null, lat: null, name: "PLR" } })), "Planungsraum");
  assert.equal(hitBadge(item({ id: "koeln:sq:12", rank: 1, kind: "quartier", location: { geoKey: "koeln:sq:12", grain: "other", lon: null, lat: null, name: "Belgisches Viertel" } })), "Quartier");
  assert.equal(hitBadge(item({ id: "grid100:1", rank: 1, kind: "grid100", location: { geoKey: "grid100:1", grain: "grid100", lon: null, lat: null, name: "Zelle" } })), "100-m-Raster");
  assert.equal(areaKindBadge("lor"), "Planungsraum");
  assert.equal(areaKindBadge("quartier"), "Quartier");
  assert.equal(seriesLevelBadge("lor"), "Planungsraum");
  assert.equal(inheritedLabel("lor"), "vererbt von Planungsraum");
  const visible = [
    hitBadge(item({ id: "lor:plr:01100101", rank: 1, kind: "lor", location: { geoKey: "lor:plr:01100101", grain: "other", lon: null, lat: null, name: "Planungsraum" } })),
    hitBadge(item({ id: "koeln:sq:12", rank: 1, kind: "quartier", location: { geoKey: "koeln:sq:12", grain: "other", lon: null, lat: null, name: "Quartier" } })),
  ].join(" ");
  assert.equal(visible.includes("lor:plr"), false);
  assert.equal(visible.includes("koeln:sq"), false);
  assert.equal(visible.includes("LOR"), false);
});

test("Berlin LOR badge is Planungsraum; Köln badge is Quartier", () => {
  const berlin = item({
    id: "lor:plr:07400720",
    rank: 1,
    kind: "lor",
    name: "Lankwitz Süd",
    location: { geoKey: "lor:plr:07400720", grain: "other", lon: null, lat: null, name: "Lankwitz Süd" },
  });
  const koeln = item({
    id: "koeln:sq:12",
    rank: 1,
    kind: "quartier",
    name: "Belgisches Viertel",
    location: { geoKey: "koeln:sq:12", grain: "other", lon: null, lat: null, name: "Belgisches Viertel" },
  });
  assert.equal(hitBadge(berlin), "Planungsraum");
  assert.equal(buildTrefferCard(berlin, undefined).badge, "Planungsraum");
  assert.equal(hitBadge(koeln), "Quartier");
  assert.equal(buildTrefferCard(koeln, undefined).badge, "Quartier");
});

test("raster name is always 100-m-Rasterzelle without an ID", () => {
  const withId = item({
    id: "grid100:100mN32700E42100",
    rank: 1,
    kind: "grid100",
    name: "Rasterzelle 100mN32700E42100",
    title: "Rasterzelle 100mN32700E42100",
    location: { geoKey: "grid100:100mN32700E42100", grain: "grid100", lon: null, lat: null, name: "Rasterzelle 100mN32700E42100" },
  });
  const clean = item({
    id: "grid100:2",
    rank: 2,
    kind: "grid100",
    name: "100-m-Rasterzelle",
    location: { geoKey: "grid100:2", grain: "grid100", lon: null, lat: null, name: "100-m-Rasterzelle" },
  });
  assert.equal(hitName(withId), "100-m-Rasterzelle");
  assert.equal(hitBadge(withId), "100-m-Raster");
  assert.equal(hitName(clean), "100-m-Rasterzelle");
  assert.equal(hitName(withId).includes("100mN"), false);
  const card = buildTrefferCard(withId, undefined);
  assert.equal(card.name, "100-m-Rasterzelle");
  assert.equal(`${card.name} ${card.badge} ${card.lage ?? ""}`.includes("100mN32700E42100"), false);
});

test("hit names never show a geoKey or internal ID", () => {
  const ortsteil = item({
    id: "ortsteil:osm:5712247",
    rank: 1,
    kind: "ortsteil",
    name: "Ortsteil osm:5712247",
    title: "ortsteil:osm:5712247",
    location: { geoKey: "ortsteil:osm:5712247", grain: "other", lon: null, lat: null, name: null },
  });
  const address = item({
    id: "address:geo_addr_9",
    rank: 1,
    kind: "address",
    name: "Adresse address:geo_addr_9",
    title: "address:geo_addr_9",
    location: { geoKey: "address:geo_addr_9", grain: "address", lon: null, lat: null, name: null },
  });
  const lorFallback = item({
    id: "lor:plr:07400720",
    rank: 1,
    kind: "lor",
    name: "Planungsraum 07400720",
    location: { geoKey: "lor:plr:07400720", grain: "other", lon: null, lat: null, name: "Planungsraum 07400720" },
  });
  const lorEmpty = item({
    id: "lor:plr:07400720",
    rank: 1,
    kind: "lor",
    name: undefined,
    title: "lor:plr:07400720",
    location: { geoKey: "lor:plr:07400720", grain: "other", lon: null, lat: null, name: null },
  });
  assert.equal(hitName(ortsteil), "Ortsteil ohne Namen");
  assert.equal(hitName(address), "Adresse ohne Hausnummer");
  assert.equal(hitName(lorFallback), "Planungsraum ohne Namen");
  assert.equal(hitName(lorEmpty), "Planungsraum ohne Namen");
  for (const visible of [hitName(ortsteil), hitName(address), hitName(lorEmpty), hitName(lorFallback)]) {
    assert.equal(visible.includes("osm:"), false);
    assert.equal(visible.includes("address:"), false);
    assert.equal(visible.includes("geo_addr"), false);
    assert.equal(visible.includes("lor:plr:"), false);
    assert.equal(/\d{8}/.test(visible), false);
  }
});

test("unnamed LOR never appends a number from lor:plr", () => {
  const empty = item({
    id: "lor:plr:07400823",
    rank: 1,
    kind: "lor",
    title: "lor:plr:07400823",
    location: { geoKey: "lor:plr:07400823", grain: "other", lon: null, lat: null, name: null },
  });
  assert.equal(hitName(empty), "Planungsraum ohne Namen");
  assert.equal(hitName(empty).includes("07400823"), false);
  assert.equal(buildTrefferCard(empty, undefined).name, "Planungsraum ohne Namen");
});

test("backend Planungsraum plus eight digits maps to Planungsraum ohne Namen", () => {
  const numbered = item({
    id: "lor:plr:07400823",
    rank: 1,
    kind: "lor",
    name: "Planungsraum 07400823",
    location: { geoKey: "lor:plr:07400823", grain: "other", lon: null, lat: null, name: "Planungsraum 07400823" },
  });
  const named = item({
    id: "lor:plr:07400720",
    rank: 1,
    kind: "lor",
    name: "Lankwitz Süd",
    location: { geoKey: "lor:plr:07400720", grain: "other", lon: null, lat: null, name: "Lankwitz Süd" },
  });
  assert.equal(hitName(numbered), "Planungsraum ohne Namen");
  assert.equal(hitName(numbered).includes("07400823"), false);
  assert.equal(buildTrefferCard(numbered, undefined).name, "Planungsraum ohne Namen");
  assert.equal(hitName(named), "Lankwitz Süd");
});

test("unnamed Köln Quartier never appends a number from koeln:sq", () => {
  const empty = item({
    id: "koeln:sq:101",
    rank: 1,
    kind: "quartier",
    title: "koeln:sq:101",
    location: { geoKey: "koeln:sq:101", grain: "other", lon: null, lat: null, name: null },
  });
  assert.equal(hitName(empty), "Quartier ohne Namen");
  assert.equal(hitName(empty).includes("101"), false);
  assert.equal(buildTrefferCard(empty, undefined).name, "Quartier ohne Namen");
});

test("backend Quartier plus digits maps to Quartier ohne Namen", () => {
  const numbered = item({
    id: "koeln:sq:101",
    rank: 1,
    kind: "quartier",
    name: "Quartier 101",
    location: { geoKey: "koeln:sq:101", grain: "other", lon: null, lat: null, name: "Quartier 101" },
  });
  const named = item({
    id: "koeln:sq:12",
    rank: 1,
    kind: "quartier",
    name: "Belgisches Viertel",
    location: { geoKey: "koeln:sq:12", grain: "other", lon: null, lat: null, name: "Belgisches Viertel" },
  });
  assert.equal(hitName(numbered), "Quartier ohne Namen");
  assert.equal(hitName(numbered).includes("101"), false);
  assert.equal(buildTrefferCard(numbered, undefined).name, "Quartier ohne Namen");
  assert.equal(hitName(named), "Belgisches Viertel");
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

test("filters drop Zielregion and enclosing areas; order follows backend rank only", () => {
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
    ["Lankwitz", "Planungsraum"],
  );
});

test("a finer area with a worse rank does not jump above rank 1 or drop it from Top 3", () => {
  const rank1 = item({
    id: "ortsteil:osm:1",
    rank: 1,
    kind: "ortsteil",
    title: "Lankwitz",
    location: { geoKey: "ortsteil:osm:1", grain: "other", lon: null, lat: null, name: "Lankwitz" },
  });
  const rank2 = item({
    id: "plz5:12247",
    rank: 2,
    kind: "plz",
    title: "12247",
    location: { geoKey: "plz5:12247", grain: "plz5", lon: null, lat: null, name: "12247" },
  });
  const rank3 = item({
    id: "lor:plr:1",
    rank: 3,
    kind: "lor",
    title: "Planungsraum A",
    location: { geoKey: "lor:plr:1", grain: "other", lon: null, lat: null, name: "Planungsraum A" },
  });
  const rank4 = item({
    id: "lor:plr:2",
    rank: 4,
    kind: "lor",
    title: "Planungsraum B",
    location: { geoKey: "lor:plr:2", grain: "other", lon: null, lat: null, name: "Planungsraum B" },
  });
  const top = topHits([rank4, rank3, rank2, rank1], markedGemeinde);
  assert.deepEqual(
    top.map((hit) => hit.location.name),
    ["Lankwitz", "12247", "Planungsraum A"],
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
  assert.equal(stichtagCopy(singleCard.criteria[0]?.stichtagValue ?? null, singleCard.criteria[0]?.stichtagYear ?? null), "18,4 · Stichtag 2022");
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

test("coverage single without a value is only liegt nicht vor and never reads a year from evidence", () => {
  const source = readFileSync(new URL("./model.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\(\?:Stichtag\|Jahr\)/);
  const missing = item({
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
        points: [{ period: "2022", status: "present", value: 184 }],
      },
    ],
  });
  const card = buildTrefferCard(missing, undefined);
  assert.equal(card.criteria[0]?.coverage, "single");
  assert.equal(card.criteria[0]?.missing, true);
  assert.equal(card.criteria[0]?.stichtagValue, null);
  assert.equal(card.criteria[0]?.stichtagYear, null);
  assert.equal(stichtagCopy(card.criteria[0]?.stichtagValue ?? null, card.criteria[0]?.stichtagYear ?? null), "liegt nicht vor");
});

test("loading copy stays neutral; Analyse läuft is only the in-flight line", () => {
  const page = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  assert.equal(RECOMMENDATION_COPY.loading, "Wird geladen …");
  assert.equal(RECOMMENDATION_COPY.analysisRunning, "Analyse läuft …");
  assert.match(page, /trefferStatusCopy/);
  assert.match(page, /status\.text/);
  assert.equal(page.includes("Analyse läuft"), false);
  assert.deepEqual(trefferStatusCopy({ pageLoading: true, bindLoading: false, runStatus: "queued" }), {
    text: "Wird geladen …",
    tone: "loading",
  });
  assert.deepEqual(trefferStatusCopy({ pageLoading: false, bindLoading: true, runStatus: "running" }), {
    text: "Wird geladen …",
    tone: "loading",
  });
  assert.deepEqual(trefferStatusCopy({ pageLoading: false, bindLoading: false, runStatus: "queued" }), {
    text: "Analyse läuft …",
    tone: "running",
  });
  assert.deepEqual(trefferStatusCopy({ pageLoading: false, bindLoading: false, runStatus: "running" }), {
    text: "Analyse läuft …",
    tone: "running",
  });
  assert.deepEqual(trefferStatusCopy({ pageLoading: false, bindLoading: false, runStatus: "idle" }), {
    text: null,
    tone: null,
  });
  assert.deepEqual(trefferStatusCopy({ pageLoading: false, bindLoading: false, runStatus: "deadline" }), {
    text: "Analyse fehlgeschlagen: Die Berechnung hat zu lange gedauert.",
    tone: "error",
  });
});

test("bindFailed uses a neutral load sentence and Erneut versuchen, not Analyse fehlgeschlagen", () => {
  const page = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  assert.equal(RECOMMENDATION_COPY.loadFailed, "Der Stand konnte gerade nicht geladen werden.");
  assert.equal(RECOMMENDATION_COPY.retryLoad, "Erneut versuchen");
  assert.match(page, /RECOMMENDATION_COPY\.loadFailed/);
  assert.match(page, /RECOMMENDATION_COPY\.retryLoad/);
  const failedBlock = page.slice(page.indexOf("bindPhase === \"failed\""));
  assert.match(failedBlock, /loadFailed/);
  assert.equal(failedBlock.slice(0, 400).includes("analysisFailed"), false);
});

test("Musteranalyse starten and Erneut starten stay disabled while a run is in flight", () => {
  const page = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  assert.match(page, /analysisStartLocked/);
  assert.match(page, /disabled=\{startLocked\}/);
  assert.match(page, /RECOMMENDATION_COPY\.startAnalysis/);
  assert.match(page, /RECOMMENDATION_COPY\.restartAnalysis/);
  assert.match(page, /startGate\.current/);
  assert.match(page, /\{showEmptyRun \?[\s\S]*RECOMMENDATION_COPY\.startAnalysis[\s\S]*disabled=\{startLocked\}/);
  assert.match(page, /async function onStartAnalysis\(\) \{[\s\S]*startGate\.current[\s\S]*analysisStartLocked/);
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

test("pattern profile coverage single shows the value plus Stichtag year", () => {
  const single: PatternDatasetProfile = {
    ...patternDataset,
    metricId: "zensus",
    sourceLevel: "plz",
    yearlySeries: {
      ...patternDataset.yearlySeries,
      metricId: "zensus",
      coverage: "single",
      points: [{ period: "2022", status: "present", value: 184, normalizedValue: 18.4 }],
    },
    criterion: {
      key: "zensus",
      label: "Gebäude",
      direction: "unknown",
      evidence: "Stichtag 2022",
      kind: "stichtag",
      coverage: "single",
    },
  };
  const absent: PatternDatasetProfile = {
    ...single,
    metricId: "leerstand",
    yearlySeries: {
      ...single.yearlySeries,
      metricId: "leerstand",
      coverage: "single",
      points: [],
    },
    criterion: {
      key: "leerstand",
      label: "Leerstand",
      direction: "unknown",
      evidence: "Stichtag 2022",
      kind: "stichtag",
      coverage: "single",
    },
  };
  const rows = buildPatternProfile([single, absent]);
  assert.equal(rows[0]?.coverage, "single");
  assert.equal(rows[0]?.missing, false);
  assert.equal(rows[0]?.stichtagValue, "18,4");
  assert.equal(rows[0]?.stichtagYear, "2022");
  assert.equal(stichtagCopy(rows[0]?.stichtagValue ?? null, rows[0]?.stichtagYear ?? null), "18,4 · Stichtag 2022");
  assert.equal(rows[1]?.missing, true);
  assert.equal(rows[1]?.stichtagValue, null);
  assert.equal(rows[1]?.stichtagYear, null);
  assert.equal(stichtagCopy(rows[1]?.stichtagValue ?? null, rows[1]?.stichtagYear ?? null), "liegt nicht vor");
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

test("top-level name and grain win over the deprecated location fields", () => {
  const hit = item({
    id: "ortsteil:osm:1",
    rank: 1,
    name: "Innenstadt",
    grain: "other",
    parentLabel: "Köln",
    title: "ortsteil:osm:1",
    location: { geoKey: "ortsteil:osm:1", grain: "other", lon: null, lat: null, name: "Altname" },
  });
  assert.equal(hitName(hit), "Innenstadt");
  const card = buildTrefferCard(hit, undefined);
  assert.equal(card.name, "Innenstadt");
  assert.equal(card.parentLabel, "Köln");
  const fallback = item({
    id: "ortsteil:osm:2",
    rank: 1,
    title: "Titel",
    location: { geoKey: "ortsteil:osm:2", grain: "other", lon: null, lat: null, name: "Lankwitz" },
  });
  assert.equal(hitName(fallback), "Lankwitz");
});

test("intersectionOf names the Schnittfläche and ignores title or parts heuristics", () => {
  const named = item({
    id: "cut:1",
    rank: 1,
    title: "Schnittfläche aus X und Y",
    name: "Schnitt",
    intersectionOf: [
      { geoKey: "ags:1", grain: "ags", name: "Mitte" },
      { geoKey: "plz5:10115", grain: "plz5", name: "10115" },
    ],
  });
  const keyed = item({
    id: "cut:2",
    rank: 2,
    title: "Schnittfläche aus A und B",
    intersectionOf: [
      { geoKey: "ags:1", grain: "ags", name: "ags:1" },
      { geoKey: "plz5:10115", grain: "plz5", name: null },
    ],
  });
  const withParts = {
    ...item({ id: "cut:3", rank: 3, title: "Schnittfläche aus Alt und Heuristik" }),
    parts: ["Alt", "Heuristik"],
  } as Recommendation;
  assert.equal(intersectionLine(named), "Schnittfläche aus Mitte und 10115");
  assert.equal(buildTrefferCard(named, undefined).intersection, "Schnittfläche aus Mitte und 10115");
  assert.equal(intersectionLine(keyed), null);
  assert.equal(intersectionLine(withParts), null);
  assert.equal(JSON.stringify(buildTrefferCard(named, undefined)).includes("ags:1"), false);
});

test("Lage-Satz from overlaps: one entry or share 1, two, three, four or more, rounding, missing, Details", () => {
  assert.equal(SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT, true);
  const one = [
    { geoKey: "stadtbezirk:au", label: "Au-Haidhausen", kind: "stadtbezirk" as const, share: 1 },
  ];
  const two = [
    { geoKey: "stadtbezirk:a", label: "Altstadt-Lehel", kind: "stadtbezirk" as const, share: 0.624 },
    { geoKey: "stadtbezirk:b", label: "Ludwigsvorstadt-Isarvorstadt", kind: "stadtbezirk" as const, share: 0.376 },
  ];
  const three = [
    { geoKey: "bezirk:1", label: "Mitte", kind: "bezirk" as const, share: 0.5 },
    { geoKey: "bezirk:2", label: "Pankow", kind: "bezirk" as const, share: 0.3 },
    { geoKey: "bezirk:3", label: "Lichtenberg", kind: "bezirk" as const, share: 0.2 },
  ];
  const four = [
    { geoKey: "stadtbezirk:1", label: "Innenstadt", kind: "stadtbezirk" as const, share: 0.4 },
    { geoKey: "stadtbezirk:2", label: "Lindenthal", kind: "stadtbezirk" as const, share: 0.3 },
    { geoKey: "stadtbezirk:3", label: "Nippes", kind: "stadtbezirk" as const, share: 0.2 },
    { geoKey: "stadtbezirk:4", label: "Ehrenfeld", kind: "stadtbezirk" as const, share: 0.1 },
  ];
  assert.equal(overlapLageSentence(one), "Liegt in Au-Haidhausen.");
  assert.equal(
    overlapLageSentence(two),
    "Liegt zu 62 % in Altstadt-Lehel und zu 38 % in Ludwigsvorstadt-Isarvorstadt.",
  );
  assert.equal(overlapLageSentence(three), "Liegt zu 50 % in Mitte, zu 30 % in Pankow und zu 20 % in Lichtenberg.");
  assert.equal(
    overlapLageSentence(four),
    "Liegt zu 40 % in Innenstadt, zu 30 % in Lindenthal, zu 20 % in Nippes und weiteren.",
  );
  assert.equal(overlapDetailLines([{ geoKey: "x", label: "Rund", kind: "bezirk", share: 0.625 }])[0], "Rund: 63 %");
  assert.equal(
    overlapLageSentence([
      { geoKey: "a", label: "A", kind: "bezirk", share: 0.625 },
      { geoKey: "b", label: "B", kind: "bezirk", share: 0.375 },
    ]),
    "Liegt zu 63 % in A und zu 38 % in B.",
  );
  assert.equal(overlapLageSentence(undefined), null);
  assert.equal(overlapLageSentence([]), null);
  const missing = item({ id: "plz5:81541", rank: 1, kind: "plz" });
  const empty = item({ id: "plz5:81542", rank: 1, kind: "plz", overlaps: [] });
  const cardOne = buildTrefferCard(item({ id: "grid100:1", rank: 1, kind: "grid100", name: "100-m-Rasterzelle", overlaps: one, location: { geoKey: "grid100:1", grain: "grid100", lon: null, lat: null, name: "Zelle" } }), undefined);
  const cardFour = buildTrefferCard(item({ id: "plz5:50667", rank: 1, kind: "plz", overlaps: four }), undefined);
  const cardMissing = buildTrefferCard(missing, undefined);
  const cardEmpty = buildTrefferCard(empty, undefined);
  assert.equal(cardOne.lage, "Liegt in Au-Haidhausen.");
  assert.equal(cardMissing.lage, null);
  assert.equal(cardEmpty.lage, null);
  assert.deepEqual(cardMissing.overlapDetails, []);
  assert.deepEqual(cardEmpty.overlapDetails, []);
  assert.deepEqual(overlapDetailLines(four), [
    "Innenstadt: 40 %",
    "Lindenthal: 30 %",
    "Nippes: 20 %",
    "Ehrenfeld: 10 %",
  ]);
  assert.deepEqual(cardFour.overlapDetails, overlapDetailLines(four));
  const visible = `${cardFour.lage ?? ""} ${cardFour.overlapDetails.join(" ")}`;
  assert.equal(visible.includes("stadtbezirk:"), false);
  assert.equal(visible.includes("geoKey"), false);
  assert.equal(cardOne.name, "100-m-Rasterzelle");
});

test("overlap labels use the same name mapping as hits", () => {
  const lorNumbered = [
    { geoKey: "lor:plr:07400720", label: "Planungsraum 07400720", kind: "lor" as const, share: 1 },
  ];
  const quartierNumbered = [
    { geoKey: "koeln:sq:101", label: "Quartier 101", kind: "quartier" as const, share: 0.6 },
    { geoKey: "koeln:sq:12", label: "Belgisches Viertel", kind: "quartier" as const, share: 0.4 },
  ];
  const lorKeyed = [
    { geoKey: "lor:plr:07400823", label: "lor:plr:07400823", kind: "lor" as const, share: 1 },
  ];
  const raster = [
    {
      geoKey: "grid100:100mN32700E42100",
      label: "Rasterzelle 100mN32700E42100",
      kind: "grid100" as const,
      share: 1,
    },
  ];
  const bezirk = [{ geoKey: "bezirk:11000001", label: "Mitte", kind: "bezirk" as const, share: 1 }];
  const ortsteil = [
    { geoKey: "ortsteil:osm:5712247", label: "Ortsteil osm:5712247", kind: "ortsteil" as const, share: 1 },
  ];
  const unnamedQuartier = [{ geoKey: "koeln:sq:101", label: "", kind: "quartier" as const, share: 1 }];

  assert.equal(overlapLageSentence(lorNumbered), "Liegt in Planungsraum ohne Namen.");
  assert.equal(overlapDetailLines(lorNumbered)[0], "Planungsraum ohne Namen: 100 %");
  assert.equal(
    overlapLageSentence(quartierNumbered),
    "Liegt zu 60 % in Quartier ohne Namen und zu 40 % in Belgisches Viertel.",
  );
  assert.deepEqual(overlapDetailLines(quartierNumbered), [
    "Quartier ohne Namen: 60 %",
    "Belgisches Viertel: 40 %",
  ]);
  assert.equal(overlapLageSentence(lorKeyed), "Liegt in Planungsraum ohne Namen.");
  assert.equal(overlapLageSentence(raster), "Liegt in 100-m-Rasterzelle.");
  assert.equal(overlapLageSentence(bezirk), "Liegt in Mitte.");
  assert.equal(overlapLageSentence(ortsteil), "Liegt in Ortsteil ohne Namen.");
  assert.equal(overlapLageSentence(unnamedQuartier), "Liegt in Quartier ohne Namen.");

  const lorHit = item({
    id: "lor:plr:07400720",
    rank: 1,
    kind: "lor",
    name: "Planungsraum 07400720",
    location: { geoKey: "lor:plr:07400720", grain: "other", lon: null, lat: null, name: "Planungsraum 07400720" },
  });
  const quartierHit = item({
    id: "koeln:sq:101",
    rank: 1,
    kind: "quartier",
    name: "Quartier 101",
    location: { geoKey: "koeln:sq:101", grain: "other", lon: null, lat: null, name: "Quartier 101" },
  });
  assert.equal(hitName(lorHit), mapDisplayName({ name: "Planungsraum 07400720", kind: "lor", geoKey: "lor:plr:07400720" }));
  assert.equal(hitName(quartierHit), mapDisplayName({ name: "Quartier 101", kind: "quartier", geoKey: "koeln:sq:101" }));
  assert.equal(hitName(lorHit), "Planungsraum ohne Namen");
  assert.equal(hitName(quartierHit), "Quartier ohne Namen");

  const card = buildTrefferCard(
    item({ id: "plz5:12247", rank: 1, kind: "plz", name: "PLZ 12247", overlaps: [...lorNumbered, ...quartierNumbered] }),
    undefined,
  );
  assert.equal(card.lage, "Liegt in Planungsraum ohne Namen.");
  assert.deepEqual(card.overlapDetails, [
    "Planungsraum ohne Namen: 100 %",
    "Quartier ohne Namen: 60 %",
    "Belgisches Viertel: 40 %",
  ]);
  const visible = `${card.lage ?? ""} ${card.overlapDetails.join(" ")}`;
  assert.equal(visible.includes("07400720"), false);
  assert.equal(visible.includes("101"), false);
  assert.equal(visible.includes("lor:"), false);
  assert.equal(visible.includes("koeln:sq"), false);
  assert.equal(visible.includes("100mN"), false);
  assert.equal(/\d{8}/.test(visible), false);
});

test("Lage-Satz sits in the card header and Details, not in the Begründung", () => {
  const page = readFileSync(new URL("../../components/empfehlungen-page.tsx", import.meta.url), "utf8");
  const head = page.slice(page.indexOf("function TrefferCard"), page.indexOf("card.trendSummary"));
  assert.match(head, /card\.lage/);
  assert.match(head, /treffer-lage/);
  assert.match(page, /card\.overlapDetails/);
  assert.equal(page.includes("card.lage ? <p className=\"message\">"), false);
});
