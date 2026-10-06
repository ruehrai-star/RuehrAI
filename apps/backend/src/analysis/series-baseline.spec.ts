import { attachNormalizedValues, baselineForMetric, presentNormalizedPoints } from "./series-baseline";
import { YearlySeries } from "./yearly-series";
import { MetricCatalogEntry } from "./area-baseline";

function kba(geoKey: string, values: Array<[string, number]>): YearlySeries {
  return {
    metricId: "kba_elektro_pkw",
    requestedLevel: "bezirk",
    requestedGeoKey: geoKey,
    sourceLevel: "bezirk",
    sourceGeoKey: geoKey,
    granularity: "year",
    coverage: "multi",
    points: values.map(([period, value]) => ({ period, status: "present" as const, value })),
  };
}

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

  it("uses geo.area_baseline catalog methods and never fills missing EW from a sibling series", () => {
    const catalog = new Map<string, MetricCatalogEntry>([
      ["kba_elektro_pkw", { sourceTheme: "kba_elektro_pkw", recommendedBaseline: "einwohner", unitHint: "per_1000_einwohner" }],
    ]);
    const series: YearlySeries[] = [
      kba("11000001", [
        ["2023", 20],
        ["2024", 30],
        ["2025", 40],
      ]),
      {
        metricId: "bevoelkerung",
        requestedLevel: "bezirk",
        requestedGeoKey: "11000001",
        sourceLevel: "bezirk",
        sourceGeoKey: "11000001",
        granularity: "year",
        coverage: "multi",
        points: [
          { period: "2023", status: "present", value: 10_000 },
          { period: "2024", status: "present", value: 10_000 },
          { period: "2025", status: "present", value: 10_000 },
        ],
      },
    ];
    const official = attachNormalizedValues(series, {
      catalog,
      rows: [
        {
          geoKey: "11000001",
          grain: "bezirk",
          refYear: 2023,
          einwohner: 10_000,
          flaecheKm2: 12.3,
          haushalte: null,
          einwohnerMethod: "official",
          haushalteMethod: null,
          flaecheMethod: "geom",
        },
        {
          geoKey: "11000001",
          grain: "bezirk",
          refYear: 2024,
          einwohner: null,
          flaecheKm2: 12.3,
          haushalte: null,
          einwohnerMethod: "missing",
          haushalteMethod: null,
          flaecheMethod: "geom",
        },
        {
          geoKey: "11000001",
          grain: "bezirk",
          refYear: 2025,
          einwohner: 10_000,
          flaecheKm2: 12.3,
          haushalte: null,
          einwohnerMethod: "estimate_lor_sum",
          haushalteMethod: null,
          flaecheMethod: "geom",
        },
      ],
    });
    const kbaSeries = official.find((item) => item.metricId === "kba_elektro_pkw");
    expect(kbaSeries?.points.find((point) => point.period === "2023")).toMatchObject({
      normalizedValue: 2,
      baselineMethod: "official",
    });
    expect(kbaSeries?.points.find((point) => point.period === "2024")).toMatchObject({
      value: 30,
      baselineMethod: "missing",
    });
    expect(kbaSeries?.points.find((point) => point.period === "2024")?.normalizedValue).toBeUndefined();
    expect(kbaSeries?.points.find((point) => point.period === "2025")).toMatchObject({
      normalizedValue: 4,
      baselineMethod: "estimate_lor_sum",
    });

    const second = attachNormalizedValues(official);
    expect(second.find((item) => item.metricId === "kba_elektro_pkw")?.points.find((point) => point.period === "2024")).toMatchObject({
      baselineMethod: "missing",
    });
    expect(second.find((item) => item.metricId === "kba_elektro_pkw")?.points.find((point) => point.period === "2024")?.normalizedValue).toBeUndefined();
    expect(JSON.stringify(second.find((item) => item.metricId === "kba_elektro_pkw")?.points.find((point) => point.period === "2024"))).not.toMatch(
      /"normalizedValue":0/,
    );
  });

  it("normalizes grid100 from estimate_address and leaves missing EW absent", () => {
    const catalog = new Map<string, MetricCatalogEntry>([
      ["breitband", { sourceTheme: "breitband_gitter", recommendedBaseline: "flaeche_km2", unitHint: "per_km2" }],
      ["kba_elektro_pkw", { sourceTheme: "kba_elektro_pkw", recommendedBaseline: "einwohner", unitHint: "per_1000_einwohner" }],
    ]);
    const series: YearlySeries[] = [
      {
        metricId: "kba_elektro_pkw",
        requestedLevel: "grid100",
        requestedGeoKey: "cell-a",
        sourceLevel: "grid100",
        sourceGeoKey: "cell-a",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2026", status: "present", value: 2 }],
      },
      {
        metricId: "breitband",
        requestedLevel: "grid100",
        requestedGeoKey: "cell-a",
        sourceLevel: "grid100",
        sourceGeoKey: "cell-a",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2026", status: "present", value: 1 }],
      },
    ];
    const withEw = attachNormalizedValues(series, {
      catalog,
      rows: [
        {
          geoKey: "cell-a",
          grain: "grid100",
          refYear: 2026,
          einwohner: 200,
          flaecheKm2: 0.01,
          haushalte: null,
          einwohnerMethod: "estimate_address",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
        },
      ],
    });
    expect(withEw.find((item) => item.metricId === "kba_elektro_pkw")?.points[0]).toMatchObject({
      normalizedValue: 10,
      baselineMethod: "estimate_address",
    });
    expect(withEw.find((item) => item.metricId === "breitband")?.points[0]).toMatchObject({
      normalizedValue: 100,
      baselineMethod: "fixed_grid",
    });

    const missing = attachNormalizedValues(series, {
      catalog,
      rows: [
        {
          geoKey: "cell-a",
          grain: "grid100",
          refYear: 2026,
          einwohner: null,
          flaecheKm2: 0.01,
          haushalte: null,
          einwohnerMethod: "missing",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
        },
      ],
    });
    expect(missing.find((item) => item.metricId === "kba_elektro_pkw")?.points[0]?.normalizedValue).toBeUndefined();
    expect(missing.find((item) => item.metricId === "kba_elektro_pkw")?.points[0]?.baselineMethod).toBe("missing");
  });

  it("uses official_zensus2022_grid instead of estimate_address when preferred_ew points to Zensus", () => {
    const catalog = new Map<string, MetricCatalogEntry>([
      ["kba_elektro_pkw", { sourceTheme: "kba_elektro_pkw", recommendedBaseline: "einwohner", unitHint: "per_1000_einwohner" }],
    ]);
    const series: YearlySeries[] = [
      {
        metricId: "kba_elektro_pkw",
        requestedLevel: "grid100",
        requestedGeoKey: "CRS3035RES100mN1",
        sourceLevel: "grid100",
        sourceGeoKey: "CRS3035RES100mN1",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2025", status: "present", value: 8 }],
      },
    ];
    const normalized = attachNormalizedValues(series, {
      catalog,
      rows: [
        {
          geoKey: "CRS3035RES100mN1",
          grain: "grid100",
          refYear: 2022,
          einwohner: 80,
          flaecheKm2: 0.01,
          haushalte: null,
          einwohnerMethod: "official_zensus2022_grid",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
        },
        {
          geoKey: "CRS3035RES100mN1",
          grain: "grid100",
          refYear: 2026,
          einwohner: 4,
          flaecheKm2: 0.01,
          haushalte: null,
          einwohnerMethod: "estimate_address",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
          attrs: { preferred_ew: 2022 },
        },
      ],
    });
    expect(normalized[0]?.points[0]).toMatchObject({
      normalizedValue: 100,
      baselineMethod: "official_zensus2022_grid",
    });
  });

  it("leaves dwd1km Einwohner missing and still divides by the 1 km² grid", () => {
    const catalog = new Map<string, MetricCatalogEntry>([
      ["dwd_temp_1km", { sourceTheme: "dwd_temp_1km", recommendedBaseline: "flaeche_km2", unitHint: "per_km2" }],
      ["kba_elektro_pkw", { sourceTheme: "kba_elektro_pkw", recommendedBaseline: "einwohner", unitHint: "per_1000_einwohner" }],
    ]);
    const series: YearlySeries[] = [
      {
        metricId: "dwd_temp_1km",
        requestedLevel: "gemeinde",
        requestedGeoKey: "dwd1km:181:0",
        sourceLevel: "gemeinde",
        sourceGeoKey: "dwd1km:181:0",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2026", status: "present", value: 3 }],
      },
      {
        metricId: "kba_elektro_pkw",
        requestedLevel: "gemeinde",
        requestedGeoKey: "dwd1km:181:0",
        sourceLevel: "gemeinde",
        sourceGeoKey: "dwd1km:181:0",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2026", status: "present", value: 3 }],
      },
    ];
    const normalized = attachNormalizedValues(series, {
      catalog,
      rows: [
        {
          geoKey: "dwd1km:181:0",
          grain: "dwd1km",
          refYear: 2026,
          einwohner: null,
          flaecheKm2: 1,
          haushalte: null,
          einwohnerMethod: "missing",
          haushalteMethod: null,
          flaecheMethod: "fixed_grid",
        },
      ],
    });
    expect(normalized.find((item) => item.metricId === "dwd_temp_1km")?.points[0]).toMatchObject({
      normalizedValue: 3,
      baselineMethod: "fixed_grid",
    });
    expect(normalized.find((item) => item.metricId === "kba_elektro_pkw")?.points[0]?.normalizedValue).toBeUndefined();
    expect(normalized.find((item) => item.metricId === "kba_elektro_pkw")?.points[0]?.baselineMethod).toBe("missing");
  });

  it("normalizes Unfallatlas on a nearest Einwohner year and never writes rate 0 for 0 EW", () => {
    const catalog = new Map<string, MetricCatalogEntry>([
      ["unfallatlas", { sourceTheme: "unfallatlas_gebiet", recommendedBaseline: "einwohner", unitHint: "per_1000_einwohner" }],
    ]);
    const series: YearlySeries[] = [
      {
        metricId: "unfallatlas",
        requestedLevel: "lor",
        requestedGeoKey: "lor:plr:07400720",
        sourceLevel: "lor",
        sourceGeoKey: "lor:plr:07400720",
        granularity: "year",
        coverage: "multi",
        points: [
          { period: "2018", status: "present", value: 35 },
          { period: "2023", status: "present", value: 35 },
        ],
      },
      {
        metricId: "unfallatlas",
        requestedLevel: "lor",
        requestedGeoKey: "lor:plr:03400831",
        sourceLevel: "lor",
        sourceGeoKey: "lor:plr:03400831",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2023", status: "present", value: 0 }],
      },
    ];
    const normalized = attachNormalizedValues(series, {
      catalog,
      rows: [
        {
          geoKey: "lor:plr:07400720",
          grain: "lor_plr",
          refYear: 2021,
          einwohner: 11_780,
          flaecheKm2: 0.4,
          haushalte: null,
          einwohnerMethod: "official",
          haushalteMethod: null,
          flaecheMethod: "geom",
        },
        {
          geoKey: "lor:plr:07400720",
          grain: "lor_plr",
          refYear: 2023,
          einwohner: 11_780,
          flaecheKm2: 0.4,
          haushalte: null,
          einwohnerMethod: "official",
          haushalteMethod: null,
          flaecheMethod: "geom",
        },
        {
          geoKey: "lor:plr:03400831",
          grain: "lor_plr",
          refYear: 2023,
          einwohner: 0,
          flaecheKm2: 0.2,
          haushalte: null,
          einwohnerMethod: "official",
          haushalteMethod: null,
          flaecheMethod: "geom",
        },
      ],
    });
    const gontermann = normalized.find((item) => item.requestedGeoKey === "lor:plr:07400720");
    expect(gontermann?.points.find((point) => point.period === "2018")).toMatchObject({
      value: 35,
      baselineMethod: "official",
      baselineYear: 2021,
      baselineYearRule: "nearest",
    });
    expect(gontermann?.points.find((point) => point.period === "2018")?.normalizedValue).toBeCloseTo(2.9711, 3);
    expect(gontermann?.points.find((point) => point.period === "2023")).toMatchObject({
      baselineMethod: "official",
      baselineYear: 2023,
      baselineYearRule: "exact",
    });
    const pankow = normalized.find((item) => item.requestedGeoKey === "lor:plr:03400831");
    expect(pankow?.points[0]?.normalizedValue).toBeUndefined();
    expect(pankow?.points[0]?.baselineMethod).toBe("missing");
    expect(JSON.stringify(pankow?.points[0])).not.toMatch(/"normalizedValue":0/);
  });
});
