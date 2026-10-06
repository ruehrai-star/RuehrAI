import { criteriaFromYearlySeries, directionFromPoints, seriesEvidence } from "./series-criteria";
import { YearlySeries } from "./yearly-series";

function series(overrides: Partial<YearlySeries> & Pick<YearlySeries, "metricId">): YearlySeries {
  return {
    requestedLevel: "gemeinde",
    requestedGeoKey: "09162000",
    sourceLevel: "gemeinde",
    sourceGeoKey: "09162000",
    granularity: "year",
    coverage: "series",
    points: [
      { period: "2023", status: "present", value: 10 },
      { period: "2024", status: "present", value: 11 },
      { period: "2025", status: "present", value: 12 },
    ],
    ...overrides,
  };
}

function inhabitants(geoKey = "09162000", level: YearlySeries["sourceLevel"] = "gemeinde"): YearlySeries {
  return series({
    metricId: "bevoelkerung",
    requestedGeoKey: geoKey,
    requestedLevel: level,
    sourceLevel: level,
    sourceGeoKey: geoKey,
    points: [
      { period: "2023", status: "present", value: 10_000 },
      { period: "2024", status: "present", value: 10_000 },
      { period: "2025", status: "present", value: 10_000 },
    ],
  });
}

describe("criteriaFromYearlySeries", () => {
  it("prefers a three-year normalized trend and labels a single period as Stichtag", () => {
    const criteria = criteriaFromYearlySeries([
      series({ metricId: "unfallatlas", sourceLevel: "ortsteil", requestedLevel: "ortsteil", requestedGeoKey: "ortsteil:1", sourceGeoKey: "ortsteil:1" }),
      inhabitants("ortsteil:1", "ortsteil"),
      series({
        metricId: "zensus2022",
        coverage: "single",
        points: [
          { period: "2022", status: "present", value: 100 },
          { period: "2023", status: "absent" },
        ],
      }),
      series({
        metricId: "bevoelkerung",
        coverage: "single",
        points: [
          { period: "2022", status: "present", value: 10_000 },
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
    expect(criteria[0]).toMatchObject({
      key: "unfallatlas",
      metricId: "unfallatlas",
      kind: "trend",
      direction: "up",
      baseline: "per_1000_inhabitants",
    });
    expect(criteria[0]?.normalizedValue).toBe(1.2);
    expect(criteria[0]?.rawValue).toBe(12);
    expect(criteria[0]?.evidence).toContain("Dreijahresverlauf");
    expect(criteria[0]?.evidence).toContain("je 1.000 Einwohner");
    const stichtag = criteria.find((item) => item.key === "zensus2022");
    expect(stichtag).toMatchObject({ kind: "stichtag", direction: "unknown" });
    expect(stichtag?.evidence).toContain("Stichtag");
    expect(criteria.find((item) => item.key === "breitband")).toBeUndefined();
    expect(criteria.find((item) => item.key === "bevoelkerung")).toBeUndefined();
  });

  it("uses a kleinräumige count theme, not the Einwohner stock, as the relative dataset", () => {
    const criteria = criteriaFromYearlySeries([
      series({
        metricId: "kba_elektro_pkw",
        sourceLevel: "ortsteil",
        requestedLevel: "ortsteil",
        requestedGeoKey: "ortsteil:42",
        sourceGeoKey: "ortsteil:42",
      }),
      series({
        metricId: "hamburg_stadtteil_regionalstatistik",
        sourceLevel: "ortsteil",
        requestedLevel: "ortsteil",
        requestedGeoKey: "ortsteil:42",
        sourceGeoKey: "ortsteil:42",
        points: [
          { period: "2023", status: "present", value: 10_000 },
          { period: "2024", status: "present", value: 10_000 },
          { period: "2025", status: "present", value: 10_000 },
        ],
      }),
      series({
        metricId: "bevoelkerung",
        sourceLevel: "gemeinde",
      }),
    ]);
    expect(criteria[0]).toMatchObject({
      key: "kba_elektro_pkw",
      kind: "trend",
      sourceLevel: "ortsteil",
      baseline: "per_1000_inhabitants",
    });
    expect(criteria[0]?.evidence).toContain("Ortsteil");
    expect(criteria.find((item) => item.key === "hamburg_stadtteil_regionalstatistik")).toBeUndefined();
    expect(criteria.find((item) => item.key === "bevoelkerung")).toBeUndefined();
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

  it("says the Bezugsgröße liegt nicht vor instead of inventing a normalized 0", () => {
    const evidence = seriesEvidence(
      series({
        metricId: "kba_elektro_pkw",
        sourceLevel: "plz",
        requestedLevel: "plz",
        requestedGeoKey: "50667",
        sourceGeoKey: "50667",
      }),
      "unknown",
      "per_1000_inhabitants",
    );
    expect(evidence).toMatch(/Bezugsgröße/);
    expect(evidence).toContain("liegt nicht vor");
    expect(evidence).not.toMatch(/"normalizedValue":0/);
  });
});
