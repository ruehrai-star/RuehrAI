import { CatalogLevel } from "../geo/geo-catalog";
import {
  SERIES_METRICS,
  SeriesFeatureRow,
  buildMetricSeries,
  coverageOf,
  detectGranularity,
  keysForResolvedPlace,
  parseRefPeriod,
  requestedLevelOf,
  seriesNumber,
  yearWindow,
} from "./yearly-series";

const asOf = new Date("2026-10-05T11:00:00.000Z");

describe("yearly-series helpers", () => {
  it("parses Brain ref_period stamps without inventing a month", () => {
    expect(parseRefPeriod("2025-12|bka")).toEqual({
      year: 2025,
      month: 12,
      yearStamp: "2025",
      monthStamp: "2025-12",
    });
    expect(parseRefPeriod("2026-Q1|dehoga")).toEqual({
      year: 2026,
      month: null,
      yearStamp: "2026",
      monthStamp: null,
    });
    expect(parseRefPeriod("2024")).toEqual({ year: 2024, month: null, yearStamp: "2024", monthStamp: null });
    expect(parseRefPeriod("")).toBeNull();
  });

  it("keeps a stored 0 and never turns a missing cell into 0 or {}", () => {
    expect(seriesNumber(0)).toEqual({ value: 0 });
    expect(seriesNumber({ count: 0 })).toEqual({ value: 0, key: "count" });
    expect(seriesNumber({})).toBeNull();
    expect(seriesNumber(null)).toBeNull();
    expect(seriesNumber({ personen: 12, gebaeude: 3 })).toEqual({ value: 12, key: "personen" });
    expect(seriesNumber({ foo: 1, bar: 2 })).toBeNull();
  });

  it("uses year granularity for a single YYYY-MM snapshot", () => {
    expect(detectGranularity([parseRefPeriod("2025-12|bka")!])).toBe("year");
    expect(
      detectGranularity([parseRefPeriod("2025-01")!, parseRefPeriod("2025-02")!]),
    ).toBe("month");
  });

  it("marks coverage so one point is not a trend", () => {
    expect(coverageOf([{ period: "2024", status: "absent" }])).toBe("none");
    expect(coverageOf([{ period: "2025", status: "present", value: 1 }])).toBe("single");
    expect(
      coverageOf([
        { period: "2024", status: "present", value: 1 },
        { period: "2025", status: "present", value: 2 },
      ]),
    ).toBe("multi");
  });

  it("reads the last three UTC calendar years from the snapshot time", () => {
    expect(yearWindow(asOf)).toEqual(["2024", "2025", "2026"]);
  });
});

describe("buildMetricSeries", () => {
  it("labels Gemeinde data as gemeinde when the user picked a Stadtteil", () => {
    const series = buildMetricSeries({
      metricId: "bevoelkerung",
      homeLevel: "gemeinde",
      region: stadtteilInMuenchen(),
      docs: [
        feature({
          theme: "regionalstatistik_bevoelkerung",
          grain: "ags",
          key: "09162000",
          period: "2025-12",
          metadata: { personen: 1488202 },
        }),
      ],
      asOf,
    });

    expect(series.requestedLevel).toBe("stadtteil");
    expect(series.requestedGeoKey).toBe("stadtteil:osm:123");
    expect(series.sourceLevel).toBe("gemeinde");
    expect(series.sourceGeoKey).toBe("09162000");
    expect(series.granularity).toBe("year");
    expect(series.coverage).toBe("single");
    expect(series.valueKey).toBe("personen");
    expect(series.points).toEqual([
      { period: "2024", status: "absent" },
      { period: "2025", status: "present", value: 1488202 },
      { period: "2026", status: "absent" },
    ]);
    expect(series.points[0]).not.toHaveProperty("value");
    expect(series.points[2]).not.toHaveProperty("value");
  });

  it("does not interpolate a missing year or replace it with 0", () => {
    const series = buildMetricSeries({
      metricId: "bevoelkerung",
      homeLevel: "gemeinde",
      region: stadtteilInMuenchen(),
      docs: [
        feature({
          theme: "regionalstatistik_bevoelkerung",
          grain: "ags",
          key: "09162000",
          period: "2025-12",
          metadata: { personen: 10 },
        }),
      ],
      asOf,
    });
    expect(series.points.map((point) => point.status)).toEqual(["absent", "present", "absent"]);
    expect(series.points.find((point) => point.period === "2024")?.value).toBeUndefined();
    expect(series.coverage).toBe("single");
  });

  it("returns a stored 0 as present", () => {
    const series = buildMetricSeries({
      metricId: "pendler",
      homeLevel: "gemeinde",
      region: stadtteilInMuenchen(),
      docs: [
        feature({
          theme: "ba_pendler",
          grain: "ags",
          key: "ags:09162000",
          period: "2025-06",
          metadata: { count: 0 },
        }),
      ],
      asOf,
    });
    expect(series.points).toContainEqual({ period: "2025", status: "present", value: 0 });
    expect(series.coverage).toBe("single");
  });

  it("keeps a 2022 Zensus row out of the 2024-2026 window", () => {
    const series = buildMetricSeries({
      metricId: "zensus2022",
      homeLevel: "gemeinde",
      region: stadtteilInMuenchen(),
      docs: [
        feature({
          theme: "zensus2022",
          grain: "ags",
          key: "09162000",
          period: "2022-05",
          metadata: { personen: 1488202 },
        }),
      ],
      asOf,
    });
    expect(series.coverage).toBe("none");
    expect(series.points.every((point) => point.status === "absent")).toBe(true);
    expect(series.points.every((point) => !("value" in point))).toBe(true);
  });

  it("does not treat a Gemeinde AGS as Arbeitsmarkt", () => {
    const series = buildMetricSeries({
      metricId: "arbeitsmarkt",
      homeLevel: "kreis",
      region: keysForResolvedPlace("stadtteil", "stadtteil:osm:123", "09161123", "09161", "09"),
      docs: [
        feature({
          theme: "ba_alo",
          grain: "ags",
          key: "09161123",
          period: "2026-09",
          metadata: { arbeitslose: 1 },
        }),
      ],
      asOf,
    });
    expect(series.sourceLevel).toBe("kreis");
    expect(series.coverage).toBe("none");
    expect(series.points.every((point) => point.status === "absent")).toBe(true);
  });

  it("uses monthly granularity only when two months of the same year are stored", () => {
    const series = buildMetricSeries({
      metricId: "pendler",
      homeLevel: "gemeinde",
      region: stadtteilInMuenchen(),
      docs: [
        feature({
          theme: "ba_pendler",
          grain: "ags",
          key: "09162000",
          period: "2026-01",
          metadata: { count: 10 },
        }),
        feature({
          theme: "ba_pendler",
          grain: "ags",
          key: "09162000",
          period: "2026-02",
          metadata: { count: 12 },
        }),
      ],
      asOf,
    });
    expect(series.granularity).toBe("month");
    expect(series.coverage).toBe("multi");
    expect(series.points).toHaveLength(36);
    expect(series.points.find((point) => point.period === "2026-01")).toEqual({
      period: "2026-01",
      status: "present",
      value: 10,
    });
    expect(series.points.find((point) => point.period === "2026-03")?.status).toBe("absent");
    expect(series.points.find((point) => point.period === "2026-03")).not.toHaveProperty("value");
  });

  it("does not invent a metric id outside the existing topic list", () => {
    expect(SERIES_METRICS.map((metric) => metric.id)).toEqual(
      expect.arrayContaining(["bevoelkerung", "pendler", "arbeitsmarkt", "zensus2022"]),
    );
    expect(SERIES_METRICS.map((metric) => metric.id)).not.toContain("krankenhaeuser");
    expect(SERIES_METRICS.map((metric) => metric.id)).not.toContain("breitband_gitter");
  });

  it("classifies a stored Gemeinde target as gemeinde", () => {
    expect(
      requestedLevelOf({
        grain: "ags",
        geoKey: "09162000",
        ags: "09162000",
        plz: null,
      }),
    ).toBe("gemeinde" satisfies CatalogLevel);
  });
});

function stadtteilInMuenchen() {
  return keysForResolvedPlace("stadtteil", "stadtteil:osm:123", "09162000", "09162", "09");
}

function feature(input: {
  theme: string;
  grain: string;
  key: string;
  metadata: unknown;
  period: string;
}): SeriesFeatureRow {
  return {
    source_theme: input.theme,
    grain: input.grain,
    geo_key: input.key,
    metadata: input.metadata,
    ref_period: input.period,
  };
}
