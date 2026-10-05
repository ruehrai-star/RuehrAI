import { DatabaseService } from "../database/database.service";
import { AnalysisRegion } from "./types";
import { SERIES_METRICS } from "./yearly-series";
import { YearlySeriesService } from "./yearly-series.service";

const asOf = new Date("2026-10-05T11:00:00.000Z");

describe("YearlySeriesService", () => {
  const queryReadingFeatures = jest.fn();
  let service: YearlySeriesService;

  beforeEach(() => {
    queryReadingFeatures.mockReset();
    service = new YearlySeriesService({ queryReadingFeatures } as unknown as DatabaseService);
  });

  it("resolves a PLZ through geo_ref_plz and labels the source as Gemeinde", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) {
        return { rows: [{ plz: "80331", geo_ags: "09162000", geo_ags5: "09162", geo_land: "09" }] };
      }
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "09162000",
              metadata: { personen: 1488202 },
              ref_period: "2025-12",
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const series = await service.build([plzRegion("80331")], asOf);
    const bevoelkerung = series.find((item) => item.metricId === "bevoelkerung");
    expect(bevoelkerung).toMatchObject({
      requestedLevel: "plz",
      requestedGeoKey: "80331",
      sourceLevel: "gemeinde",
      sourceGeoKey: "09162000",
      coverage: "single",
      granularity: "year",
    });
    expect(bevoelkerung?.points).toEqual([
      { period: "2024", status: "absent" },
      { period: "2025", status: "present", value: 1488202 },
      { period: "2026", status: "absent" },
    ]);
    expect(series.some((item) => item.metricId === "store_revenue")).toBe(false);
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]).includes("store_monthly_revenue"))).toBe(
      false,
    );
  });

  it("resolves a Stadtteil via geo_ref_ortsteil and never calls that Gemeinde data a Stadtteil", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_ortsteil")) {
        return { rows: [{ id: "osm:123", geo_key: "stadtteil:osm:123", geo_ags: "09162000" }] };
      }
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            {
              source_theme: "ba_pendler",
              grain: "ags",
              geo_key: "09162000",
              metadata: { count: 12 },
              ref_period: "2025-06",
            },
            {
              source_theme: "ba_pendler",
              grain: "ags5",
              geo_key: "09162",
              metadata: { count: 40 },
              ref_period: "2025-06",
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const series = await service.build([stadtteilRegion()], asOf);
    const pendler = series.find((item) => item.metricId === "pendler");
    expect(pendler?.requestedLevel).toBe("stadtteil");
    expect(pendler?.sourceLevel).toBe("gemeinde");
    expect(pendler?.sourceGeoKey).toBe("09162000");
    expect(pendler?.coverage).toBe("single");
    expect(series.every((item) => item.sourceLevel !== "stadtteil")).toBe(true);
  });

  it("maps a Berlin Bezirk to Gemeinde 11000000 without inventing a name", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11000000",
              metadata: { personen: 3755251 },
              ref_period: "2025-12",
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const series = await service.build([berlinBezirk()], asOf);
    const bevoelkerung = series.find((item) => item.metricId === "bevoelkerung");
    expect(bevoelkerung?.requestedLevel).toBe("bezirk");
    expect(bevoelkerung?.sourceLevel).toBe("gemeinde");
    expect(bevoelkerung?.sourceGeoKey).toBe("11000000");
    expect(queryReadingFeatures.mock.calls.every((call) => !String(call[0]).includes("geo_ref_ortsteil"))).toBe(true);
  });

  it("emits every known topic and marks missing Brain rows absent", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("location_feature_docs")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const series = await service.build([
      {
        ...gemeindeMuenchen(),
      },
    ], asOf);
    expect(series.map((item) => item.metricId)).toEqual(SERIES_METRICS.map((metric) => metric.id));
    expect(series.every((item) => item.coverage === "none")).toBe(true);
    expect(series.every((item) => item.points.every((point) => point.status === "absent" && !("value" in point)))).toBe(
      true,
    );
  });

  it("treats a missing Brain catalog as empty series, not invented places", async () => {
    const missing = Object.assign(new Error('relation "geo.geo_ref_plz" does not exist'), { code: "42P01" });
    queryReadingFeatures.mockRejectedValue(missing);

    const series = await service.build([plzRegion("80331")], asOf);
    expect(series.every((item) => item.coverage === "none")).toBe(true);
    expect(series.every((item) => item.sourceLevel === "gemeinde" || item.sourceLevel === "kreis" || item.sourceLevel === "land")).toBe(
      true,
    );
  });

  it("does not invent a Gemeinde when a PLZ maps to two municipalities", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) {
        return {
          rows: [
            { plz: "00000", geo_ags: "09162000", geo_ags5: "09162", geo_land: "09" },
            { plz: "00000", geo_ags: "11000000", geo_ags5: "11000", geo_land: "11" },
          ],
        };
      }
      if (sql.includes("location_feature_docs")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const series = await service.build([plzRegion("00000")], asOf);
    expect(series.every((item) => item.coverage === "none")).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("09162000"),
      ),
    ).toBe(false);
  });
});

function plzRegion(plz: string): AnalysisRegion {
  return {
    label: plz,
    grain: "plz5",
    geoKey: plz,
    level: "plz",
    ags: null,
    plz,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function stadtteilRegion(): AnalysisRegion {
  return {
    label: "Schwabing",
    grain: "other",
    geoKey: "stadtteil:osm:123",
    level: "stadtteil",
    ags: null,
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function berlinBezirk(): AnalysisRegion {
  return {
    label: "Mitte",
    grain: "ags",
    geoKey: "11000001",
    level: "bezirk",
    ags: "11000001",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function gemeindeMuenchen(): AnalysisRegion {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    level: "gemeinde",
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
