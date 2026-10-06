import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { configureApp } from "../configure-app";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { BrainSearchService } from "../analysis/brain-search.service";
import { highestSqlPlaceholder } from "./area-candidates";

/**
 * POST /analysis/runs must persist a recommendation set. GET ?runId= reads it.
 * queryReadingFeatures throws 08P01 when SQL $n and params diverge — the STAGE
 * failure on Lauf 32 (München) / Tempelhof PLR.
 * A failed set save marks the run failed (OpenAPI 0.19.0 lifecycle).
 */
describe("POST /analysis/runs binds GET /recommendations?runId=", () => {
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

  it("stores a set for München 09162000 and returns it on GET ?runId=", async () => {
    await expectStoredSet({
      runId: "32",
      region: muenchenRow(),
      candidates: [
        {
          geo_key: "ortsteil:osm:1",
          grain: "other",
          kind: "ortsteil",
          name: "Altstadt",
          ags: "09162000",
          plz: null,
          lon: 11.57,
          lat: 48.14,
        },
      ],
    });
  });

  it("stores a set for Tempelhof PLR and returns it on GET ?runId=", async () => {
    await expectStoredSet({
      runId: "33",
      region: tempelhofRow(),
      candidates: [
        {
          geo_key: "lor:plr:07400720",
          grain: "other",
          kind: "lor",
          name: "Gontermannstraße",
          ags: "11000000",
          plz: null,
          lon: 13.38,
          lat: 52.47,
        },
      ],
    });
  });

  async function expectStoredSet(fixture: {
    runId: string;
    region: ReturnType<typeof muenchenRow> | ReturnType<typeof tempelhofRow>;
    candidates: Array<{
      geo_key: string;
      grain: string;
      kind: string;
      name: string;
      ags: string;
      plz: string | null;
      lon: number;
      lat: number;
    }>;
  }): Promise<void> {
    const sets = new Map<string, { id: string; payload: Record<string, unknown>; created_at: Date }>();
    const runRow = {
      id: fixture.runId,
      status: "queued",
      input: null as unknown,
      pattern: {
        source: "heuristic",
        summary: "Der Filialumsatz ist steigend.",
        revenueDirection: "up",
        criteria: [],
      },
      created_at: new Date("2026-10-06T08:00:00.000Z"),
      started_at: null as Date | null,
      completed_at: null as Date | null,
      failure_reason: null as string | null,
    };

    query.mockReset();
    queryReadingFeatures.mockReset();
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      assertPgArity(sql, params);
      if (String(sql).includes("FROM app.target_regions")) {
        return { rows: [fixture.region] };
      }
      if (String(sql).includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.00" }),
          ],
        };
      }
      if (String(sql).includes("INSERT INTO app.analysis_runs")) {
        runRow.input = JSON.parse(String(params[1]));
        runRow.status = "queued";
        return { rows: [{ id: fixture.runId, created_at: runRow.created_at }] };
      }
      if (String(sql).includes("UPDATE app.analysis_runs")) {
        const text = String(sql);
        if (text.includes("'failed'")) {
          runRow.status = "failed";
          runRow.completed_at = new Date("2026-10-06T08:00:01.500Z");
          runRow.failure_reason = typeof params[2] === "string" ? params[2] : null;
        } else if (text.includes("'completed'")) {
          runRow.status = "completed";
          runRow.completed_at = new Date("2026-10-06T08:00:01.000Z");
          runRow.failure_reason = null;
        } else if (text.includes("SET status") && text.includes("'running'")) {
          runRow.status = "running";
          runRow.started_at = new Date("2026-10-06T08:00:00.500Z");
        }
        return { rows: [{ started_at: runRow.started_at, completed_at: runRow.completed_at }] };
      }
      if (String(sql).includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: fixture.runId,
              status: runRow.status,
              input: runRow.input,
              brain: {
                mode: "sql",
                vectorUnavailableReason: "features_unavailable",
                factCount: 0,
                facts: [],
              },
              pattern: runRow.pattern,
              created_at: runRow.created_at,
              started_at: runRow.started_at,
              completed_at: runRow.completed_at,
              failure_reason: runRow.failure_reason,
            },
          ],
        };
      }
      if (String(sql).includes("INSERT INTO app.recommendation_sets")) {
        const payload = JSON.parse(String(params[2])) as Record<string, unknown>;
        const stored = { id: `set-${fixture.runId}`, payload, created_at: new Date("2026-10-06T08:00:01.000Z") };
        sets.set(String(params[1]), stored);
        return { rows: [{ id: stored.id, created_at: stored.created_at }] };
      }
      if (String(sql).includes("FROM app.recommendation_sets")) {
        const stored = sets.get(String(params[1]));
        return { rows: stored ? [stored] : [] };
      }
      return { rows: [] };
    });
    queryReadingFeatures.mockImplementation(async (sql: string, params: unknown[] = []) => {
      assertPgArity(sql, params);
      const text = String(sql);
      if (
        text.includes("geo_ref_zielregion_teil") ||
        text.includes("geo.geo_ref_lor") ||
        text.includes("lor:plr:%")
      ) {
        return { rows: fixture.candidates };
      }
      return { rows: [] };
    });

    const created = await request(app.getHttpServer())
      .post("/analysis/runs")
      .set("authorization", `Bearer ${token}`)
      .expect(201);
    expect(created.body.id).toBe(fixture.runId);
    expect(created.body.status).toBe("completed");
    expect(sets.has(fixture.runId)).toBe(true);

    const listed = await request(app.getHttpServer())
      .get("/recommendations")
      .query({ runId: fixture.runId })
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(listed.body.runId).toBe(fixture.runId);
    expect(listed.body.id).toBe(`set-${fixture.runId}`);
  }

  it("marks the run failed when the recommendation set is not stored", async () => {
    const runId = "34";
    let runStatus = "queued";
    query.mockReset();
    queryReadingFeatures.mockReset();
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      assertPgArity(sql, params);
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) {
        return { rows: [muenchenRow()] };
      }
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.00" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        runStatus = "queued";
        return { rows: [{ id: runId, created_at: new Date("2026-10-06T08:00:00.000Z") }] };
      }
      if (text.includes("UPDATE app.analysis_runs")) {
        if (text.includes("'failed'")) runStatus = "failed";
        else if (text.includes("'completed'")) runStatus = "completed";
        else if (text.includes("SET status") && text.includes("'running'")) runStatus = "running";
        return { rows: [{ started_at: new Date("2026-10-06T08:00:00.500Z"), completed_at: new Date() }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: runId,
              status: runStatus,
              input: JSON.parse(String(query.mock.calls.find((call) => String(call[0]).includes("INSERT INTO app.analysis_runs"))?.[1]?.[1] ?? "{}")),
              brain: {
                mode: "sql",
                vectorUnavailableReason: "features_unavailable",
                factCount: 0,
                facts: [],
              },
              pattern: {
                source: "heuristic",
                summary: "Der Filialumsatz ist steigend.",
                revenueDirection: "up",
                criteria: [],
              },
              created_at: new Date("2026-10-06T08:00:00.000Z"),
              started_at: new Date("2026-10-06T08:00:00.500Z"),
              completed_at: runStatus === "failed" ? new Date("2026-10-06T08:00:01.500Z") : null,
              failure_reason: runStatus === "failed" ? "Die Analyse ist fehlgeschlagen. Bitte erneut versuchen." : null,
            },
          ],
        };
      }
      if (text.includes("INSERT INTO app.recommendation_sets")) {
        throw Object.assign(
          new Error('bind message supplies 4 parameters, but prepared statement "" requires 3'),
          { code: "08P01" },
        );
      }
      return { rows: [] };
    });
    queryReadingFeatures.mockImplementation(async (sql: string, params: unknown[] = []) => {
      assertPgArity(sql, params);
      if (String(sql).includes("geo_ref_zielregion_teil") || String(sql).includes("geo.geo_ref_lor")) {
        return {
          rows: [
            {
              geo_key: "ortsteil:osm:1",
              grain: "other",
              kind: "ortsteil",
              name: "Altstadt",
              ags: "09162000",
              plz: null,
              lon: 11.57,
              lat: 48.14,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await request(app.getHttpServer())
      .post("/analysis/runs")
      .set("authorization", `Bearer ${token}`)
      .expect(500);
    expect(query.mock.calls.some((call) => /SET\s+status\s*=\s*'failed'/.test(String(call[0])))).toBe(true);
    expect(query.mock.calls.some((call) => /SET\s+status\s*=\s*'completed'/.test(String(call[0])))).toBe(false);

    const run = await request(app.getHttpServer())
      .get(`/analysis/runs/${runId}`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(run.body.status).toBe("failed");
    expect(run.body.failureReason).toBe("Die Analyse ist fehlgeschlagen. Bitte erneut versuchen.");

    await request(app.getHttpServer())
      .get("/recommendations")
      .query({ runId })
      .set("authorization", `Bearer ${token}`)
      .expect(404);
  });
});

function assertPgArity(sql: string, params: unknown[]): void {
  const highest = highestSqlPlaceholder(sql);
  if (params.length === highest) return;
  throw Object.assign(
    new Error(
      `bind message supplies ${params.length} parameters, but prepared statement "" requires ${highest}`,
    ),
    { code: "08P01" },
  );
}

function muenchenRow() {
  return {
    label: "München",
    grain: "ags",
    geo_key: "09162000",
    level: "gemeinde",
    parent_label: null,
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function tempelhofRow() {
  return {
    label: "Tempelhof",
    grain: "other",
    geo_key: "ortsteil:osm:162894",
    level: "ortsteil",
    parent_label: "Berlin",
    ags: "11000000",
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
    lon: 11.58,
    lat: 48.14,
    ...revenue,
  };
}
