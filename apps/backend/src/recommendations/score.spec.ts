import { AnalysisRegion, PatternCriterion } from "../analysis/types";
import { buildPatternByDataset } from "../analysis/pattern-profile";
import { SeriesLevel, YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate, stampCandidateTargetRegion } from "./area-candidates";
import { recommendationReason } from "./messages";
import { assignRanksByTargetRegion, capRankedByTargetRegion, compareScoredLocations, dataAsOfFromEvidence, localDatasetCountOf, MAX_RANKED_ITEMS, MAX_TARGET_REGIONS, rankTeilflaechen, rankedSlotsPerTargetRegion } from "./score";
import { SCORE_FORMULA_DEFAULTS } from "./score-formula";
import { RecommendationEvidence, ScoredLocation } from "./types";

function candidate(overrides: Partial<AreaCandidate> & Pick<AreaCandidate, "geoKey" | "kind">): AreaCandidate {
  const grain = overrides.grain ?? (overrides.kind === "plz" ? "plz5" : overrides.kind === "gemeinde" ? "ags" : "other");
  return {
    id: `${grain}:${overrides.geoKey}`,
    title: overrides.title ?? overrides.geoKey,
    name: overrides.name ?? overrides.title ?? overrides.geoKey,
    ags: overrides.ags ?? null,
    plz: overrides.plz ?? null,
    lon: overrides.lon ?? null,
    lat: overrides.lat ?? null,
    grain,
    ...overrides,
  };
}

function series(overrides: Partial<YearlySeries> & Pick<YearlySeries, "metricId" | "requestedGeoKey">): YearlySeries {
  return {
    requestedLevel: "ortsteil",
    sourceLevel: "ortsteil",
    sourceGeoKey: overrides.requestedGeoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: 10 },
      { period: "2024", status: "present", value: 12 },
      { period: "2025", status: "present", value: 14 },
    ],
    ...overrides,
  };
}

function inhabitants(
  geoKey: string,
  level: SeriesLevel = "ortsteil",
  value = 10_000,
): YearlySeries {
  return series({
    metricId: "bevoelkerung",
    requestedGeoKey: geoKey,
    requestedLevel: level,
    sourceLevel: level,
    sourceGeoKey: geoKey,
    points: [
      { period: "2023", status: "present", value },
      { period: "2024", status: "present", value },
      { period: "2025", status: "present", value },
    ],
  });
}

const trendUp: PatternCriterion = {
  key: "unfallatlas",
  metricId: "unfallatlas",
  label: "Unfälle",
  direction: "down",
  evidence: "fällt",
  kind: "trend",
  coverage: "multi",
  baseline: "per_1000_inhabitants",
};

function unfallPattern(geoKey: string, first: number, last: number, level: SeriesLevel = "ortsteil") {
  return buildPatternByDataset([
    series({
      metricId: "unfallatlas",
      requestedGeoKey: geoKey,
      requestedLevel: level,
      sourceLevel: level,
      sourceGeoKey: geoKey,
      points: [
        { period: "2023", status: "present", value: first },
        { period: "2025", status: "present", value: last },
      ],
    }),
    inhabitants(geoKey, level),
  ]);
}

const fallingPattern = unfallPattern("ortsteil:osm:store", 20, 8);

describe("rankTeilflaechen", () => {
  it("ranks on closeness to the normalized three-year pattern and keeps Teilflächen that do not match", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:up", kind: "ortsteil", title: "Rising", ags: "09162000" }),
        candidate({ geoKey: "ortsteil:osm:down", kind: "ortsteil", title: "Falling", ags: "09162000" }),
        candidate({ geoKey: "ortsteil:osm:mid", kind: "ortsteil", title: "Mid", ags: "09162000" }),
        candidate({ geoKey: "80801", kind: "plz", grain: "plz5", title: "PLZ 80801", ags: "09162000" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:down",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:down"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:up",
          points: [
            { period: "2023", status: "present", value: 8 },
            { period: "2025", status: "present", value: 20 },
          ],
        }),
        inhabitants("ortsteil:osm:up"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:mid",
          points: [
            { period: "2023", status: "present", value: 14 },
            { period: "2025", status: "present", value: 12 },
          ],
        }),
        inhabitants("ortsteil:osm:mid"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "80801",
          requestedLevel: "plz",
          sourceLevel: "plz",
          coverage: "none",
          points: [
            { period: "2023", status: "absent" },
            { period: "2024", status: "absent" },
            { period: "2025", status: "absent" },
          ],
        }),
      ],
      [trendUp],
      [],
      { patternByDataset: fallingPattern },
    );

    expect(ranked[0]?.title).toBe("Falling");
    expect(ranked.map((item) => item.title)).toEqual(["Falling", "Mid", "Rising"]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[2]?.score ?? 0);
    expect(ranked[0]?.score).toBeLessThanOrEqual(0.5);
    expect(ranked[0]?.criteriaEvidence[0]?.kind).toBe("trend");
    expect(ranked[0]?.criteriaEvidence[0]?.match).toBe(true);
    expect(ranked[0]?.criteriaEvidence[0]?.scope).toBe("local");
    expect(ranked[0]?.criteriaEvidence[0]?.baseline).toBe("per_1000_inhabitants");
    expect(ranked[0]?.criteriaEvidence[0]?.baselineMatch).toBe(true);
    expect(ranked[0]?.criteriaEvidence[0]?.rawValue).toBe(8);
    expect(ranked[0]?.criteriaEvidence[0]?.normalizedValue).toBe(0.8);
    expect(ranked[0]?.criteriaEvidence[0]?.proximity).toBeGreaterThan(0);
    expect(ranked[0]?.localDatasetCount).toBeGreaterThanOrEqual(1);
    expect(ranked[0]?.criteriaEvidence[0]?.trendYears).toBe(2);
    expect(ranked[0]?.criteriaEvidence[0]?.trendFromTwoYears).toBe(true);
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("Dreijahresverlauf");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("je 1.000 Einwohner");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).not.toContain("sechs Monaten");
    expect(ranked.map((item) => item.kind)).not.toContain("plz");
    expect(ranked.map((item) => item.location.geoKey)).not.toContain("09162000");
  });

  it("ranks yearly trend rates so a two-year jump is not compared as a three-year span", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:gap", kind: "ortsteil", title: "Mit Lücke" }),
        candidate({ geoKey: "ortsteil:osm:steep", kind: "ortsteil", title: "Zwei Jahre" }),
        candidate({ geoKey: "ortsteil:osm:far", kind: "ortsteil", title: "Gegenrichtung" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:gap",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2024", status: "absent" },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:gap"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:steep",
          points: [
            { period: "2024", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:steep"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:far",
          points: [
            { period: "2023", status: "present", value: 5 },
            { period: "2025", status: "present", value: 30 },
          ],
        }),
        inhabitants("ortsteil:osm:far"),
      ],
      [trendUp],
      [],
      { patternByDataset: fallingPattern },
    );
    expect(ranked[0]?.title).toBe("Mit Lücke");
    expect(ranked[0]?.criteriaEvidence[0]?.trendYears).toBe(2);
    expect(ranked.find((item) => item.title === "Zwei Jahre")?.score).toBeLessThan(ranked[0]?.score ?? 0);
    expect(ranked[ranked.length - 1]?.title).toBe("Gegenrichtung");
  });

  it("labels a single period as Stichtag and never invents 0 for absent cells", () => {
    const ranked = rankTeilflaechen(
      [candidate({ geoKey: "ortsteil:osm:1", kind: "ortsteil", title: "Schwabing" })],
      [
        series({
          metricId: "zensus2022",
          requestedGeoKey: "ortsteil:osm:1",
          requestedLevel: "gemeinde",
          sourceLevel: "gemeinde",
          coverage: "single",
          points: [
            { period: "2022", status: "present", value: 1017355 },
            { period: "2023", status: "absent" },
            { period: "2024", status: "absent" },
          ],
        }),
        series({
          metricId: "bevoelkerung",
          requestedGeoKey: "ortsteil:osm:1",
          requestedLevel: "gemeinde",
          sourceLevel: "gemeinde",
          sourceGeoKey: "09162000",
          coverage: "single",
          points: [
            { period: "2022", status: "present", value: 1_000_000 },
            { period: "2023", status: "absent" },
            { period: "2024", status: "absent" },
          ],
        }),
      ],
      [
        {
          key: "zensus2022",
          metricId: "zensus2022",
          label: "Zensus 2022 (Gemeinde)",
          direction: "unknown",
          evidence: "Stichtag",
          kind: "stichtag",
          coverage: "single",
          baseline: "per_1000_inhabitants",
        },
      ],
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.criteriaEvidence[0]?.kind).toBe("stichtag");
    expect(ranked[0]?.criteriaEvidence[0]?.direction).toBe("unknown");
    expect(ranked[0]?.criteriaEvidence[0]?.scope).toBe("inherited");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("Stichtag");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toMatch(/übernommen/i);
    expect(ranked[0]?.criteriaEvidence[0]?.points?.find((point) => point.period === "2023")).toEqual({
      period: "2023",
      status: "absent",
    });
    expect(ranked[0]?.criteriaEvidence[0]?.points?.find((point) => point.period === "2023")?.value).toBeUndefined();
    expect(JSON.stringify(ranked[0]?.criteriaEvidence)).not.toMatch(/"value":0/);
  });

  it("does not use a six-month month-to-month window as the score", () => {
    const ranked = rankTeilflaechen(
      [candidate({ geoKey: "80801", kind: "plz", grain: "plz5", title: "Schwabing" })],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "80801",
          requestedLevel: "plz",
          sourceLevel: "plz",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2024", status: "present", value: 9 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("80801", "plz"),
      ],
      [trendUp],
    );
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("2023");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("2025");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).not.toContain("2026-04");
  });

  it("marks parent-level series as inherited and does not let them split siblings", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:a", kind: "ortsteil", title: "Alpha" }),
        candidate({ geoKey: "ortsteil:osm:b", kind: "ortsteil", title: "Beta" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:a",
          requestedLevel: "ortsteil",
          sourceLevel: "gemeinde",
          sourceGeoKey: "09162000",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:b",
          requestedLevel: "ortsteil",
          sourceLevel: "gemeinde",
          sourceGeoKey: "09162000",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:a", "gemeinde"),
        inhabitants("ortsteil:osm:b", "gemeinde"),
      ],
      [trendUp],
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.score).toBe(0);
    expect(ranked[1]?.score).toBe(0);
    expect(ranked[0]?.criteriaEvidence[0]?.scope).toBe("inherited");
    expect(ranked[1]?.criteriaEvidence[0]?.scope).toBe("inherited");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toMatch(/übernommen/i);
    expect(ranked.map((item) => item.title)).toEqual(["Alpha", "Beta"]);
  });

  it("prefers a local kleinräumige series over an inherited parent series for the same criterion", () => {
    const ranked = rankTeilflaechen(
      [candidate({ geoKey: "ortsteil:42", kind: "ortsteil", title: "Eimsbüttel" })],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:42",
          requestedLevel: "ortsteil",
          sourceLevel: "ortsteil",
          sourceGeoKey: "ortsteil:42",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:42",
          requestedLevel: "ortsteil",
          sourceLevel: "gemeinde",
          sourceGeoKey: "02000000",
          points: [
            { period: "2023", status: "present", value: 1 },
            { period: "2025", status: "present", value: 2 },
          ],
        }),
        inhabitants("ortsteil:42"),
      ],
      [trendUp],
    );
    expect(ranked[0]?.criteriaEvidence[0]?.scope).toBe("local");
    expect(ranked[0]?.criteriaEvidence[0]?.sourceLevel).toBe("ortsteil");
    expect(ranked[0]?.criteriaEvidence[0]?.label).toMatch(/Ortsteil/);
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).not.toMatch(/übernommen/i);
  });

  it("matches Berlin Bezirk and Köln PLZ on the same normalized dataset", () => {
    const kba: PatternCriterion = {
      key: "kba_elektro_pkw",
      metricId: "kba_elektro_pkw",
      label: "Elektro-Pkw",
      direction: "up",
      evidence: "steigt",
      kind: "trend",
      coverage: "multi",
      baseline: "per_1000_inhabitants",
    };
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "11000001", kind: "bezirk", title: "Mitte", ags: "11000000" }),
        candidate({ geoKey: "11000002", kind: "bezirk", title: "Friedrichshain", ags: "11000000" }),
        candidate({ geoKey: "11000003", kind: "bezirk", title: "Pankow", ags: "11000000" }),
        candidate({ geoKey: "ortsteil:berlin", kind: "ortsteil", title: "Moabit", ags: "11000000" }),
        candidate({ geoKey: "50667", kind: "plz", grain: "plz5", title: "Köln-Altstadt", ags: "05315000", plz: "50667" }),
        candidate({ geoKey: "50668", kind: "plz", grain: "plz5", title: "Köln-Nord", ags: "05315000", plz: "50668" }),
        candidate({ geoKey: "50670", kind: "plz", grain: "plz5", title: "Köln-West", ags: "05315000", plz: "50670" }),
        candidate({ geoKey: "ortsteil:koeln", kind: "ortsteil", title: "Deutz", ags: "05315000" }),
      ],
      [
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "11000001",
          requestedLevel: "bezirk",
          sourceLevel: "bezirk",
          sourceGeoKey: "11000001",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 40 },
          ],
        }),
        inhabitants("11000001", "bezirk", 10_000),
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "11000002",
          requestedLevel: "bezirk",
          sourceLevel: "bezirk",
          sourceGeoKey: "11000002",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2025", status: "present", value: 12 },
          ],
        }),
        inhabitants("11000002", "bezirk", 10_000),
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "11000003",
          requestedLevel: "bezirk",
          sourceLevel: "bezirk",
          sourceGeoKey: "11000003",
          points: [
            { period: "2023", status: "present", value: 2 },
            { period: "2025", status: "present", value: 3 },
          ],
        }),
        inhabitants("11000003", "bezirk", 10_000),
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "50667",
          requestedLevel: "plz",
          sourceLevel: "plz",
          sourceGeoKey: "50667",
          points: [
            { period: "2023", status: "present", value: 4 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("50667", "plz", 2_000),
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "50668",
          requestedLevel: "plz",
          sourceLevel: "plz",
          sourceGeoKey: "50668",
          points: [
            { period: "2023", status: "present", value: 2 },
            { period: "2025", status: "present", value: 3 },
          ],
        }),
        inhabitants("50668", "plz", 2_000),
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "50670",
          requestedLevel: "plz",
          sourceLevel: "plz",
          sourceGeoKey: "50670",
          points: [
            { period: "2023", status: "present", value: 1 },
            { period: "2025", status: "present", value: 1 },
          ],
        }),
        inhabitants("50670", "plz", 2_000),
      ],
      [kba],
      [],
      {
        patternByDataset: buildPatternByDataset([
          series({
            metricId: "kba_elektro_pkw",
            requestedGeoKey: "store",
            requestedLevel: "plz",
            sourceLevel: "plz",
            sourceGeoKey: "store",
            points: [
              { period: "2023", status: "present", value: 4 },
              { period: "2025", status: "present", value: 8 },
            ],
          }),
          inhabitants("store", "plz", 2_000),
        ]),
      },
    );

    expect(ranked.map((item) => item.kind).sort()).toEqual(["bezirk", "bezirk", "bezirk", "plz", "plz", "plz"]);
    expect(new Set(ranked.map((item) => item.score)).size).toBeGreaterThan(1);
    expect(ranked.find((item) => item.title === "Mitte")?.score).toBeGreaterThan(
      ranked.find((item) => item.title === "Pankow")?.score ?? 0,
    );
    expect(ranked.find((item) => item.kind === "bezirk")?.criteriaEvidence[0]?.normalizedValue).toBeDefined();
    expect(ranked.find((item) => item.kind === "plz")?.criteriaEvidence[0]?.sourceLevel).toBe("plz");
    expect(ranked.map((item) => item.kind)).not.toContain("ortsteil");
  });

  it("lists the intersection grain when datasets live on different Flächen", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "11000001", kind: "bezirk", title: "Mitte", ags: "11000000" }),
        candidate({ geoKey: "10115", kind: "plz", grain: "plz5", title: "10115", ags: "11000000", plz: "10115" }),
        candidate({ geoKey: "ortsteil:mitte", kind: "ortsteil", title: "Ortsteil", ags: "11000000" }),
      ],
      [
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "11000001",
          requestedLevel: "bezirk",
          sourceLevel: "bezirk",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 30 },
          ],
        }),
        inhabitants("11000001", "bezirk"),
        series({
          metricId: "wanderungen",
          requestedGeoKey: "10115",
          requestedLevel: "plz",
          sourceLevel: "plz",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2025", status: "present", value: 20 },
          ],
        }),
        inhabitants("10115", "plz"),
      ],
      [
        {
          key: "kba_elektro_pkw",
          metricId: "kba_elektro_pkw",
          label: "Elektro-Pkw",
          direction: "up",
          evidence: "steigt",
          kind: "trend",
          coverage: "multi",
          baseline: "per_1000_inhabitants",
        },
        {
          key: "wanderungen",
          metricId: "wanderungen",
          label: "Wanderungen",
          direction: "up",
          evidence: "steigt",
          kind: "trend",
          coverage: "multi",
          baseline: "per_1000_inhabitants",
        },
      ],
    );

    expect(ranked.map((item) => item.kind)).toEqual(["plz"]);
    expect(ranked[0]?.title).toBe("PLZ 10115");
    expect(ranked[0]?.grain).toBe("plz5");
    expect(ranked[0]?.name).toBe("PLZ 10115");
    expect(ranked[0]?.parentLabel).toBe("Berlin");
    expect(ranked[0]?.intersectionOf).toEqual([
      { geoKey: "11000001", grain: "other", name: "Mitte", datasetKey: "kba_elektro_pkw" },
      { geoKey: "10115", grain: "plz5", name: "PLZ 10115", datasetKey: "wanderungen" },
    ]);
  });

  it("omits intersectionOf when the hit is a single Fläche", () => {
    const ranked = rankTeilflaechen(
      [candidate({ geoKey: "ortsteil:osm:1", kind: "ortsteil", title: "Schwabing" })],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:1",
          requestedLevel: "ortsteil",
          sourceLevel: "ortsteil",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:1"),
      ],
      [
        {
          key: "unfallatlas",
          metricId: "unfallatlas",
          label: "Unfälle",
          direction: "down",
          evidence: "fällt",
          kind: "trend",
        },
      ],
    );
    expect(ranked[0]?.intersectionOf).toBeUndefined();
    expect(ranked[0]?.name).toBe("Schwabing");
    expect(ranked[0]?.grain).toBe("other");
  });

  it("always fills name with documented fallbacks and never a catalog key", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({
          geoKey: "koeln:sq:101010001",
          kind: "quartier",
          name: "koeln:sq:101010001",
          title: "koeln:sq:101010001",
          ags: "05315000",
        }),
        candidate({
          geoKey: "lor:plr:07400823",
          kind: "lor",
          name: "Wittekindstraße",
          title: "lor:plr:07400823",
          ags: "11000000",
        }),
        candidate({
          geoKey: "80331",
          kind: "plz",
          grain: "plz5",
          name: "80331",
          title: "80331",
          plz: "80331",
          ags: "09162000",
        }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "koeln:sq:101010001",
          requestedLevel: "quartier",
          sourceLevel: "quartier",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("koeln:sq:101010001", "quartier"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "lor:plr:07400823",
          requestedLevel: "lor",
          sourceLevel: "lor",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("lor:plr:07400823", "lor"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "80331",
          requestedLevel: "plz",
          sourceLevel: "plz",
          points: [
            { period: "2023", status: "present", value: 10 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("80331", "plz"),
      ],
      [trendUp],
    );
    expect(ranked.every((item) => typeof item.name === "string" && item.name.length > 0)).toBe(true);
    expect(ranked.find((item) => item.kind === "quartier")?.name).toBe("Quartier ohne Namen");
    expect(ranked.find((item) => item.kind === "quartier")?.name).not.toContain("koeln:sq:");
    expect(ranked.find((item) => item.kind === "lor")?.name).toBe("Wittekindstraße");
    expect(ranked.find((item) => item.kind === "plz")?.name).toBe("PLZ 80331");
  });

  it("treats a missing Bezugsgröße as absent and never invents 0", () => {
    const ranked = rankTeilflaechen(
      [candidate({ geoKey: "50667", kind: "plz", grain: "plz5", title: "Altstadt" })],
      [
        series({
          metricId: "kba_elektro_pkw",
          requestedGeoKey: "50667",
          requestedLevel: "plz",
          sourceLevel: "plz",
          points: [
            { period: "2023", status: "present", value: 4 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
      ],
      [
        {
          key: "kba_elektro_pkw",
          metricId: "kba_elektro_pkw",
          label: "Elektro-Pkw",
          direction: "up",
          evidence: "steigt",
          kind: "trend",
          coverage: "multi",
          baseline: "per_1000_inhabitants",
        },
      ],
    );
    expect(ranked[0]?.criteriaEvidence[0]?.kind).toBe("absent");
    expect(ranked[0]?.criteriaEvidence[0]?.status).toBe("absent");
    expect(ranked[0]?.criteriaEvidence[0]?.rawValue).toBe(8);
    expect(ranked[0]?.criteriaEvidence[0]?.normalizedValue).toBeUndefined();
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toMatch(/Bezugsgröße/);
    expect(JSON.stringify(ranked[0]?.criteriaEvidence)).not.toMatch(/"normalizedValue":0/);
    expect(ranked[0]?.score).toBe(0);
  });

  it("passes clipped geometry through and explains when the outline is missing", () => {
    const polygon = {
      type: "Polygon" as const,
      coordinates: [
        [
          [11.4, 48.0],
          [11.7, 48.0],
          [11.7, 48.3],
          [11.4, 48.3],
          [11.4, 48.0],
        ],
      ],
    };
    const ranked = rankTeilflaechen(
      [
        candidate({
          geoKey: "ortsteil:osm:down",
          kind: "ortsteil",
          title: "Falling",
          ags: "09162000",
          geometry: polygon,
          geometryUnavailableReason: null,
        }),
        candidate({ geoKey: "ortsteil:osm:up", kind: "ortsteil", title: "Rising", ags: "09162000" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:down",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:down"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:up",
          points: [
            { period: "2023", status: "present", value: 8 },
            { period: "2025", status: "present", value: 20 },
          ],
        }),
        inhabitants("ortsteil:osm:up"),
      ],
      [trendUp],
    );

    expect(ranked[0]?.geometry).toEqual(polygon);
    expect(ranked[0]?.geometryUnavailableReason).toBeNull();
    expect(ranked[0]?.trend?.direction).toBe("down");
    expect(ranked[0]?.trend?.summary).toContain("Dreijahresverlauf");
    expect(ranked[1]?.geometry).toBeNull();
    expect(ranked[1]?.geometryUnavailableReason).toMatch(/gezeichnet/);
  });

  it("does not put catalog keys into title, labels, or trend.summary", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({
          geoKey: "lor:plr:01100310",
          kind: "lor",
          title: "lor:plr:01100310",
          name: "lor:plr:01100310",
          ags: "11000000",
        }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "lor:plr:01100310",
          requestedLevel: "lor",
          sourceLevel: "lor",
          sourceGeoKey: "lor:plr:01100310",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("lor:plr:01100310", "lor"),
      ],
      [trendUp],
    );
    expect(ranked[0]?.title).toBe("Planungsraum ohne Namen");
    expect(ranked[0]?.name).toBe("Planungsraum ohne Namen");
    expect(JSON.stringify(ranked[0]?.criteriaEvidence.map((entry) => [entry.label, entry.evidence]))).not.toMatch(
      /lor:plr:/,
    );
    expect(ranked[0]?.trend?.summary ?? "").not.toMatch(/lor:plr:/);
  });

  it("treats a baseline mismatch as absent and omits normalizedValue", () => {
    const ranked = rankTeilflaechen(
      [candidate({ geoKey: "ortsteil:osm:down", kind: "ortsteil", title: "Falling", ags: "09162000" })],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:down",
          points: [
            { period: "2023", status: "present", value: 20, baselineMethod: "estimate_address" },
            { period: "2025", status: "present", value: 8, baselineMethod: "estimate_address" },
          ],
        }),
        inhabitants("ortsteil:osm:down"),
      ],
      [
        {
          ...trendUp,
          baseline: "per_km2",
          baselineMethod: "official",
        },
      ],
    );

    expect(ranked[0]?.criteriaEvidence[0]?.baselineMatch).toBe(false);
    expect(ranked[0]?.criteriaEvidence[0]?.kind).toBe("absent");
    expect(ranked[0]?.criteriaEvidence[0]?.status).toBe("absent");
    expect(ranked[0]?.criteriaEvidence[0]?.normalizedValue).toBeUndefined();
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toMatch(/liegt nicht vor/);
    expect(ranked[0]?.score).toBe(0);
    expect(ranked[0]?.trend).toEqual({ direction: "unknown", summary: "" });
  });

  it("ranks a Bezirk-scale candidate pool without RangeError and under a few seconds", () => {
    const started = Date.now();
    const pool: AreaCandidate[] = [];
    for (let index = 0; index < 8_000; index += 1) {
      pool.push(
        candidate({
          geoKey: `ortsteil:osm:${index}`,
          kind: "ortsteil",
          title: `Teil ${index}`,
          name: `Teil ${index}`,
          ags: "05315000",
        }),
      );
    }
    const yearly: YearlySeries[] = pool.slice(0, 50).map((item) =>
      series({
        metricId: "unfallatlas",
        requestedGeoKey: item.geoKey,
        requestedLevel: "ortsteil",
        sourceLevel: "ortsteil",
        sourceGeoKey: item.geoKey,
      }),
    );
    const ranked = rankTeilflaechen(pool, yearly, [trendUp]);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(200);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("sets dataAsOf from the newest present evidence period", () => {
    const ranked = rankTeilflaechen(
      [candidate({ geoKey: "ortsteil:osm:1", kind: "ortsteil", title: "Schwabing" })],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:1",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025-03", status: "present", value: 8 },
            { period: "2024", status: "absent" },
          ],
        }),
        inhabitants("ortsteil:osm:1"),
      ],
      [trendUp],
    );
    expect(ranked[0]?.dataAsOf).toBe("2025-03");
    expect(dataAsOfFromEvidence([])).toBeNull();
  });
});

describe("rank je Zielregion", () => {
  const koeln = "bezirk:osm:2613798";
  const berlinKeys = [
    "ortsteil:osm:licht",
    "ortsteil:osm:tempel",
    "ortsteil:osm:marien",
    "ortsteil:osm:lank",
    "ortsteil:osm:steg",
  ];

  it("starts each of 6 Zielregionen at rank 1, gapless, Quartier+Stadtteil together, ags=null", () => {
    const regions = [region(koeln, "Innenstadt"), ...berlinKeys.map((key, index) => region(key, `Berlin-${index}`))];
    const pool: AreaCandidate[] = [];
    const yearly: YearlySeries[] = [];
    for (let index = 0; index < 8; index += 1) {
      const geoKey = `koeln:sq:10101000${index}`;
      pool.push(
        stampCandidateTargetRegion(
          candidate({
            geoKey,
            kind: "quartier",
            title: `Quartier ${index}`,
            name: `Quartier ${index}`,
            ags: null,
            plz: null,
          }),
          koeln,
        ),
      );
      yearly.push(localUnfall(geoKey, index < 4 ? 20 : 8, index < 4 ? 8 : 20, "quartier"), inhabitants(geoKey, "quartier"));
    }
    for (const name of ["Altstadt-Nord", "Altstadt-Süd", "Deutz"]) {
      const geoKey = `stadtteil:osm:${name}`;
      pool.push(
        stampCandidateTargetRegion(
          candidate({ geoKey, kind: "stadtteil", title: name, name, ags: null, plz: null }),
          koeln,
        ),
      );
      yearly.push(localUnfall(geoKey, 10, 12, "ortsteil"), inhabitants(geoKey, "ortsteil"));
    }
    berlinKeys.forEach((regionKey, regionIndex) => {
      for (let index = 0; index < 4; index += 1) {
        const geoKey = `lor:plr:06${regionIndex}${index}`;
        pool.push(
          stampCandidateTargetRegion(
            candidate({
              geoKey,
              kind: "lor",
              title: `LOR ${regionIndex}-${index}`,
              name: `LOR ${regionIndex}-${index}`,
              ags: null,
              plz: null,
            }),
            regionKey,
          ),
        );
        yearly.push(localUnfall(geoKey, 20, index === 0 ? 8 : 20, "lor"), inhabitants(geoKey, "lor"));
      }
    });

    const scored = rankTeilflaechen(pool, yearly, [trendUp], regions, { patternByDataset: fallingPattern });
    const ranked = assignRanksByTargetRegion(
      scored.map((item) => ({ ...item, rationale: "", source: "heuristic" as const })),
      regions.map((item) => item.geoKey ?? ""),
    );

    expect(new Set(ranked.map((item) => item.targetRegionGeoKey))).toEqual(
      new Set([koeln, ...berlinKeys]),
    );
    for (const regionKey of [koeln, ...berlinKeys]) {
      const group = ranked.filter((item) => item.targetRegionGeoKey === regionKey);
      expect(group.map((item) => item.rank)).toEqual(group.map((_, index) => index + 1));
      expect(group[0]?.rank).toBe(1);
      const scores = group.map((item) => item.score);
      expect(scores).toEqual([...scores].sort((left, right) => right - left));
    }
    const koelnGroup = ranked.filter((item) => item.targetRegionGeoKey === koeln);
    expect(koelnGroup.some((item) => item.kind === "quartier")).toBe(true);
    expect(koelnGroup.some((item) => item.kind === "stadtteil")).toBe(true);
    const firstStadtteil = koelnGroup.find((item) => item.kind === "stadtteil");
    const lastMatchingQuartier = [...koelnGroup].reverse().find((item) => item.kind === "quartier" && item.score > 0);
    expect(firstStadtteil && lastMatchingQuartier && firstStadtteil.rank > lastMatchingQuartier.rank).toBe(true);
  });

  it("does not let a dominant region take every slot; each region keeps at least 3 hits", () => {
    const regions = [region(koeln, "Innenstadt"), ...berlinKeys.map((key) => region(key, key))];
    const pool: AreaCandidate[] = [];
    const yearly: YearlySeries[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const geoKey = `koeln:sq:${index}`;
      pool.push(
        stampCandidateTargetRegion(
          candidate({ geoKey, kind: "quartier", title: `K ${index}`, name: `K ${index}`, ags: null }),
          koeln,
        ),
      );
      yearly.push(localUnfall(geoKey, 20, 8, "quartier"), inhabitants(geoKey, "quartier"));
    }
    berlinKeys.forEach((regionKey, regionIndex) => {
      for (let index = 0; index < 8; index += 1) {
        const geoKey = `lor:plr:${regionIndex}${index}`;
        pool.push(
          stampCandidateTargetRegion(
            candidate({ geoKey, kind: "lor", title: `B ${regionIndex}-${index}`, name: `B ${regionIndex}-${index}`, ags: null }),
            regionKey,
          ),
        );
        yearly.push(localUnfall(geoKey, 10, 12, "lor"), inhabitants(geoKey, "lor"));
      }
    });

    const scored = rankTeilflaechen(pool, yearly, [trendUp], regions);
    expect(scored.length).toBeLessThanOrEqual(MAX_RANKED_ITEMS);
    const byRegion = new Map<string, number>();
    for (const item of scored) {
      const key = item.targetRegionGeoKey;
      byRegion.set(key, (byRegion.get(key) ?? 0) + 1);
    }
    expect(byRegion.get(koeln) ?? 0).toBeGreaterThan(3);
    for (const regionKey of berlinKeys) {
      expect(byRegion.get(regionKey) ?? 0).toBeGreaterThanOrEqual(3);
    }
    expect([...byRegion.values()].reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(200);
  });

  it("keeps an overlapping Fläche once per Zielregion with unique ids", () => {
    const left = "ortsteil:osm:licht";
    const right = "ortsteil:osm:steg";
    const geoKey = "plz5:12207";
    const pool = [
      stampCandidateTargetRegion(
        candidate({ geoKey, kind: "plz", grain: "plz5", title: "PLZ 12207", name: "PLZ 12207", ags: null }),
        left,
      ),
      stampCandidateTargetRegion(
        candidate({ geoKey, kind: "plz", grain: "plz5", title: "PLZ 12207", name: "PLZ 12207", ags: null }),
        right,
      ),
    ];
    expect(pool[0]?.id).not.toBe(pool[1]?.id);
    const yearly = [
      localUnfall(geoKey, 20, 8, "plz"),
      inhabitants(geoKey, "plz"),
    ];
    const scored = rankTeilflaechen(pool, yearly, [trendUp], [region(left, "Lichterfelde"), region(right, "Steglitz")]);
    expect(scored).toHaveLength(2);
    expect(new Set(scored.map((item) => item.id)).size).toBe(2);
    expect(new Set(scored.map((item) => item.targetRegionGeoKey))).toEqual(new Set([left, right]));
    const ranked = assignRanksByTargetRegion(
      scored.map((item) => ({ ...item, rationale: "", source: "heuristic" as const })),
      [left, right],
    );
    expect(ranked.map((item) => item.rank)).toEqual([1, 1]);
    expect(ranked[0]?.targetRegionGeoKey).toBe(left);
    expect(ranked[1]?.targetRegionGeoKey).toBe(right);
  });
});

describe("rankedSlotsPerTargetRegion / capRankedByTargetRegion", () => {
  it("gives at least 3 slots for n=66 and keeps every region", () => {
    expect(rankedSlotsPerTargetRegion(66)).toBe(3);
    const capped = capRankedByTargetRegion(poolForRegions(66, 10));
    expect(capped.length).toBeLessThanOrEqual(MAX_RANKED_ITEMS);
    expect(capped.length).toBe(MAX_RANKED_ITEMS);
    const keys = new Set(capped.map((item) => item.targetRegionGeoKey));
    expect(keys.size).toBe(66);
    for (const key of keys) {
      expect(capped.filter((item) => item.targetRegionGeoKey === key).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives at least 1 slot for n=67 and keeps every region", () => {
    expect(rankedSlotsPerTargetRegion(67)).toBe(Math.floor(200 / 67));
    expect(rankedSlotsPerTargetRegion(67)).toBeGreaterThanOrEqual(1);
    const capped = capRankedByTargetRegion(poolForRegions(67, 10));
    expect(capped.length).toBe(MAX_RANKED_ITEMS);
    const keys = new Set(capped.map((item) => item.targetRegionGeoKey));
    expect(keys.size).toBe(67);
    for (const key of keys) {
      expect(capped.filter((item) => item.targetRegionGeoKey === key).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives exactly 1 slot for n=200 and keeps every region", () => {
    expect(rankedSlotsPerTargetRegion(200)).toBe(1);
    const capped = capRankedByTargetRegion(poolForRegions(200, 5));
    expect(capped.length).toBe(MAX_RANKED_ITEMS);
    const keys = new Set(capped.map((item) => item.targetRegionGeoKey));
    expect(keys.size).toBe(200);
    for (const key of keys) {
      expect(capped.filter((item) => item.targetRegionGeoKey === key).length).toBe(1);
    }
  });

  it("rejects more than 200 Zielregionen instead of dropping one", () => {
    expect(() => rankedSlotsPerTargetRegion(MAX_TARGET_REGIONS + 1)).toThrow(/too many target regions/);
    expect(() => capRankedByTargetRegion(poolForRegions(201, 1))).toThrow(/too many target regions/);
  });
});

function localUnfall(geoKey: string, first: number, last: number, level: SeriesLevel = "ortsteil"): YearlySeries {
  return series({
    metricId: "unfallatlas",
    requestedGeoKey: geoKey,
    requestedLevel: level,
    sourceLevel: level,
    sourceGeoKey: geoKey,
    points: [
      { period: "2023", status: "present", value: first },
      { period: "2025", status: "present", value: last },
    ],
  });
}

function region(geoKey: string, label: string): AnalysisRegion {
  return {
    label,
    grain: "other",
    geoKey,
    level: "ortsteil",
    parentLabel: label.startsWith("Berlin") || ["Lichterfelde", "Steglitz"].includes(label) ? "Berlin" : "Köln",
    ags: null,
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function scoredItem(regionKey: string, index: number, score: number): ScoredLocation {
  return {
    id: `other:hit-${regionKey}-${index}@${regionKey}`,
    title: `${regionKey}-${index}`,
    kind: "ortsteil",
    grain: "other",
    name: `${regionKey}-${index}`,
    parentLabel: null,
    targetRegionGeoKey: regionKey,
    dataAsOf: "2025",
    location: { geoKey: `hit-${regionKey}-${index}`, grain: "other", lon: null, lat: null, name: null },
    score,
    criteriaEvidence: [],
  };
}

function poolForRegions(regionCount: number, perRegion: number): ScoredLocation[] {
  const items: ScoredLocation[] = [];
  for (let regionIndex = 0; regionIndex < regionCount; regionIndex += 1) {
    const key = `r:${regionIndex}`;
    for (let index = 0; index < perRegion; index += 1) {
      items.push(scoredItem(key, index, 1 - index / Math.max(perRegion, 1)));
    }
  }
  return items;
}

describe("score formula on rankTeilflaechen", () => {
  it("treats absent, inherited, single coverage, and n<3 as neutral (no proximity)", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:a", kind: "ortsteil", title: "Alpha" }),
        candidate({ geoKey: "ortsteil:osm:b", kind: "ortsteil", title: "Beta" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:a",
          requestedLevel: "ortsteil",
          sourceLevel: "gemeinde",
          sourceGeoKey: "09162000",
          coverage: "single",
          points: [{ period: "2024", status: "present", value: 10 }],
        }),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:b",
          coverage: "none",
          points: [{ period: "2024", status: "absent" }],
        }),
      ],
      [trendUp],
      [],
      { patternByDataset: fallingPattern },
    );
    expect(ranked.every((item) => item.score === 0)).toBe(true);
    expect(ranked.every((item) => item.localDatasetCount === 0)).toBe(true);
    expect(ranked.every((item) => item.criteriaEvidence[0]?.proximity === undefined)).toBe(true);
  });

  it("does not list inherited-only candidates when siblings have local data", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:a", kind: "ortsteil", title: "Alpha" }),
        candidate({ geoKey: "ortsteil:osm:b", kind: "ortsteil", title: "Beta" }),
        candidate({ geoKey: "ortsteil:osm:c", kind: "ortsteil", title: "Gamma" }),
        candidate({ geoKey: "ortsteil:osm:d", kind: "ortsteil", title: "Inherited only" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:a",
          coverage: "multi",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:a"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:b",
          coverage: "multi",
          points: [
            { period: "2023", status: "present", value: 18 },
            { period: "2025", status: "present", value: 12 },
          ],
        }),
        inhabitants("ortsteil:osm:b"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:c",
          coverage: "multi",
          points: [
            { period: "2023", status: "present", value: 16 },
            { period: "2025", status: "present", value: 10 },
          ],
        }),
        inhabitants("ortsteil:osm:c"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:d",
          requestedLevel: "ortsteil",
          sourceLevel: "gemeinde",
          sourceGeoKey: "09162000",
          coverage: "multi",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
      ],
      [trendUp],
      [],
      { patternByDataset: fallingPattern },
    );
    expect(ranked).toHaveLength(3);
    expect(ranked.map((item) => item.title)).not.toContain("Inherited only");
    expect(ranked[0]?.criteriaEvidence[0]?.proximity).toBeGreaterThan(0);
    expect(ranked.every((item) => item.localDatasetCount === 1)).toBe(true);
  });

  it("does not let one dataset reach score 1.0 even when proximity is 1", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:down", kind: "ortsteil", title: "Falling" }),
        candidate({ geoKey: "ortsteil:osm:mid", kind: "ortsteil", title: "Mid" }),
        candidate({ geoKey: "ortsteil:osm:up", kind: "ortsteil", title: "Rising" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:down",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:down"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:mid",
          points: [
            { period: "2023", status: "present", value: 14 },
            { period: "2025", status: "present", value: 12 },
          ],
        }),
        inhabitants("ortsteil:osm:mid"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:up",
          points: [
            { period: "2023", status: "present", value: 8 },
            { period: "2025", status: "present", value: 20 },
          ],
        }),
        inhabitants("ortsteil:osm:up"),
      ],
      [trendUp],
      [],
      { patternByDataset: fallingPattern, config: SCORE_FORMULA_DEFAULTS },
    );
    expect(ranked[0]?.criteriaEvidence[0]?.proximity).toBeGreaterThan(0.9);
    expect(ranked[0]?.score).toBeLessThanOrEqual(0.5);
    expect(ranked[0]?.score).toBe(0.5);
    expect(ranked.every((item) => item.localDatasetCount === 1)).toBe(true);
  });

  it("sets localDatasetCount 0 on Stichtag-only hits (missing proximity does not count)", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:a", kind: "ortsteil", title: "Alpha" }),
        candidate({ geoKey: "ortsteil:osm:b", kind: "ortsteil", title: "Beta" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:a",
          coverage: "single",
          points: [{ period: "2024", status: "present", value: 10 }],
        }),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:b",
          coverage: "none",
          points: [{ period: "2024", status: "absent" }],
        }),
      ],
      [trendUp],
      [],
      { patternByDataset: fallingPattern },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.title).toBe("Alpha");
    expect(ranked[0]?.score).toBe(0);
    expect(ranked[0]?.localDatasetCount).toBe(0);
    expect(ranked[0]?.criteriaEvidence.every((entry) => typeof entry.proximity !== "number")).toBe(true);
    expect(JSON.parse(JSON.stringify(ranked[0])).localDatasetCount).toBe(0);
  });

  it("counts proximity 0 as nAktiv 1 (gültige Nähe gering) and ignores inherited values", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:match", kind: "ortsteil", title: "Match" }),
        candidate({ geoKey: "ortsteil:osm:mid", kind: "ortsteil", title: "Mid" }),
        candidate({ geoKey: "ortsteil:osm:far", kind: "ortsteil", title: "Far" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:match",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("ortsteil:osm:match"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:mid",
          points: [
            { period: "2023", status: "present", value: 18 },
            { period: "2025", status: "present", value: 10 },
          ],
        }),
        inhabitants("ortsteil:osm:mid"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:far",
          points: [
            { period: "2023", status: "present", value: 1 },
            { period: "2025", status: "present", value: 200 },
          ],
        }),
        inhabitants("ortsteil:osm:far"),
      ],
      [trendUp],
      [],
      { patternByDataset: fallingPattern },
    );
    const far = ranked.find((item) => item.title === "Far");
    expect(far?.criteriaEvidence[0]?.proximity).toBe(0);
    expect(far?.localDatasetCount).toBe(1);
    expect(ranked.every((item) => item.localDatasetCount === 1)).toBe(true);
  });

  it("weights a local LOR dataset above an inherited parent and a coarser local Ebene", () => {
    const wander: PatternCriterion = {
      key: "wanderungen",
      metricId: "wanderungen",
      label: "Wanderungen",
      direction: "down",
      evidence: "fällt",
      kind: "trend",
      coverage: "multi",
      baseline: "per_1000_inhabitants",
    };
    const patternByDataset = buildPatternByDataset([
      series({
        metricId: "unfallatlas",
        requestedGeoKey: "store-lor",
        requestedLevel: "lor",
        sourceLevel: "lor",
        sourceGeoKey: "store-lor",
        points: [
          { period: "2023", status: "present", value: 20 },
          { period: "2025", status: "present", value: 8 },
        ],
      }),
      inhabitants("store-lor", "lor"),
      series({
        metricId: "wanderungen",
        requestedGeoKey: "store-bezirk",
        requestedLevel: "bezirk",
        sourceLevel: "bezirk",
        sourceGeoKey: "store-bezirk",
        points: [
          { period: "2023", status: "present", value: 30 },
          { period: "2025", status: "present", value: 10 },
        ],
      }),
      inhabitants("store-bezirk", "bezirk"),
    ]);
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "lor:plr:a", kind: "lor", title: "LOR A" }),
        candidate({ geoKey: "lor:plr:b", kind: "lor", title: "LOR B" }),
        candidate({ geoKey: "lor:plr:c", kind: "lor", title: "LOR C" }),
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "lor:plr:a",
          requestedLevel: "lor",
          sourceLevel: "lor",
          points: [
            { period: "2023", status: "present", value: 20 },
            { period: "2025", status: "present", value: 8 },
          ],
        }),
        inhabitants("lor:plr:a", "lor"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "lor:plr:b",
          requestedLevel: "lor",
          sourceLevel: "lor",
          points: [
            { period: "2023", status: "present", value: 12 },
            { period: "2025", status: "present", value: 11 },
          ],
        }),
        inhabitants("lor:plr:b", "lor"),
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "lor:plr:c",
          requestedLevel: "lor",
          sourceLevel: "lor",
          points: [
            { period: "2023", status: "present", value: 8 },
            { period: "2025", status: "present", value: 20 },
          ],
        }),
        inhabitants("lor:plr:c", "lor"),
        series({
          metricId: "wanderungen",
          requestedGeoKey: "lor:plr:a",
          requestedLevel: "lor",
          sourceLevel: "gemeinde",
          sourceGeoKey: "11000000",
          points: [
            { period: "2023", status: "present", value: 30 },
            { period: "2025", status: "present", value: 10 },
          ],
        }),
        series({
          metricId: "wanderungen",
          requestedGeoKey: "lor:plr:b",
          requestedLevel: "lor",
          sourceLevel: "gemeinde",
          sourceGeoKey: "11000000",
          points: [
            { period: "2023", status: "present", value: 30 },
            { period: "2025", status: "present", value: 10 },
          ],
        }),
        series({
          metricId: "wanderungen",
          requestedGeoKey: "lor:plr:c",
          requestedLevel: "lor",
          sourceLevel: "gemeinde",
          sourceGeoKey: "11000000",
          points: [
            { period: "2023", status: "present", value: 30 },
            { period: "2025", status: "present", value: 10 },
          ],
        }),
      ],
      [trendUp, wander],
      [],
      { patternByDataset },
    );
    expect(ranked[0]?.title).toBe("LOR A");
    expect(ranked[0]?.criteriaEvidence.find((entry) => entry.key === "unfallatlas")?.proximity).toBeGreaterThan(0);
    expect(ranked[0]?.criteriaEvidence.find((entry) => entry.key === "wanderungen")?.proximity).toBeUndefined();
    expect(ranked[0]?.criteriaEvidence.find((entry) => entry.key === "wanderungen")?.scope).toBe("inherited");
    expect(ranked[0]?.localDatasetCount).toBe(1);
  });

  it("breaks ties by coverage, then overlaps-share, then stable id, never the visible name", () => {
    const left: ScoredLocation = {
      id: "other:z-last",
      title: "AAA zuerst",
      kind: "ortsteil",
      grain: "other",
      name: "AAA zuerst",
      parentLabel: null,
      targetRegionGeoKey: "r",
      dataAsOf: "2025",
      location: { geoKey: "z-last", grain: "other", lon: null, lat: null, name: "AAA zuerst" },
      score: 0.4,
      criteriaEvidence: [{ key: "unfallatlas", label: "Unfälle", direction: "down", patternDirection: "down", evidence: "x", proximity: 0.8 }],
      overlaps: [{ geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 0.02, isTargetRegion: true }],
    };
    const right: ScoredLocation = {
      id: "other:a-first",
      title: "ZZZ später",
      kind: "ortsteil",
      grain: "other",
      name: "ZZZ später",
      parentLabel: null,
      targetRegionGeoKey: "r",
      dataAsOf: "2025",
      location: { geoKey: "a-first", grain: "other", lon: null, lat: null, name: "ZZZ später" },
      score: 0.4,
      criteriaEvidence: [
        { key: "unfallatlas", label: "Unfälle", direction: "down", patternDirection: "down", evidence: "x", proximity: 0.8 },
        { key: "wanderungen", label: "Wanderungen", direction: "up", patternDirection: "up", evidence: "y", proximity: 0.5 },
      ],
      overlaps: [{ geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 0.999, isTargetRegion: true }],
    };
    expect(compareScoredLocations(left, right)).toBeGreaterThan(0);
    const sameCoverage: ScoredLocation = {
      ...left,
      id: "other:name-wins-not",
      title: "AAA",
      criteriaEvidence: right.criteriaEvidence,
      overlaps: [{ geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 0.12, isTargetRegion: true }],
    };
    expect(compareScoredLocations(sameCoverage, right)).toBeGreaterThan(0);
    const edgeBeforeInnerById: ScoredLocation = {
      ...sameCoverage,
      id: "other:aaa-edge",
      title: "Alt-Lankwitz",
      targetOverlapShare: 0.000008,
      overlaps: [{ geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 0.000008, isTargetRegion: true }],
    };
    const innerAfterEdgeById: ScoredLocation = {
      ...right,
      id: "other:zzz-inner",
      title: "Wittekindstraße",
      targetOverlapShare: 1,
      overlaps: [{ geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 1, isTargetRegion: true }],
    };
    expect(compareScoredLocations(edgeBeforeInnerById, innerAfterEdgeById)).toBeGreaterThan(0);
    const sameShare: ScoredLocation = {
      ...sameCoverage,
      overlaps: right.overlaps,
      id: "other:b-second",
      title: "AAA",
    };
    expect(compareScoredLocations(sameShare, { ...right, id: "other:a-first" })).toBeGreaterThan(0);
  });

  it("keeps score-0 inherited/Stichtag items and orders them by Zielregion share, then id", () => {
    const lowShare: ScoredLocation = {
      id: "other:zzz-edge",
      title: "Randfläche zuerst nach id",
      kind: "ortsteil",
      grain: "other",
      name: "Randfläche",
      parentLabel: null,
      targetRegionGeoKey: "r",
      dataAsOf: "2025",
      location: { geoKey: "zzz-edge", grain: "other", lon: null, lat: null, name: "Randfläche" },
      score: 0,
      criteriaEvidence: [{ key: "unfallatlas", label: "Unfälle", direction: "down", patternDirection: "down", evidence: "Stichtag", kind: "stichtag" }],
      targetOverlapShare: 0.02,
      overlaps: [{ geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 0.02, isTargetRegion: true }],
    };
    const highShare: ScoredLocation = {
      ...lowShare,
      id: "other:aaa-inner",
      title: "Innere Fläche später nach id",
      name: "Innen",
      location: { ...lowShare.location, geoKey: "aaa-inner", name: "Innen" },
      targetOverlapShare: 0.99,
      overlaps: [{ geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 0.99, isTargetRegion: true }],
    };
    expect(compareScoredLocations(lowShare, highShare)).toBeGreaterThan(0);
    const laterId: ScoredLocation = { ...lowShare, id: "other:b-second", targetOverlapShare: 0.5, overlaps: [{ ...lowShare.overlaps![0], share: 0.5 }] };
    const earlierId: ScoredLocation = { ...highShare, id: "other:a-first", targetOverlapShare: 0.5, overlaps: [{ ...highShare.overlaps![0], share: 0.5 }] };
    expect(compareScoredLocations(laterId, earlierId)).toBeGreaterThan(0);
  });
});

describe("localDatasetCountOf", () => {
  const row = (overrides: Partial<RecommendationEvidence> = {}): RecommendationEvidence => ({
    key: "unfallatlas",
    label: "Unfälle",
    direction: "down",
    patternDirection: "down",
    evidence: "x",
    ...overrides,
  });

  it("counts own local numeric proximity including 0 and ignores inherited or missing", () => {
    expect(localDatasetCountOf([row({ proximity: 0 })])).toBe(1);
    expect(localDatasetCountOf([row({ scope: "local", proximity: 0 })])).toBe(1);
    expect(localDatasetCountOf([row({ scope: "local", proximity: 0.4 }), row({ scope: "local", proximity: 0 })])).toBe(2);
    expect(localDatasetCountOf([row()])).toBe(0);
    expect(localDatasetCountOf([row({ scope: "inherited", proximity: 0.9 })])).toBe(0);
    expect(localDatasetCountOf([row({ proximity: Number.NaN })])).toBe(0);
    expect(
      localDatasetCountOf([
        row({ scope: "local", proximity: 0 }),
        row({ key: "wanderungen", scope: "inherited", proximity: 1 }),
      ]),
    ).toBe(1);
  });
});

describe("recommendationReason", () => {
  it("is empty only when no Teilfläche exists", () => {
    expect(recommendationReason({ candidateCount: 0, truncated: false })).toContain("keine feinere Teilfläche");
    expect(recommendationReason({ candidateCount: 1, truncated: false })).toBeNull();
    expect(recommendationReason({ candidateCount: 3, truncated: true })).toContain("Zeilenlimit");
  });
});
