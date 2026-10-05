import { PatternCriterion } from "../analysis/types";
import { SeriesLevel, YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate } from "./area-candidates";
import { recommendationReason } from "./messages";
import { rankTeilflaechen } from "./score";

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
    expect(ranked[0]?.title).toBe("10115");
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
});

describe("recommendationReason", () => {
  it("is empty only when no Teilfläche exists", () => {
    expect(recommendationReason({ candidateCount: 0, truncated: false })).toContain("keine feinere Teilfläche");
    expect(recommendationReason({ candidateCount: 1, truncated: false })).toBeNull();
    expect(recommendationReason({ candidateCount: 3, truncated: true })).toContain("Zeilenlimit");
  });
});
