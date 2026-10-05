import { criteriaFromYearlySeries, directionFromPoints, seriesEvidence } from "./series-criteria";
import { YearlySeries } from "./yearly-series";

function series(overrides: Partial<YearlySeries> & Pick<YearlySeries, "metricId">): YearlySeries {
  return {
    requestedLevel: "gemeinde",
    requestedGeoKey: "09162000",
    sourceLevel: "gemeinde",
    sourceGeoKey: "09162000",
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: 10 },
      { period: "2024", status: "present", value: 11 },
      { period: "2025", status: "present", value: 12 },
    ],
    ...overrides,
  };
}

describe("criteriaFromYearlySeries", () => {
  it("prefers a three-year trend and labels a single period as Stichtag", () => {
    const criteria = criteriaFromYearlySeries([
      series({ metricId: "unfallatlas", sourceLevel: "ortsteil", requestedLevel: "ortsteil" }),
      series({
        metricId: "zensus2022",
        coverage: "single",
        points: [
          { period: "2022", status: "present", value: 100 },
          { period: "2023", status: "absent" },
        ],
      }),
      series({
        metricId: "breitband",
        coverage: "none",
        points: [
          { period: "2023", status: "absent" },
          { period: "2024", status: "absent" },
        ],
      }),
    ]);
    expect(criteria[0]).toMatchObject({ key: "unfallatlas", kind: "trend", direction: "up" });
    expect(criteria[0]?.evidence).toContain("Dreijahresverlauf");
    const stichtag = criteria.find((item) => item.key === "zensus2022");
    expect(stichtag).toMatchObject({ kind: "stichtag", direction: "unknown" });
    expect(stichtag?.evidence).toContain("Stichtag");
    expect(criteria.find((item) => item.key === "breitband")).toBeUndefined();
  });

  it("does not invent 0 when a cell is absent", () => {
    expect(directionFromPoints([{ period: "2023", status: "absent" }])).toBe("unknown");
    const evidence = seriesEvidence(
      series({
        metricId: "bevoelkerung",
        coverage: "none",
        points: [{ period: "2023", status: "absent" }],
      }),
      "unknown",
    );
    expect(evidence).toContain("liegt nicht vor");
    expect(evidence).not.toMatch(/\b0\b/);
  });
});
