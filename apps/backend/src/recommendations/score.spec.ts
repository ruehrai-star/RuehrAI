import { PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
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

const trendUp: PatternCriterion = {
  key: "unfallatlas",
  label: "Unfälle",
  direction: "down",
  evidence: "fällt",
  kind: "trend",
  coverage: "multi",
};

describe("rankTeilflaechen", () => {
  it("ranks on three-year trend and keeps Teilflächen that do not match", () => {
    const ranked = rankTeilflaechen(
      [
        candidate({ geoKey: "ortsteil:osm:up", kind: "ortsteil", title: "Rising" }),
        candidate({ geoKey: "ortsteil:osm:down", kind: "ortsteil", title: "Falling" }),
        candidate({ geoKey: "80801", kind: "plz", grain: "plz5", title: "PLZ 80801" }),
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
        series({
          metricId: "unfallatlas",
          requestedGeoKey: "ortsteil:osm:up",
          points: [
            { period: "2023", status: "present", value: 8 },
            { period: "2025", status: "present", value: 20 },
          ],
        }),
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

    expect(ranked.map((item) => item.title)).toEqual(["Falling", "Rising", "PLZ 80801"]);
    expect(ranked[0]?.score).toBe(1);
    expect(ranked[0]?.criteriaEvidence[0]?.kind).toBe("trend");
    expect(ranked[0]?.criteriaEvidence[0]?.match).toBe(true);
    expect(ranked[0]?.criteriaEvidence[0]?.scope).toBe("local");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).toContain("Dreijahresverlauf");
    expect(ranked[0]?.criteriaEvidence[0]?.evidence).not.toContain("sechs Monaten");
    expect(ranked[1]?.score).toBe(0);
    expect(ranked[2]?.criteriaEvidence[0]?.kind).toBe("absent");
    expect(ranked[2]?.criteriaEvidence[0]?.evidence).toContain("liegt nicht vor");
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
      ],
      [
        {
          key: "zensus2022",
          label: "Zensus 2022 (Gemeinde)",
          direction: "unknown",
          evidence: "Stichtag",
          kind: "stichtag",
          coverage: "single",
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
});

describe("recommendationReason", () => {
  it("is empty only when no Teilfläche exists", () => {
    expect(recommendationReason({ candidateCount: 0, truncated: false })).toContain("keine feinere Teilfläche");
    expect(recommendationReason({ candidateCount: 1, truncated: false })).toBeNull();
    expect(recommendationReason({ candidateCount: 3, truncated: true })).toContain("Zeilenlimit");
  });
});
