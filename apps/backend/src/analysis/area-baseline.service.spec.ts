import { DatabaseService } from "../database/database.service";
import { AreaBaselineService } from "./area-baseline.service";
import { YearlySeries } from "./yearly-series";

function series(): YearlySeries[] {
  return [
    {
      metricId: "kba_elektro_pkw",
      requestedLevel: "gemeinde",
      requestedGeoKey: "11000000",
      sourceLevel: "gemeinde",
      sourceGeoKey: "11000000",
      granularity: "year",
      coverage: "single",
      points: [{ period: "2025", status: "present", value: 37 }],
    },
  ];
}

describe("AreaBaselineService", () => {
  it("falls back to feature-derived attach when the catalog table is missing", async () => {
    const queryReadingFeatures = jest.fn(async () => {
      const error = Object.assign(new Error('relation "geo.baseline_metric_catalog" does not exist'), { code: "42P01" });
      throw error;
    });
    const service = new AreaBaselineService({ queryReadingFeatures } as unknown as DatabaseService);
    const out = await service.normalize(series());
    expect(out[0]?.points[0]).toMatchObject({ period: "2025", status: "present", value: 37 });
    expect(out[0]?.points[0]?.normalizedValue).toBeUndefined();
    expect(out[0]?.points[0]?.baselineMethod).toBeUndefined();
  });

  it("attaches official method from geo.area_baseline", async () => {
    const queryReadingFeatures = jest.fn(async (sql: string) => {
      if (sql.includes("baseline_metric_catalog")) {
        return {
          rows: [
            { source_theme: "kba_elektro_pkw", recommended_baseline: "einwohner", unit_hint: "per_1000_einwohner" },
          ],
        };
      }
      if (sql.includes("area_baseline")) {
        return {
          rows: [
            {
              geo_key: "11000000",
              grain: "ags",
              ref_year: 2025,
              einwohner: 3700,
              flaeche_km2: 891.7,
              haushalte: null,
              einwohner_method: "official",
              haushalte_method: null,
              flaeche_method: "geom",
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
    const service = new AreaBaselineService({ queryReadingFeatures } as unknown as DatabaseService);
    const out = await service.normalize(series());
    expect(out[0]?.points[0]).toMatchObject({
      value: 37,
      normalizedValue: 10,
      baselineMethod: "official",
    });
  });

  it("loads every year for the geo keys so nearest-year fallback can run", async () => {
    const queryReadingFeatures = jest.fn(async (sql: string) => {
      if (sql.includes("baseline_metric_catalog")) return { rows: [] };
      if (sql.includes("area_baseline")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });
    const service = new AreaBaselineService({ queryReadingFeatures } as unknown as DatabaseService);
    await service.normalize(series());
    const areaCall = queryReadingFeatures.mock.calls.find((call) => String(call[0]).includes("area_baseline")) as
      | [string, [string[]]]
      | undefined;
    expect(String(areaCall?.[0])).not.toContain("ref_year = ANY");
    expect(areaCall?.[1]?.[0]).toEqual(expect.arrayContaining(["11000000"]));
    expect(areaCall?.[1]).toHaveLength(1);
  });

  it("fills missing koeln:sq flaeche_km2 from geo_ref_quartier area", async () => {
    const queryReadingFeatures = jest.fn(async (sql: string) => {
      if (sql.includes("baseline_metric_catalog")) {
        return {
          rows: [{ source_theme: "unfallatlas_gebiet", recommended_baseline: "flaeche_km2", unit_hint: "per_km2" }],
        };
      }
      if (sql.includes("area_baseline") && !sql.includes("geo_ref_quartier")) {
        return {
          rows: [
            {
              geo_key: "koeln:sq:104030005",
              grain: "quartier",
              ref_year: 2026,
              einwohner: 1200,
              flaeche_km2: null,
              haushalte: null,
              einwohner_method: "official",
              haushalte_method: null,
              flaeche_method: "missing",
            },
          ],
        };
      }
      if (sql.includes("geo_ref_quartier")) {
        return {
          rows: [
            {
              geo_key: "koeln:sq:104030005",
              grain: "quartier",
              ref_year: 2026,
              einwohner: null,
              flaeche_km2: 0.12,
              haushalte: null,
              einwohner_method: null,
              haushalte_method: null,
              flaeche_method: "geom",
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
    const service = new AreaBaselineService({ queryReadingFeatures } as unknown as DatabaseService);
    const out = await service.normalize([
      {
        metricId: "unfallatlas_gebiet",
        requestedLevel: "quartier",
        requestedGeoKey: "koeln:sq:104030005",
        sourceLevel: "quartier",
        sourceGeoKey: "koeln:sq:104030005",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2026", status: "present", value: 6 }],
      },
    ]);
    expect(out[0]?.points[0]).toMatchObject({
      value: 6,
      normalizedValue: 50,
      baselineMethod: "geom",
    });
  });

  it("keeps area_baseline rows when geo_ref_quartier is unreadable", async () => {
    const queryReadingFeatures = jest.fn(async (sql: string) => {
      if (sql.includes("baseline_metric_catalog")) return { rows: [] };
      if (sql.includes("area_baseline") && !sql.includes("geo_ref_quartier")) {
        return {
          rows: [
            {
              geo_key: "koeln:sq:1",
              grain: "quartier",
              ref_year: 2026,
              einwohner: 10,
              flaeche_km2: null,
              haushalte: null,
              einwohner_method: "official",
              haushalte_method: null,
              flaeche_method: null,
            },
          ],
        };
      }
      if (sql.includes("geo_ref_quartier")) {
        throw Object.assign(new Error('permission denied for table geo_ref_quartier'), { code: "42501" });
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
    const service = new AreaBaselineService({ queryReadingFeatures } as unknown as DatabaseService);
    const out = await service.normalize([
      {
        metricId: "unfallatlas_gebiet",
        requestedLevel: "quartier",
        requestedGeoKey: "koeln:sq:1",
        sourceLevel: "quartier",
        sourceGeoKey: "koeln:sq:1",
        granularity: "year",
        coverage: "single",
        points: [{ period: "2025", status: "present", value: 6 }],
      },
    ]);
    expect(out[0]?.points[0]?.value).toBe(6);
    expect(out[0]?.points[0]?.normalizedValue).toBeUndefined();
  });
});
