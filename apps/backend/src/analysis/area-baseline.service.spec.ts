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

  it("always loads the 2022 Zensus year with the 2026 snapshot", async () => {
    const queryReadingFeatures = jest.fn(async (sql: string) => {
      if (sql.includes("baseline_metric_catalog")) return { rows: [] };
      if (sql.includes("area_baseline")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    });
    const service = new AreaBaselineService({ queryReadingFeatures } as unknown as DatabaseService);
    await service.normalize(series());
    const areaCall = queryReadingFeatures.mock.calls.find((call) => String(call[0]).includes("area_baseline")) as
      | [string, [string[], number[]]]
      | undefined;
    expect(areaCall?.[1]?.[1]).toEqual(expect.arrayContaining([2022, 2026]));
  });
});
