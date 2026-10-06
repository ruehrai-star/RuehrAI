import { AnalysisRegion, PatternCriterion } from "../analysis/types";
import { SeriesLevel, YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate, stampCandidateTargetRegion } from "./area-candidates";
import { recommendationReason } from "./messages";
import { assignRanksByTargetRegion, dataAsOfFromEvidence, MAX_RANKED_ITEMS, rankTeilflaechen } from "./score";

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

describe("rankTeilflaechen", () => {
  it("ranks on the normalized three-year trend and keeps Teilflächen that do not match", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:up", kind: "ortsteil", title: "Rising", ags: "09162000" }),
        candidate({ geoKey: "ortsteil:osm:down", kind: "ortsteil", title: "Falling", ags: "09162000" }),
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
    );

    expect(ranked.map((item) => item.title)).toEqual(["Falling", "Rising"]);
    expect(ranked[0]?.score).toBe(1);
    expect(ranked[0]?.criteriaEvidence[0]?.kind).toBe("trend");
    expect(ranked[0]?.criteriaEvidence[0]?.match).toBe(true);
    expect(ranked[0]?.criteriaEvidence[0]?.scope).toBe("local");
    expect(ranked[0]?.criteriaEvidence[0]?.baseline).toBe("per_1000_inhabitants");
    expect(ranked[0]?.criteriaEvidence[0]?.baselineMatch).toBe(true);
    expect(ranked[0]?.criteriaEvidence[0]?.rawValue).toBe(8);
    expect(ranked[0]?.criteriaEvidence[0]?.normalizedValue).toBe(0.8);
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("Dreijahresverlauf");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("je 1.000 Einwohner");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).not.toContain("sechs Monaten");
    expect(ranked[1]?.score).toBe(0);
    expect(ranked.map((item) => item.kind)).not.toContain("plz");
    expect(ranked.map((item) => item.location.geoKey)).not.toContain("09162000");
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
    expect(ranked[0]?.score).toBe(1);
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
        candidate({ geoKey: "ortsteil:berlin", kind: "ortsteil", title: "Moabit", ags: "11000000" }),
        candidate({ geoKey: "50667", kind: "plz", grain: "plz5", title: "Köln-Altstadt", ags: "05315000", plz: "50667" }),
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
      ],
      [kba],
    );

    expect(ranked.map((item) => item.kind).sort()).toEqual(["bezirk", "plz"]);
    expect(ranked.every((item) => item.score === 1)).toBe(true);
    expect(ranked.find((item) => item.kind === "bezirk")?.criteriaEvidence[0]?.normalizedValue).toBe(4);
    expect(ranked.find((item) => item.kind === "plz")?.criteriaEvidence[0]?.normalizedValue).toBe(4);
    expect(ranked.find((item) => item.kind === "bezirk")?.criteriaEvidence[0]?.sourceLevel).toBe("bezirk");
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

    const scored = rankTeilflaechen(pool, yearly, [trendUp], regions);
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
    const lastMatchingQuartier = [...koelnGroup].reverse().find((item) => item.kind === "quartier" && item.score === 1);
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

describe("recommendationReason", () => {
  it("is empty only when no Teilfläche exists", () => {
    expect(recommendationReason({ candidateCount: 0, truncated: false })).toContain("keine feinere Teilfläche");
    expect(recommendationReason({ candidateCount: 1, truncated: false })).toBeNull();
    expect(recommendationReason({ candidateCount: 3, truncated: true })).toContain("Zeilenlimit");
  });
});
