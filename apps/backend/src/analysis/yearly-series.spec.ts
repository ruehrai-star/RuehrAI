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
  monthWindow,
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
    expect(parseRefPeriod("2024|wanderungen")).toEqual({
      year: 2024,
      month: null,
      yearStamp: "2024",
      monthStamp: null,
    });
    expect(parseRefPeriod("2023-01|elektro")).toEqual({
      year: 2023,
      month: 1,
      yearStamp: "2023",
      monthStamp: "2023-01",
    });
    expect(parseRefPeriod("2020|wohnungen")).toEqual({
      year: 2020,
      month: null,
      yearStamp: "2020",
      monthStamp: null,
    });
    expect(parseRefPeriod("2025|kfz_bestand")).toEqual({
      year: 2025,
      month: null,
      yearStamp: "2025",
      monthStamp: null,
    });
    expect(parseRefPeriod("2022|bev_alter")).toEqual({
      year: 2022,
      month: null,
      yearStamp: "2022",
      monthStamp: null,
    });
    expect(parseRefPeriod("2023-10|kba_nz")).toEqual({
      year: 2023,
      month: 10,
      yearStamp: "2023",
      monthStamp: "2023-10",
    });
    expect(parseRefPeriod("2023-10|sgb2")).toEqual({
      year: 2023,
      month: 10,
      yearStamp: "2023",
      monthStamp: "2023-10",
    });
    expect(parseRefPeriod("2026-09|sgb2")).toEqual({
      year: 2026,
      month: 9,
      yearStamp: "2026",
      monthStamp: "2026-09",
    });
    expect(parseRefPeriod("11000000|elektro")).toBeNull();
    expect(parseRefPeriod("")).toBeNull();
  });

  it("keeps a stored 0 and never turns a missing cell into 0 or {}", () => {
    expect(seriesNumber(0)).toEqual({ value: 0 });
    expect(seriesNumber({ count: 0 })).toEqual({ value: 0, key: "count" });
    expect(seriesNumber({})).toBeNull();
    expect(seriesNumber(null)).toBeNull();
    expect(seriesNumber({ personen: 12, gebaeude: 3 })).toEqual({ value: 12, key: "personen" });
    expect(seriesNumber({ foo: 1, bar: 2 })).toBeNull();
    expect(seriesNumber({ values: { insgesamt: 96217, maennlich: 47482, weiblich: 48735 } }, "bevoelkerung")).toEqual({
      value: 96217,
      key: "insgesamt",
    });
    expect(seriesNumber({ wohnungen: 12, raeume: 3, wohnflaeche_1000qm: 8 }, "destatis_wohnungen")).toEqual({
      value: 12,
      key: "wohnungen",
    });
    expect(seriesNumber({ werte: { kfz_insgesamt: 40, pkw: 30 } }, "kba_neuzulassungen")).toEqual({
      value: 40,
      key: "kfz_insgesamt",
    });
    expect(seriesNumber({ bg: 12, pers: 20, elb: 8, nef: 4, rlb: 16 }, "ba_sgb2")).toEqual({
      value: 12,
      key: "bg",
    });
  });

  it("treats suppressed kba_elektro_pkw zeros as absent, never as 0", () => {
    expect(
      seriesNumber(
        { pkw_insgesamt: 0.0, pkw_elektro: 0.0, pkw_elektro_anteil: 4.1 },
        "kba_elektro_pkw",
      ),
    ).toBeNull();
    expect(
      seriesNumber(
        { pkw_insgesamt: 0, pkw_elektro: 0, pkw_elektro_anteil: 5.2 },
        "kba_elektro_pkw",
      ),
    ).toBeNull();
    expect(seriesNumber({ pkw_elektro: 18, pkw_insgesamt: 100, pkw_elektro_anteil: 18 }, "kba_elektro_pkw")).toEqual({
      value: 18,
      key: "pkw_elektro",
    });
    expect(seriesNumber({ pkw_elektro: 0, pkw_insgesamt: 1000, pkw_elektro_anteil: 0 }, "kba_elektro_pkw")).toEqual({
      value: 0,
      key: "pkw_elektro",
    });
  });

  it("does not treat ba_schluessel or geo keys as Arbeitsmarkt values", () => {
    expect(
      seriesNumber(
        {
          ba_schluessel: "11000000",
          geo_ags: "11000000",
          geo_ags5: "11000",
          source_theme: "ba_alo",
          indicators: { arbeitslose_insgesamt: 223830, arbeitslose_maenner: 120000, arbeitslose_frauen: 103830 },
        },
        "arbeitsmarkt",
      ),
    ).toEqual({ value: 223830, key: "arbeitslose_insgesamt" });
    expect(
      seriesNumber(
        { ba_schluessel: "11000000", geo_ags: "11000000", geo_ags5: "11000", source_theme: "ba_alo" },
        "arbeitsmarkt",
      ),
    ).toBeNull();
    expect(seriesNumber({ ba_schluessel: 11000000, geo_ags5: "11000" }, "arbeitsmarkt")).toBeNull();
  });

  it("rounds ba_sgb2 count-like floats to whole numbers", () => {
    expect(
      seriesNumber(
        {
          geo_ags5: "11000",
          indicators: {
            bedarfsgemeinschaften: 230216.522,
            personen_sgb2: 435602.637,
            erwerbsfaehige_leistungsberechtigte: 301234.4,
            nicht_erwerbsfaehige_leistungsberechtigte: 134368.2,
            regelleistungsberechtigte: 412000.8,
          },
        },
        "ba_sgb2",
      ),
    ).toEqual({ value: 230217, key: "bedarfsgemeinschaften" });
    expect(
      seriesNumber(
        { bg: 230216.522, pers: 435602.637, elb: 301234.4, nef: 134368.2, rlb: 412000.8 },
        "ba_sgb2",
      ),
    ).toEqual({ value: 230217, key: "bg" });
    expect(seriesNumber({ bg: 230216.0, pers: 435602.0 }, "ba_sgb2")).toEqual({ value: 230216, key: "bg" });
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
    expect(yearWindow(asOf, [2022, 2023, 2024])).toEqual(["2022", "2023", "2024"]);
    expect(yearWindow(asOf, [2022, 2023, 2024, 2025])).toEqual(["2023", "2024", "2025"]);
    expect(yearWindow(asOf, [2022])).toEqual(["2024", "2025", "2026"]);
    expect(monthWindow(asOf)[0]).toBe("2023-11");
    expect(monthWindow(asOf).at(-1)).toBe("2026-10");
    expect(monthWindow(asOf, ["2023-10", "2026-09"])[0]).toBe("2023-10");
    expect(monthWindow(asOf, ["2023-10", "2026-09"]).at(-1)).toBe("2026-09");
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
      { period: "2023", status: "absent" },
      { period: "2024", status: "absent" },
      { period: "2025", status: "present", value: 1488202 },
    ]);
    expect(series.points[0]).not.toHaveProperty("value");
    expect(series.points[1]).not.toHaveProperty("value");
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
    expect(series.points.map((point) => point.status)).toEqual(["absent", "absent", "present"]);
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

  it("does not invent a metric id outside the topic and Brain series lists", () => {
    expect(SERIES_METRICS.map((metric) => metric.id)).toEqual(
      expect.arrayContaining([
        "bevoelkerung",
        "pendler",
        "arbeitsmarkt",
        "zensus2022",
        "destatis_wohnungen",
        "destatis_kfz_bestand",
        "destatis_bevoelkerung_alter",
        "kba_elektro_pkw",
        "ba_sgb2",
        "kba_neuzulassungen",
        "kba_bestand",
      ]),
    );
    expect(SERIES_METRICS.map((metric) => metric.id)).not.toContain("krankenhaeuser");
    expect(SERIES_METRICS.map((metric) => metric.id)).not.toContain("breitband_gitter");
    expect(SERIES_METRICS.map((metric) => metric.id)).not.toContain("umsatz");
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

describe("Tempelhof Brain series (inventory 2026-10-05)", () => {
  const region = keysForResolvedPlace("ortsteil", "ortsteil:osm:162894", "11000000", "11000", "11", {
    bezirkOfficial: "11000007",
  });
  const docs = tempelhofDocs();

  it("prefers Regionalstatistik Bezirk 11007007 and keeps wanderungen multi after 2024", () => {
    const bevoelkerung = buildMetricSeries({
      metricId: "bevoelkerung",
      homeLevel: "gemeinde",
      region,
      docs,
      asOf,
    });
    expect(bevoelkerung).toMatchObject({
      requestedLevel: "ortsteil",
      requestedGeoKey: "ortsteil:osm:162894",
      sourceLevel: "gemeinde",
      sourceGeoKey: "11007007",
      coverage: "multi",
      granularity: "year",
      valueKey: "insgesamt",
    });
    expect(bevoelkerung.points.filter((point) => point.status === "present").map((point) => point.period)).toEqual([
      "2023",
      "2024",
      "2025",
    ]);

    const wanderungen = buildMetricSeries({
      metricId: "wanderungen",
      homeLevel: "gemeinde",
      region,
      docs,
      asOf,
    });
    expect(wanderungen.sourceGeoKey).toBe("11007007");
    expect(wanderungen.coverage).toBe("multi");
    expect(wanderungen.points).toEqual([
      { period: "2022", status: "present", value: 2008 },
      { period: "2023", status: "present", value: 1500 },
      { period: "2024", status: "present", value: 900 },
    ]);
  });

  it("maps Kreis Destatis and Land KBA with the inventory grains and never uses 0 for absent", () => {
    const wohnungen = buildMetricSeries({
      metricId: "destatis_wohnungen",
      homeLevel: "kreis",
      region,
      docs,
      asOf,
    });
    expect(wohnungen).toMatchObject({
      sourceLevel: "kreis",
      sourceGeoKey: "11000",
      coverage: "multi",
      valueKey: "wohnungen",
    });
    expect(wohnungen.points.every((point) => point.status === "present" || !("value" in point))).toBe(true);

    const elektro = buildMetricSeries({
      metricId: "kba_elektro_pkw",
      homeLevel: "gemeinde",
      region,
      docs,
      asOf,
    });
    expect(elektro).toMatchObject({
      sourceLevel: "gemeinde",
      sourceGeoKey: "11000000",
      coverage: "multi",
      granularity: "month",
    });

    const vgrdl = buildMetricSeries({
      metricId: "vgrdl",
      homeLevel: "kreis",
      region,
      docs,
      asOf,
    });
    expect(vgrdl.coverage).toBe("none");
    expect(vgrdl.points.every((point) => point.status === "absent" && !("value" in point))).toBe(true);
  });

  it("maps ba_sgb2 as a monthly Kreis series on stored geo_key 11000", () => {
    const sgb2 = buildMetricSeries({
      metricId: "ba_sgb2",
      homeLevel: "kreis",
      region,
      docs,
      asOf,
    });
    expect(sgb2).toMatchObject({
      requestedLevel: "ortsteil",
      requestedGeoKey: "ortsteil:osm:162894",
      sourceLevel: "kreis",
      sourceGeoKey: "11000",
      coverage: "multi",
      granularity: "month",
      valueKey: "bg",
    });
    expect(sgb2.points).toHaveLength(36);
    expect(sgb2.points.find((point) => point.period === "2023-10")).toEqual({
      period: "2023-10",
      status: "present",
      value: 100,
    });
    expect(sgb2.points.find((point) => point.period === "2023-11")).toEqual({
      period: "2023-11",
      status: "present",
      value: 101,
    });
    expect(sgb2.points.find((point) => point.period === "2026-09")).toEqual({
      period: "2026-09",
      status: "present",
      value: 102,
    });
    expect(sgb2.points.find((point) => point.period === "2026-10")).toBeUndefined();
    expect(sgb2.points.find((point) => point.period === "2024-01")).toEqual({ period: "2024-01", status: "absent" });
    expect(sgb2.points.find((point) => point.period === "2024-01")).not.toHaveProperty("value");
  });

  it("prefers local unfallatlas_gebiet and labels Gemeinde Unfallatlas as Gemeinde", () => {
    const local = buildMetricSeries({
      metricId: "unfallatlas",
      homeLevel: "gemeinde",
      region,
      docs,
      asOf,
    });
    expect(local).toMatchObject({
      sourceLevel: "ortsteil",
      sourceGeoKey: "ortsteil:osm:162894",
      coverage: "multi",
      valueKey: "unfaelle_gesamt",
    });

    const gemeindeOnly = buildMetricSeries({
      metricId: "unfallatlas",
      homeLevel: "gemeinde",
      region: keysForResolvedPlace("ortsteil", "ortsteil:osm:999", "11000000", "11000", "11", {
        bezirkOfficial: "11000007",
      }),
      docs: [
        feature({
          theme: "unfallatlas",
          grain: "ags",
          key: "11000000",
          period: "2024",
          metadata: { unfaelle_gesamt: 1 },
        }),
        feature({
          theme: "unfallatlas",
          grain: "ags",
          key: "11000000",
          period: "2025",
          metadata: { unfaelle_gesamt: 2 },
        }),
      ],
      asOf,
    });
    expect(gemeindeOnly.sourceLevel).toBe("gemeinde");
    expect(gemeindeOnly.sourceGeoKey).toBe("11000000");
    expect(gemeindeOnly.coverage).toBe("multi");
  });
});

describe("yearlySeries STAGE display bugs (Tempelhof / Berlin)", () => {
  const region = keysForResolvedPlace("ortsteil", "ortsteil:osm:162894", "11000000", "11000", "11", {
    bezirkOfficial: "11000007",
  });

  it("marks kba_elektro_pkw placeholder zeros absent without value", () => {
    const series = buildMetricSeries({
      metricId: "kba_elektro_pkw",
      homeLevel: "gemeinde",
      region,
      docs: ["2023-01|elektro", "2024-01|elektro", "2025-01|elektro", "2026-07|elektro"].map((period) =>
        feature({
          theme: "kba_elektro_pkw",
          grain: "ags",
          key: "11000000",
          period,
          metadata: { pkw_insgesamt: 0.0, pkw_elektro: 0.0, pkw_elektro_anteil: 4.1 },
        }),
      ),
      asOf,
    });
    expect(series.coverage).toBe("none");
    expect(series.points.every((point) => point.status === "absent")).toBe(true);
    expect(series.points.every((point) => !("value" in point))).toBe(true);
  });

  it("uses ba_alo indicators and never formats Berlin AGS 11000000 as the series value", () => {
    const series = buildMetricSeries({
      metricId: "arbeitsmarkt",
      homeLevel: "kreis",
      region,
      docs: [
        feature({
          theme: "ba_alo",
          grain: "ags",
          key: "11000000",
          period: "2026-09",
          metadata: {
            ba_schluessel: "11000000",
            geo_ags: "11000000",
            geo_ags5: "11000",
            source_theme: "ba_alo",
            indicators: { arbeitslose_insgesamt: 223830, arbeitslose_maenner: 120000, arbeitslose_frauen: 103830 },
          },
        }),
      ],
      asOf,
    });
    expect(series.coverage).toBe("single");
    expect(series.valueKey).toBe("arbeitslose_insgesamt");
    expect(series.points.find((point) => point.period === "2026")).toEqual({
      period: "2026",
      status: "present",
      value: 223830,
    });
    expect(series.points.some((point) => point.value === 11000000)).toBe(false);
  });

  it("emits ba_sgb2 2026-09 counts as integers, not metadata floats", () => {
    const series = buildMetricSeries({
      metricId: "ba_sgb2",
      homeLevel: "kreis",
      region,
      docs: [
        feature({
          theme: "ba_sgb2",
          grain: "ags5",
          key: "11000",
          period: "2026-08|sgb2",
          metadata: { bedarfsgemeinschaften: 229100.0, personen_sgb2: 434000.0 },
        }),
        feature({
          theme: "ba_sgb2",
          grain: "ags5",
          key: "11000",
          period: "2026-09|sgb2",
          metadata: {
            geo_ags5: "11000",
            indicators: {
              bedarfsgemeinschaften: 230216.522,
              personen_sgb2: 435602.637,
              erwerbsfaehige_leistungsberechtigte: 301234.4,
              nicht_erwerbsfaehige_leistungsberechtigte: 134368.2,
              regelleistungsberechtigte: 412000.8,
            },
          },
        }),
      ],
      asOf,
    });
    expect(series.sourceLevel).toBe("kreis");
    expect(series.sourceGeoKey).toBe("11000");
    expect(series.granularity).toBe("month");
    expect(series.points.find((point) => point.period === "2026-09")).toEqual({
      period: "2026-09",
      status: "present",
      value: 230217,
    });
    expect(Number.isInteger(series.points.find((point) => point.period === "2026-09")?.value)).toBe(true);
    expect(series.points.find((point) => point.period === "2026-08")).toEqual({
      period: "2026-08",
      status: "present",
      value: 229100,
    });
  });
});

function stadtteilInMuenchen() {
  return keysForResolvedPlace("stadtteil", "stadtteil:osm:123", "09162000", "09162", "09");
}

function tempelhofDocs(): SeriesFeatureRow[] {
  const bevoelkerung = ["2022-12", "2023-12", "2024-12", "2025-12"].map((period, index) =>
    feature({
      theme: "regionalstatistik_bevoelkerung",
      grain: "ags",
      key: "11007007",
      period,
      metadata: { values: { insgesamt: 350000 + index, maennlich: 170000, weiblich: 180000 } },
    }),
  );
  const wanderungen = [
    { period: "2022|wanderungen", saldo: 2008 },
    { period: "2023|wanderungen", saldo: 1500 },
    { period: "2024|wanderungen", saldo: 900 },
  ].map((row) =>
    feature({
      theme: "regionalstatistik_wanderungen",
      grain: "ags",
      key: "11007007",
      period: row.period,
      metadata: { values: { zuzuege: 9000, fortzuege: 7000, saldo: row.saldo } },
    }),
  );
  const wohnungen = ["2020|wohnungen", "2021|wohnungen", "2022|wohnungen", "2023|wohnungen", "2024|wohnungen", "2025|wohnungen"].map(
    (period, index) =>
      feature({
        theme: "destatis_wohnungen",
        grain: "ags5",
        key: "11000",
        period,
        metadata: { wohnungen: 1900000 + index, raeume: 3, wohnflaeche_1000qm: 80 },
      }),
  );
  const elektro = ["2023-01|elektro", "2023-04|elektro", "2024-01|elektro", "2025-01|elektro", "2026-07|elektro"].map(
    (period, index) =>
      feature({
        theme: "kba_elektro_pkw",
        grain: "ags",
        key: "11000000",
        period,
        metadata: { pkw_insgesamt: 1000, pkw_elektro: 10 + index, pkw_bev: 8 },
      }),
  );
  const unfaelle = ["2018|unfallatlas_gebiet", "2019|unfallatlas_gebiet", "2024|unfallatlas_gebiet", "2025|unfallatlas_gebiet"].map(
    (period, index) =>
      feature({
        theme: "unfallatlas_gebiet",
        grain: "other",
        key: "ortsteil:osm:162894",
        period,
        metadata: { unfaelle_gesamt: 40 + index, getoetet_kat1: 0, schwer_kat2: 2 },
      }),
  );
  const sgb2 = ["2023-10|sgb2", "2023-11|sgb2", "2026-09|sgb2"].map((period, index) =>
    feature({
      theme: "ba_sgb2",
      grain: "ags5",
      key: "11000",
      period,
      metadata: { bg: 100 + index, pers: 200, elb: 80, nef: 40, rlb: 160 },
    }),
  );
  return [...bevoelkerung, ...wanderungen, ...wohnungen, ...elektro, ...unfaelle, ...sgb2];
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
