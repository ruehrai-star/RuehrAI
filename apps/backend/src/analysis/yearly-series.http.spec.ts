import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { configureApp } from "../configure-app";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { BrainSearchService } from "./brain-search.service";
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

  it("stores yearlySeries on POST /analysis/runs with coverage single", async () => {
    query
      .mockResolvedValueOnce({ rows: [stadtteilRow()] })
      .mockResolvedValueOnce({
        rows: [
          storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
          storeRow({ year: 2025, month: 2, revenue_eur: "130.00" }),
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: "15", created_at: new Date("2026-10-05T00:00:00.000Z") }] });

    const response = await request(app.getHttpServer())
      .post("/analysis/runs")
      .set("authorization", `Bearer ${token}`)
      .expect(201);

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
      { period: "2024", status: "absent" },
      { period: "2025", status: "present", value: 1488202 },
      { period: "2026", status: "absent" },
    ]);
    expect(bevoelkerung.points[0].value).toBeUndefined();
    const stored = JSON.parse(query.mock.calls[2]?.[1]?.[3] as string);
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
