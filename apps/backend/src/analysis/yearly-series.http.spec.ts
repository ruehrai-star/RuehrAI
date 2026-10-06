import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { configureApp } from "../configure-app";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { RecommendationsService } from "../recommendations/recommendations.service";
import { BrainSearchService } from "./brain-search.service";
import { AnalysisService } from "./analysis.service";
import { SERIES_METRICS } from "./yearly-series";

describe("analysis yearlySeries HTTP", () => {
  const query = jest.fn();
  const queryReadingFeatures = jest.fn();
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({ query, queryReadingFeatures, onModuleDestroy: async () => undefined })
      .overrideProvider(BrainSearchService)
      .useValue({
        search: async () => ({
          mode: "sql",
          vectorUnavailableReason: "features_unavailable",
          factCount: 0,
          facts: [],
        }),
      })
      .overrideProvider(GeoCatalogService)
      .useValue({ search: async () => [], lookupAdminNames: async () => new Map() })
      .overrideProvider(RecommendationsService)
      .useValue({
        create: async () => ({ id: "28", runId: "15" }),
        latest: async () => {
          throw new Error("GET /recommendations is not used in this spec");
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    token = app.get(JwtService).sign({ sub: "1", email: "dev@ruehrai.local" });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    query.mockReset();
    queryReadingFeatures.mockReset();
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_ortsteil")) {
        return { rows: [{ id: "osm:123", geo_key: "stadtteil:osm:123", geo_ags: "09162000" }] };
      }
      if (sql.includes("location_feature_docs") || sql.includes("v_location_search")) {
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
      return { rows: [] };
    });
  });

  it("stores yearlySeries after POST /analysis/runs 202 and polling completes", async () => {
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [stadtteilRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.00" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "15", created_at: new Date("2026-10-05T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        const completed = query.mock.calls.some((call) => String(call[0]).includes("'completed'"));
        return {
          rows: [
            {
              id: "15",
              status: completed ? "completed" : "running",
              input: {
                region: {
                  label: "Schwabing",
                  grain: "other",
                  geoKey: "stadtteil:osm:123",
                  level: "stadtteil",
                  ags: "09162000",
                  plz: null,
                  lon: null,
                  lat: null,
                  bounds: null,
                  geometry: null,
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
                regions: [
                  {
                    label: "Schwabing",
                    grain: "other",
                    geoKey: "stadtteil:osm:123",
                    level: "stadtteil",
                    ags: "09162000",
                    plz: null,
                    lon: null,
                    lat: null,
                    bounds: null,
                    geometry: null,
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  },
                ],
                stores: [],
                revenueDirection: "up",
                capturedAt: "2026-10-05T00:00:00.000Z",
              },
              brain: {
                mode: "sql",
                vectorUnavailableReason: "features_unavailable",
                factCount: 0,
                facts: [],
              },
              pattern: { source: "heuristic", summary: "", revenueDirection: "up", criteria: [] },
              created_at: new Date("2026-10-05T00:00:00.000Z"),
              started_at: new Date("2026-10-05T00:00:01.000Z"),
              completed_at: completed ? new Date("2026-10-05T00:00:02.000Z") : null,
              failure_reason: null,
            },
          ],
        };
      }
      return {
        rows: [
          {
            started_at: new Date("2026-10-05T00:00:01.000Z"),
            completed_at: new Date("2026-10-05T00:00:02.000Z"),
          },
        ],
      };
    });

    const accepted = await request(app.getHttpServer())
      .post("/analysis/runs")
      .set("authorization", `Bearer ${token}`)
      .expect(202);
    expect(accepted.body.status).toBe("queued");
    await app.get(AnalysisService).whenIdle();

    const response = await request(app.getHttpServer())
      .get("/analysis/runs/15")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.pattern.yearlySeries).toHaveLength(SERIES_METRICS.length);
    const bevoelkerung = response.body.pattern.yearlySeries.find(
      (item: { metricId: string }) => item.metricId === "bevoelkerung",
    );
    expect(bevoelkerung).toMatchObject({
      metricId: "bevoelkerung",
      requestedLevel: "stadtteil",
      requestedGeoKey: "stadtteil:osm:123",
      sourceLevel: "gemeinde",
      sourceGeoKey: "09162000",
      granularity: "year",
      coverage: "single",
    });
    expect(bevoelkerung.points).toEqual([
      { period: "2023", status: "absent" },
      { period: "2024", status: "absent" },
      { period: "2025", status: "present", value: 1488202 },
    ]);
    expect(bevoelkerung.points[0].value).toBeUndefined();
    expect(response.body.status).toBe("completed");
    const stored = JSON.parse(
      (query.mock.calls.find((call) => String(call[0]).includes("'completed'"))?.[1]?.[3] as string) ?? "{}",
    );
    expect(stored.yearlySeries[0].coverage).toBeDefined();
    expect(response.body.pattern.yearlySeries.some((item: { metricId: string }) => item.metricId === "umsatz")).toBe(
      false,
    );
  });

  it("fills yearlySeries on GET /analysis/pattern when an old run omitted it", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "15",
          status: "completed",
          input: {
            region: {
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
            },
            stores: [],
            revenueDirection: "up",
            capturedAt: "2026-10-05T00:00:00.000Z",
          },
          brain: { mode: "sql", vectorUnavailableReason: "features_unavailable", factCount: 0, facts: [] },
          pattern: {
            source: "heuristic",
            summary: "Der Filialumsatz ist steigend.",
            revenueDirection: "up",
            criteria: [],
          },
          created_at: new Date("2026-10-05T00:00:00.000Z"),
        },
      ],
    });

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.runId).toBe("15");
    const bevoelkerung = response.body.pattern.yearlySeries.find(
      (item: { metricId: string }) => item.metricId === "bevoelkerung",
    );
    expect(bevoelkerung.coverage).toBe("single");
    expect(bevoelkerung.sourceLevel).toBe("gemeinde");
    expect(bevoelkerung.points.filter((point: { status: string }) => point.status === "present")).toHaveLength(1);
  });

  it("recomputes stored yearlySeries on GET /analysis/pattern so old single coverage does not stick", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "15",
          status: "completed",
          input: {
            region: {
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
            },
            stores: [],
            revenueDirection: "up",
            capturedAt: "2026-10-05T00:00:00.000Z",
          },
          brain: { mode: "sql", vectorUnavailableReason: "features_unavailable", factCount: 0, facts: [] },
          pattern: {
            source: "heuristic",
            summary: "Der Filialumsatz ist steigend.",
            revenueDirection: "up",
            criteria: [],
            yearlySeries: [
              {
                metricId: "bevoelkerung",
                requestedLevel: "ortsteil",
                requestedGeoKey: "ortsteil:osm:162894",
                sourceLevel: "gemeinde",
                sourceGeoKey: "11000000",
                granularity: "year",
                coverage: "single",
                points: [
                  { period: "2024", status: "absent" },
                  { period: "2025", status: "present", value: 1 },
                  { period: "2026", status: "absent" },
                ],
              },
            ],
          },
          created_at: new Date("2026-10-05T00:00:00.000Z"),
        },
      ],
    });
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_ortsteil")) {
        return { rows: [{ id: "osm:162894", geo_key: "ortsteil:osm:162894", geo_ags: "11000000", geo_bezirk_id: "11000007" }] };
      }
      if (sql.includes("location_feature_docs") || sql.includes("v_location_search")) {
        return {
          rows: [
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11007007",
              metadata: { values: { insgesamt: 350123, maennlich: 1, weiblich: 2 } },
              ref_period: "2023-12",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11007007",
              metadata: { values: { insgesamt: 351000, maennlich: 1, weiblich: 2 } },
              ref_period: "2024-12",
            },
            {
              source_theme: "regionalstatistik_bevoelkerung",
              grain: "ags",
              geo_key: "11007007",
              metadata: { values: { insgesamt: 352000, maennlich: 1, weiblich: 2 } },
              ref_period: "2025-12",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    const bevoelkerung = response.body.pattern.yearlySeries.find(
      (item: { metricId: string }) => item.metricId === "bevoelkerung",
    );
    expect(bevoelkerung.coverage).toBe("series");
    expect(bevoelkerung.sourceGeoKey).toBe("11007007");
    expect(bevoelkerung.points.filter((point: { status: string }) => point.status === "present")).toHaveLength(3);
  });

  it("keeps yearlySeries on GET when Tempelhof Ortsteil has no stored level", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "15",
          status: "completed",
          input: {
            region: {
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
            },
            stores: [],
            revenueDirection: "up",
            capturedAt: "2026-10-05T00:00:00.000Z",
          },
          brain: { mode: "sql", vectorUnavailableReason: "features_unavailable", factCount: 0, facts: [] },
          pattern: {
            source: "heuristic",
            summary: "Der Filialumsatz ist steigend.",
            revenueDirection: "up",
            criteria: [],
          },
          created_at: new Date("2026-10-05T00:00:00.000Z"),
        },
      ],
    });
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_ortsteil")) {
        return { rows: [{ id: "osm:162894", geo_key: "ortsteil:osm:162894", geo_ags: "11000000" }] };
      }
      if (sql.includes("location_feature_docs") || sql.includes("v_location_search")) {
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
              metadata: { bg: 230217 },
              ref_period: "2026-09|sgb2",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "11000",
              metadata: { bg: 229100 },
              ref_period: "2026-08|sgb2",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.pattern.yearlySeries).toHaveLength(SERIES_METRICS.length);
    const bevoelkerung = response.body.pattern.yearlySeries.find(
      (item: { metricId: string }) => item.metricId === "bevoelkerung",
    );
    expect(bevoelkerung).toMatchObject({
      requestedLevel: "ortsteil",
      requestedGeoKey: "ortsteil:osm:162894",
      sourceLevel: "gemeinde",
      sourceGeoKey: "11000000",
      coverage: "series",
    });
    const sgb2 = response.body.pattern.yearlySeries.find((item: { metricId: string }) => item.metricId === "ba_sgb2");
    expect(sgb2.coverage).toBe("series");
    expect(sgb2.sourceGeoKey).toBe("11000");
  });

  it("keeps yearlySeries on GET for Köln grain ags5 Kreis", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "15",
          status: "completed",
          input: {
            region: {
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
            },
            stores: [],
            revenueDirection: "up",
            capturedAt: "2026-10-05T00:00:00.000Z",
          },
          brain: { mode: "sql", vectorUnavailableReason: "features_unavailable", factCount: 0, facts: [] },
          pattern: {
            source: "heuristic",
            summary: "Der Filialumsatz ist steigend.",
            revenueDirection: "up",
            criteria: [],
          },
          created_at: new Date("2026-10-05T00:00:00.000Z"),
        },
      ],
    });
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("location_feature_docs") || sql.includes("v_location_search")) {
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
              ref_period: "2026-08|sgb2",
            },
            {
              source_theme: "ba_sgb2",
              grain: "ags5",
              geo_key: "05315",
              metadata: { bg: 40100 },
              ref_period: "2026-09|sgb2",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.pattern.yearlySeries).toHaveLength(SERIES_METRICS.length);
    expect(response.body.pattern.yearlySeries.length).toBeGreaterThan(0);
    const wohnungen = response.body.pattern.yearlySeries.find(
      (item: { metricId: string }) => item.metricId === "destatis_wohnungen",
    );
    expect(wohnungen).toMatchObject({
      requestedLevel: "kreis",
      requestedGeoKey: "05315",
      sourceLevel: "kreis",
      sourceGeoKey: "05315",
      coverage: "series",
    });
    const sgb2 = response.body.pattern.yearlySeries.find((item: { metricId: string }) => item.metricId === "ba_sgb2");
    expect(sgb2).toMatchObject({
      requestedLevel: "kreis",
      sourceLevel: "kreis",
      sourceGeoKey: "05315",
      coverage: "series",
    });
  });
});

function stadtteilRow() {
  return {
    label: "Schwabing",
    grain: "other",
    geo_key: "stadtteil:osm:123",
    level: "stadtteil",
    parent_label: "München",
    ags: null,
    plz: null,
    lon: null,
    lat: null,
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function storeRow(revenue: { year: number; month: number; revenue_eur: string }) {
  return {
    id: "3",
    label: null,
    street: "Marienplatz 1",
    postal_code: "80331",
    city: "München",
    lon: null,
    lat: null,
    ...revenue,
  };
}
