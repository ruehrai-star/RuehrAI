import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { configureApp } from "../configure-app";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { PATTERN_FOR_REGION_NOT_FOUND, PATTERN_NOT_FOUND } from "./messages";
import { BrainSearchService } from "./brain-search.service";
import { YearlySeriesService } from "./yearly-series.service";

describe("GET /analysis/pattern geoKey", () => {
  const query = jest.fn();
  const buildSeries = jest.fn();
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({ query, queryReadingFeatures: async () => ({ rows: [] }), onModuleDestroy: async () => undefined })
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
      .overrideProvider(YearlySeriesService)
      .useValue({ build: buildSeries })
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
    buildSeries.mockReset();
    buildSeries.mockResolvedValue([]);
  });

  it("returns the matching run when two snapshots exist for different geoKeys", async () => {
    query.mockResolvedValueOnce({ rows: [runRow("10", muenchen())] });
    buildSeries.mockResolvedValueOnce([series("09162000"), series("11000001")]);

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .query({ geoKey: "09162000" })
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.runId).toBe("10");
    expect(response.body.region).toMatchObject({
      label: "München",
      geoKey: "09162000",
      level: "gemeinde",
      grain: "ags",
    });
    expect(response.body.pattern.yearlySeries).toEqual([series("09162000")]);
    expect(query.mock.calls[0]?.[1]?.[1]).toEqual(expect.arrayContaining(["09162000"]));
  });

  it("answers 404 for a geoKey with no matching run instead of another region's pattern", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .query({ geoKey: "11000001" })
      .set("authorization", `Bearer ${token}`)
      .expect(404);

    expect(response.body.message).toBe(PATTERN_FOR_REGION_NOT_FOUND);
    expect(query.mock.calls[0]?.[1]?.[1]).toEqual(expect.arrayContaining(["11000001"]));
    expect(query.mock.calls[0]?.[1]?.[1]).not.toEqual(expect.arrayContaining(["09162000"]));
  });

  it("keeps unfiltered GET on the newest completed run", async () => {
    query.mockResolvedValueOnce({ rows: [runRow("11", mitte())] });
    buildSeries.mockResolvedValueOnce([series("11000001")]);

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.runId).toBe("11");
    expect(response.body.region).toMatchObject({ label: "Mitte", geoKey: "11000001" });
    expect(response.body.pattern.yearlySeries).toEqual([series("11000001")]);
    expect(query.mock.calls[0]?.[1]).toEqual(["1"]);
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining("jsonb_array_elements"));
  });

  it("filters yearlySeries when geoKey is set on a multi-region snapshot", async () => {
    query.mockResolvedValueOnce({
      rows: [runRow("15", muenchen(), [muenchen(), mitte()])],
    });
    buildSeries.mockResolvedValueOnce([series("09162000"), series("11000001")]);

    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .query({ geoKey: "09162000" })
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.pattern.yearlySeries.map((row: { requestedGeoKey: string }) => row.requestedGeoKey)).toEqual([
      "09162000",
    ]);
    expect(buildSeries).toHaveBeenCalledWith(
      [expect.objectContaining({ geoKey: "09162000" })],
      expect.any(Date),
      undefined,
    );
  });

  it("answers the unfiltered 404 when this user has no completed run", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const response = await request(app.getHttpServer())
      .get("/analysis/pattern")
      .set("authorization", `Bearer ${token}`)
      .expect(404);
    expect(response.body.message).toBe(PATTERN_NOT_FOUND);
  });
});

function muenchen() {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    level: "gemeinde",
    parentLabel: null,
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mitte() {
  return {
    label: "Mitte",
    grain: "ags",
    geoKey: "11000001",
    level: "bezirk",
    parentLabel: "Berlin",
    ags: "11000001",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function runRow(
  id: string,
  region: ReturnType<typeof muenchen> | ReturnType<typeof mitte>,
  regions: Array<ReturnType<typeof muenchen> | ReturnType<typeof mitte>> = [region],
) {
  return {
    id,
    status: "completed",
    input: {
      region,
      regions,
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
    created_at: new Date("2026-04-02T00:00:00.000Z"),
  };
}

function series(requestedGeoKey: string) {
  return {
    metricId: "bevoelkerung",
    requestedLevel: "gemeinde",
    requestedGeoKey,
    sourceLevel: "gemeinde",
    sourceGeoKey: requestedGeoKey,
    granularity: "year",
    coverage: "single",
    points: [{ period: "2025", status: "present", value: 1 }],
  };
}
