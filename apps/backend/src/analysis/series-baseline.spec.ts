import { attachNormalizedValues, baselineForMetric, presentNormalizedPoints } from "./series-baseline";
import { YearlySeries } from "./yearly-series";

describe("series-baseline", () => {
  it("normalizes counts per 1.000 inhabitants and leaves missing Bezugsgröße without 0", () => {
    const series: YearlySeries[] = [
      {
        metricId: "kba_elektro_pkw",
        requestedLevel: "bezirk",
        requestedGeoKey: "bezirk:1",
        sourceLevel: "bezirk",
        sourceGeoKey: "bezirk:1",
        granularity: "year",
        coverage: "multi",
        points: [
          { period: "2023", status: "present", value: 20 },
          { period: "2024", status: "present", value: 30 },
          { period: "2025", status: "present", value: 40 },
        ],
      },
      {
        metricId: "bevoelkerung",
        requestedLevel: "bezirk",
        requestedGeoKey: "bezirk:1",
        sourceLevel: "bezirk",
        sourceGeoKey: "bezirk:1",
        granularity: "year",
        coverage: "multi",
        points: [
          { period: "2023", status: "present", value: 10_000 },
          { period: "2024", status: "absent" },
          { period: "2025", status: "present", value: 10_000 },
        ],
      },
      {
        metricId: "kba_elektro_pkw",
        requestedLevel: "plz",
        requestedGeoKey: "50667",
        sourceLevel: "plz",
        sourceGeoKey: "50667",
        granularity: "year",
        coverage: "multi",
        points: [
          { period: "2023", status: "present", value: 4 },
          { period: "2025", status: "present", value: 8 },
        ],
      },
    ];

    expect(baselineForMetric("kba_elektro_pkw")).toBe("per_1000_inhabitants");
    expect(baselineForMetric("bevoelkerung")).toBe("per_km2");

    const normalized = attachNormalizedValues(series);
    const berlin = normalized.find((item) => item.requestedGeoKey === "bezirk:1" && item.metricId === "kba_elektro_pkw");
    expect(berlin?.points.find((point) => point.period === "2023")?.normalizedValue).toBe(2);
    expect(berlin?.points.find((point) => point.period === "2024")?.value).toBe(30);
    expect(berlin?.points.find((point) => point.period === "2024")?.normalizedValue).toBeUndefined();
    expect(JSON.stringify(berlin?.points.find((point) => point.period === "2024"))).not.toMatch(/"normalizedValue":0/);

    const koeln = normalized.find((item) => item.requestedGeoKey === "50667");
    expect(koeln?.points.every((point) => point.normalizedValue === undefined)).toBe(true);
    expect(presentNormalizedPoints(koeln?.points ?? [])).toEqual([]);
  });
});
