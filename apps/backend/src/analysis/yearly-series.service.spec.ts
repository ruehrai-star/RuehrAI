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
      { period: "2023", status: "absent" },
      { period: "2024", status: "absent" },
      { period: "2025", status: "present", value: 1488202 },
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

  it("resolves Tempelhof Ortsteil to Bezirk RS 11007007 and returns coverage multi", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_ortsteil") && sql.includes("geo_ref_bezirk")) {
        return { rows: [{ id: "osm:162894", geo_key: "ortsteil:osm:162894", geo_ags: "11000000", geo_bezirk_id: "11000007" }] };
      }
      if (sql.includes("geo_ref_ortsteil")) {
        return { rows: [{ id: "osm:162894", geo_key: "ortsteil:osm:162894", geo_ags: "11000000", geo_bezirk_id: null }] };
      }
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11007007",
              metadata: { values: { insgesamt: 350123, maennlich: 1, weiblich: 2 } },
              ref_period: "2022-12",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11007007",
              metadata: { values: { insgesamt: 351000, maennlich: 1, weiblich: 2 } },
              ref_period: "2023-12",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11007007",
              metadata: { values: { insgesamt: 352000, maennlich: 1, weiblich: 2 } },
              ref_period: "2024-12",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11007007",
              metadata: { values: { insgesamt: 353000, maennlich: 1, weiblich: 2 } },
              ref_period: "2025-12",
            },
            {
              source_theme: "kba_elektro_pkw",
              grain: "ags",
              geo_key: "11000000",
              metadata: { pkw_elektro: 12, pkw_insgesamt: 100 },
              ref_period: "2023-01|elektro",
            },
            {
              source_theme: "kba_elektro_pkw",
              grain: "ags",
              geo_key: "11000000",
              metadata: { pkw_elektro: 18, pkw_insgesamt: 100 },
              ref_period: "2024-01|elektro",
            },
            {
              source_theme: "unfallatlas_gebiet",
              grain: "other",
              geo_key: "ortsteil:osm:162894",
              metadata: { unfaelle_gesamt: 41, getoetet_kat1: 0 },
              ref_period: "2024|unfallatlas_gebiet",
            },
            {
              source_theme: "unfallatlas_gebiet",
              grain: "other",
              geo_key: "ortsteil:osm:162894",
              metadata: { unfaelle_gesamt: 44, getoetet_kat1: 0 },
              ref_period: "2025|unfallatlas_gebiet",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "11000",
              metadata: { bg: 100, pers: 200, elb: 80, nef: 40, rlb: 160 },
              ref_period: "2023-10|sgb2",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "11000",
              metadata: { bg: 101, pers: 201, elb: 81, nef: 41, rlb: 161 },
              ref_period: "2023-11|sgb2",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "11000",
              metadata: { bg: 108, pers: 210, elb: 85, nef: 42, rlb: 170 },
              ref_period: "2026-09|sgb2",
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const series = await service.build([tempelhofOrtsteil()], asOf);
    const bevoelkerung = series.find((item) => item.metricId === "bevoelkerung");
    expect(bevoelkerung).toMatchObject({
      requestedLevel: "ortsteil",
      requestedGeoKey: "ortsteil:osm:162894",
      sourceLevel: "gemeinde",
      sourceGeoKey: "11007007",
      coverage: "multi",
    });
    const elektro = series.find((item) => item.metricId === "kba_elektro_pkw");
    expect(elektro?.coverage).toBe("multi");
    expect(elektro?.sourceGeoKey).toBe("11000000");
    const unfallatlas = series.find((item) => item.metricId === "unfallatlas");
    expect(unfallatlas).toMatchObject({
      sourceLevel: "ortsteil",
      sourceGeoKey: "ortsteil:osm:162894",
      coverage: "multi",
    });
    const sgb2 = series.find((item) => item.metricId === "ba_sgb2");
    expect(sgb2).toMatchObject({
      sourceLevel: "kreis",
      sourceGeoKey: "11000",
      coverage: "multi",
      granularity: "month",
    });
    expect(sgb2?.points).toHaveLength(36);
    expect(sgb2?.points.find((point) => point.period === "2023-10")).toEqual({
      period: "2023-10",
      status: "present",
      value: 100,
    });
    expect(sgb2?.points.find((point) => point.period === "2026-09")).toEqual({
      period: "2026-09",
      status: "present",
      value: 108,
    });
    expect(sgb2?.points.find((point) => point.period === "2024-01")).toEqual({ period: "2024-01", status: "absent" });
    expect(sgb2?.points.find((point) => point.period === "2024-01")).not.toHaveProperty("value");
    const featureSql = queryReadingFeatures.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("location_feature_docs"));
    expect(featureSql).toBeDefined();
    expect(featureSql).not.toMatch(/embedding/i);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("11007007"),
      ),
    ).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("11000"),
      ),
    ).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("land:11"),
      ),
    ).toBe(true);
    expect(series.some((item) => item.metricId === "umsatz")).toBe(false);
  });

  it("keeps yearlySeries for Tempelhof Ortsteil when level is missing and Brain only has Stadt/Kreis rows", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_ortsteil") && sql.includes("geo_ref_bezirk")) {
        const error = Object.assign(new Error("invalid geometry"), { code: "XX000" });
        throw error;
      }
      if (sql.includes("geo_ref_ortsteil")) {
        return { rows: [{ id: "osm:162894", geo_key: "ortsteil:osm:162894", geo_ags: "11000000", geo_bezirk_id: null }] };
      }
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11000000",
              metadata: { values: { insgesamt: 3750000 } },
              ref_period: "2023-12",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11000000",
              metadata: { values: { insgesamt: 3760000 } },
              ref_period: "2024-12",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11000000",
              metadata: { values: { insgesamt: 3770000 } },
              ref_period: "2025-12",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "11000",
              metadata: { bedarfsgemeinschaften: 230216.522, pers: 435602.637 },
              ref_period: "2026-09|sgb2",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "11000",
              metadata: { bedarfsgemeinschaften: 229100, pers: 434000 },
              ref_period: "2026-08|sgb2",
            },
            {
              source_theme: "kba_elektro_pkw",
              grain: "ags",
              geo_key: "11000000",
              metadata: { pkw_insgesamt: 0.0, pkw_elektro: 0.0, pkw_elektro_anteil: 4.1 },
              ref_period: "2026-07|elektro",
            },
            {
              source_theme: "ba_alo",
              grain: "ags",
              geo_key: "11000000",
              metadata: {
                ba_schluessel: "11000000",
                geo_ags: "11000000",
                indicators: { arbeitslose_insgesamt: 223830 },
              },
              ref_period: "2026-09",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const series = await service.build([tempelhofOrtsteilWithoutLevel()], asOf);
    expect(series).toHaveLength(SERIES_METRICS.length);
    const bevoelkerung = series.find((item) => item.metricId === "bevoelkerung");
    expect(bevoelkerung).toMatchObject({
      requestedLevel: "ortsteil",
      requestedGeoKey: "ortsteil:osm:162894",
      sourceLevel: "gemeinde",
      sourceGeoKey: "11000000",
      coverage: "multi",
    });
    const sgb2 = series.find((item) => item.metricId === "ba_sgb2");
    expect(sgb2).toMatchObject({
      sourceLevel: "kreis",
      sourceGeoKey: "11000",
      coverage: "multi",
      granularity: "month",
    });
    expect(sgb2?.points.find((point) => point.period === "2026-09")).toEqual({
      period: "2026-09",
      status: "present",
      value: 230217,
    });
    const elektro = series.find((item) => item.metricId === "kba_elektro_pkw");
    expect(elektro?.coverage).toBe("none");
    expect(elektro?.points.every((point) => point.status === "absent" && !("value" in point))).toBe(true);
    const arbeitsmarkt = series.find((item) => item.metricId === "arbeitsmarkt");
    expect(arbeitsmarkt?.points.some((point) => point.value === 11000000)).toBe(false);
    expect(arbeitsmarkt?.points.find((point) => point.period === "2026")).toEqual({
      period: "2026",
      status: "present",
      value: 223830,
    });
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("11000000"),
      ),
    ).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("11000"),
      ),
    ).toBe(true);
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

  it("keeps yearlySeries for Köln-like grain ags5 Kreis without inventing Gemeinde", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("location_feature_docs")) {
        return {
          rows: [
            {
              source_theme: "destatis_wohnungen",
              grain: "ags5",
              geo_key: "05315",
              metadata: { wohnungen: 540000 },
              ref_period: "2024|wohnungen",
            },
            {
              source_theme: "destatis_wohnungen",
              grain: "ags5",
              geo_key: "05315",
              metadata: { wohnungen: 545000 },
              ref_period: "2025|wohnungen",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "05315",
              metadata: { bg: 40000 },
              ref_period: "2026-09|sgb2",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "05315000",
              metadata: { personen: 1085664 },
              ref_period: "2025-12",
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const series = await service.build([koelnKreis()], asOf);
    expect(series).toHaveLength(SERIES_METRICS.length);
    expect(series.map((item) => item.metricId)).toEqual(SERIES_METRICS.map((metric) => metric.id));
    expect(series.every((item) => item.requestedLevel === "kreis")).toBe(true);
    expect(series.every((item) => item.requestedGeoKey === "05315")).toBe(true);
    const wohnungen = series.find((item) => item.metricId === "destatis_wohnungen");
    expect(wohnungen).toMatchObject({
      requestedLevel: "kreis",
      sourceLevel: "kreis",
      sourceGeoKey: "05315",
      coverage: "multi",
    });
    const sgb2 = series.find((item) => item.metricId === "ba_sgb2");
    expect(sgb2).toMatchObject({
      requestedLevel: "kreis",
      sourceLevel: "kreis",
      sourceGeoKey: "05315",
    });
    const bevoelkerung = series.find((item) => item.metricId === "bevoelkerung");
    expect(bevoelkerung?.requestedLevel).toBe("kreis");
    expect(bevoelkerung?.coverage).toBe("none");
    expect(bevoelkerung?.points.every((point) => point.status === "absent" && !("value" in point))).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.every((call) => !String(call[0]).includes("geo_ref_ortsteil")),
    ).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("05315"),
      ),
    ).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("land:05"),
      ),
    ).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => Array.isArray(call[1]?.[1]) && (call[1]?.[1] as string[]).includes("05315000"),
      ),
    ).toBe(true);
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

function tempelhofOrtsteil(): AnalysisRegion {
  return {
    label: "Tempelhof",
    grain: "other",
    geoKey: "ortsteil:osm:162894",
    level: "ortsteil",
    ags: null,
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function tempelhofOrtsteilWithoutLevel(): AnalysisRegion {
  return {
    label: "Tempelhof",
    grain: "other",
    geoKey: "ortsteil:osm:162894",
    level: null,
    ags: "11000000",
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

function koelnKreis(): AnalysisRegion {
  return {
    label: "Köln",
    grain: "ags5",
    geoKey: "05315",
    level: null,
    ags: "05315",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
