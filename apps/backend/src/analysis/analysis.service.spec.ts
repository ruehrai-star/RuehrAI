import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { AnalysisService } from "./analysis.service";
import { BrainSearchService } from "./brain-search.service";
import { PATTERN_FOR_REGION_NOT_FOUND, PATTERN_NOT_FOUND, REGION_MISSING, REVENUE_INSUFFICIENT, RUN_NOT_FOUND, TOO_MANY_TARGET_REGIONS, MARKED_TARGET_REGION_NOT_FOUND, MARKED_TARGET_REGION_NOT_FOUND_CODE } from "./messages";
import { PatternService } from "./pattern.service";
import { AnalysisBrain, AnalysisInput, AnalysisPattern, AnalysisRegion } from "./types";
import { YearlySeries } from "./yearly-series";
import { YearlySeriesService } from "./yearly-series.service";
import { RecommendationsService } from "../recommendations/recommendations.service";

const brainResult: AnalysisBrain = {
  mode: "sql",
  vectorUnavailableReason: "features_unavailable",
  factCount: 0,
  facts: [],
};

const pattern: AnalysisPattern = {
  source: "heuristic",
  summary: "Der Filialumsatz ist steigend.",
  revenueDirection: "up",
  criteria: [],
};

describe("AnalysisService", () => {
  const query = jest.fn();
  const search = jest.fn();
  const catalogSearch = jest.fn();
  const derive = jest.fn();
  const buildSeries = jest.fn();
  const createRecommendations = jest.fn();
  let service: AnalysisService;

  beforeEach(() => {
    query.mockReset();
    search.mockReset();
    catalogSearch.mockReset();
    derive.mockReset();
    buildSeries.mockReset();
    createRecommendations.mockReset();
    search.mockResolvedValue(brainResult);
    catalogSearch.mockResolvedValue([]);
    derive.mockResolvedValue(pattern);
    buildSeries.mockResolvedValue([]);
    createRecommendations.mockResolvedValue({ id: "28", runId: "15" });
    service = new AnalysisService(
      { query } as unknown as DatabaseService,
      { search } as unknown as BrainSearchService,
      { derive } as unknown as PatternService,
      { search: catalogSearch, lookupAdminNames: async () => new Map() } as unknown as GeoCatalogService,
      { build: buildSeries } as unknown as YearlySeriesService,
      { create: createRecommendations } as unknown as RecommendationsService,
    );
  });

  afterEach(async () => {
    await service.whenIdle();
  });

  it("answers 404 when the user has no target region", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.getInput("4")).rejects.toMatchObject({
      message: REGION_MISSING,
    });
    await expect(service.getInput("4")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("answers 400 when no store has two adjacent revenue months", async () => {
    query
      .mockResolvedValueOnce({ rows: [regionRow()] })
      .mockResolvedValueOnce({
        rows: [storeRow({ year: 2025, month: 1, revenue_eur: "10.00" })],
      });
    await expect(service.getInput("4")).rejects.toEqual(
      expect.objectContaining({
        message: REVENUE_INSUFFICIENT,
      }),
    );
  });

  it("snapshots the caller's input as queued and completes the run in the background", async () => {
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "15", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: "15",
              status: "running",
              input: runInput(snapshotRegion()),
              brain: brainResult,
              pattern: { ...pattern, yearlySeries: [] },
              created_at: new Date("2026-04-02T00:00:00.000Z"),
              started_at: new Date("2026-04-02T00:00:01.000Z"),
              completed_at: new Date("2026-04-02T00:00:02.000Z"),
              failure_reason: null,
            },
          ],
        };
      }
      return { rows: [{ started_at: new Date("2026-04-02T00:00:01.000Z"), completed_at: new Date("2026-04-02T00:00:02.000Z") }] };
    });

    const run = await service.createRun("4");
    expect(run.id).toBe("15");
    expect(run.status).toBe("queued");
    expect(run.startedAt).toBeNull();
    expect(run.completedAt).toBeNull();
    expect(run.failureReason).toBeNull();
    expect(run.input.revenueDirection).toBe("up");
    expect(run.input.regions).toEqual([
      expect.objectContaining({
        label: "München",
        geoKey: "09162000",
        grain: "ags",
        level: "gemeinde",
        parentLabel: null,
      }),
    ]);
    expect(catalogSearch).toHaveBeenCalledWith({ geoKey: "09162000" });
    expect(run.input.stores[0]?.changes).toEqual([
      expect.objectContaining({ changeEur: 30.5 }),
    ]);
    expect(query.mock.calls[2]?.[0]).toEqual(expect.stringContaining("INSERT INTO app.analysis_runs"));
    expect(query.mock.calls[2]?.[0]).toEqual(expect.stringContaining("'queued'"));
    expect(query.mock.calls[2]?.[1]?.[0]).toBe("4");

    await service.whenIdle();
    expect(search).toHaveBeenCalled();
    expect(derive).toHaveBeenCalled();
    expect(buildSeries).toHaveBeenCalled();
    expect(createRecommendations).toHaveBeenCalledWith(
      "4",
      "15",
      expect.any(Date),
      expect.objectContaining({ persist: false, analysisPool: true, signal: expect.any(AbortSignal) }),
    );
    expect(query.mock.calls.some((call) => String(call[0]).includes("'running'"))).toBe(true);
    expect(query.mock.calls.some((call) => String(call[0]).includes("'completed'"))).toBe(true);
  });

  it("rejects more than 200 Zielregionen before enqueueing a run", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({
      ...regionRow(),
      label: `R${index}`,
      geo_key: `r:${index}`,
    }));
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      return { rows: [] };
    });
    await expect(service.createRun("4")).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createRun("4")).rejects.toMatchObject({ message: TOO_MANY_TARGET_REGIONS });
    expect(query.mock.calls.some((call) => String(call[0]).includes("INSERT INTO app.analysis_runs"))).toBe(false);
    expect(createRecommendations).not.toHaveBeenCalled();
  });

  it("uses markedTargetRegionGeoKey as input.region and keeps the full list in regions", async () => {
    const lichterfelde = {
      ...regionRow(),
      label: "Lichterfelde",
      geo_key: "ortsteil:osm:55737",
      grain: "other",
    };
    const tempelhof = {
      ...regionRow(),
      label: "Tempelhof",
      geo_key: "ortsteil:osm:162894",
      grain: "other",
    };
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [lichterfelde, tempelhof] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        const input = JSON.parse(String(params?.[1]));
        expect(input.region.geoKey).toBe("ortsteil:osm:162894");
        expect(input.region.label).toBe("Tempelhof");
        expect(input.regions.map((item: { geoKey: string }) => item.geoKey)).toEqual([
          "ortsteil:osm:55737",
          "ortsteil:osm:162894",
        ]);
        return { rows: [{ id: "54", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const run = await service.createRun("2", "ortsteil:osm:162894");
    expect(run.id).toBe("54");
    expect(run.input.region.geoKey).toBe("ortsteil:osm:162894");
    expect(run.input.regions?.map((item) => item.geoKey)).toEqual([
      "ortsteil:osm:55737",
      "ortsteil:osm:162894",
    ]);
    await service.whenIdle();
  });

  it("answers 404 with code marked_target_region_not_found for a foreign geoKey", async () => {
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      return { rows: [] };
    });
    await expect(service.createRun("4", "ortsteil:osm:999")).rejects.toMatchObject({
      response: {
        statusCode: 404,
        message: MARKED_TARGET_REGION_NOT_FOUND,
        code: MARKED_TARGET_REGION_NOT_FOUND_CODE,
      },
    });
  });

  it("marks the run failed when ranking the recommendation set throws", async () => {
    createRecommendations.mockRejectedValue(
      Object.assign(new Error('bind message supplies 4 parameters, but prepared statement "" requires 3'), {
        code: "08P01",
      }),
    );
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "15", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: "15",
              status: "running",
              input: runInput(snapshotRegion()),
              brain: brainResult,
              pattern,
              created_at: new Date("2026-04-02T00:00:00.000Z"),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const queued = await service.createRun("4");
    expect(queued.status).toBe("queued");
    await service.whenIdle();
    expect(createRecommendations).toHaveBeenCalledWith(
      "4",
      "15",
      expect.any(Date),
      expect.objectContaining({ persist: false, analysisPool: true, signal: expect.any(AbortSignal) }),
    );
    const failed = query.mock.calls.find((call) => String(call[0]).includes("'failed'"));
    expect(failed?.[0]).toEqual(expect.stringContaining("'failed'"));
    expect(failed?.[1]?.[2]).toBe("set_save_failed");
    expect(query.mock.calls.some((call) => String(call[0]).includes("'completed'"))).toBe(false);
  });

  it("marks the run failed when Brain work throws without failing POST", async () => {
    search.mockRejectedValue(new Error("embeddings exploded"));
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "16", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: "16",
              status: "running",
              input: runInput(snapshotRegion()),
              brain: brainResult,
              pattern,
              created_at: new Date("2026-04-02T00:00:00.000Z"),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const queued = await service.createRun("4");
    expect(queued.status).toBe("queued");
    await service.whenIdle();
    const failed = query.mock.calls.find((call) => String(call[0]).includes("'failed'"));
    expect(failed?.[0]).toEqual(expect.stringContaining("'failed'"));
    expect(failed?.[1]?.[2]).toBe("pattern_failed");
  });

  it("returns stored yearlySeries on GET and does not rebuild when the field is present", async () => {
    const stored = [{ metricId: "bevoelkerung", coverage: "single" }];
    const muenchen = snapshotRegion();
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "15",
          status: "completed",
          input: runInput(muenchen),
          brain: brainResult,
          pattern: { ...pattern, yearlySeries: stored },
          created_at: new Date("2026-04-02T00:00:00.000Z"),
        },
      ],
    });
    await expect(service.latestPattern("4")).resolves.toEqual({
      runId: "15",
      createdAt: "2026-04-02T00:00:00.000Z",
      region: {
        label: "München",
        geoKey: "09162000",
        level: "gemeinde",
        parentLabel: null,
        grain: "ags",
      },
      pattern: { ...pattern, yearlySeries: stored },
    });
    expect(buildSeries).not.toHaveBeenCalled();
  });

  it("returns queued and failed status from the stored row", async () => {
    const muenchen = snapshotRegion();
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "16",
          status: "queued",
          input: runInput(muenchen),
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-02T00:00:00.000Z"),
          started_at: null,
          completed_at: null,
          failure_reason: null,
        },
      ],
    });
    await expect(service.getRun("4", "16")).resolves.toMatchObject({
      id: "16",
      status: "queued",
      startedAt: null,
      completedAt: null,
      failureReason: null,
    });
    expect(buildSeries).not.toHaveBeenCalled();

    query.mockResolvedValueOnce({
      rows: [
        {
          id: "17",
          status: "failed",
          input: runInput(muenchen),
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-02T00:00:00.000Z"),
          started_at: new Date("2026-04-02T00:00:01.000Z"),
          completed_at: new Date("2026-04-02T00:00:02.000Z"),
          failure_reason: "timeout",
        },
      ],
    });
    await expect(service.getRun("4", "17")).resolves.toMatchObject({
      id: "17",
      status: "failed",
      startedAt: "2026-04-02T00:00:01.000Z",
      completedAt: "2026-04-02T00:00:02.000Z",
      failureReason: "timeout",
    });
  });

  it("does not return another user's run", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.getRun("4", "15")).rejects.toMatchObject({ message: RUN_NOT_FOUND });
    expect(query).toHaveBeenCalledWith(expect.any(String), ["15", "4"]);
  });

  it("reads the latest pattern for the token user only", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.latestPattern("4")).rejects.toMatchObject({
      message: PATTERN_NOT_FOUND,
    });

    query.mockResolvedValueOnce({
      rows: [
        {
          id: "15",
          status: "completed",
          input: runInput(snapshotRegion()),
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-02T00:00:00.000Z"),
        },
      ],
    });
    await expect(service.latestPattern("4")).resolves.toEqual({
      runId: "15",
      createdAt: "2026-04-02T00:00:00.000Z",
      region: {
        label: "München",
        geoKey: "09162000",
        level: "gemeinde",
        parentLabel: null,
        grain: "ags",
      },
      pattern: { ...pattern, yearlySeries: [] },
    });
    expect(query.mock.calls.at(-1)?.[0]).not.toEqual(expect.stringContaining("jsonb_array_elements"));
    expect(query.mock.calls.at(-1)?.[1]).toEqual(["4"]);
  });

  it("returns the newest run whose snapshot includes the requested geoKey", async () => {
    const muenchen = snapshotRegion();
    const mitte = snapshotRegion({
      label: "Mitte",
      geoKey: "11000001",
      ags: "11000001",
      level: "bezirk",
      parentLabel: "Berlin",
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "10",
          status: "completed",
          input: runInput(muenchen),
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-01T00:00:00.000Z"),
        },
      ],
    });
    const filtered = await service.latestPattern("4", "09162000");
    expect(filtered.runId).toBe("10");
    expect(filtered.region).toMatchObject({ label: "München", geoKey: "09162000" });
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining("jsonb_array_elements"));
    expect(query.mock.calls[0]?.[1]?.[0]).toBe("4");
    expect(query.mock.calls[0]?.[1]?.[1]).toEqual(expect.arrayContaining(["09162000", "ags:09162000"]));

    query.mockResolvedValueOnce({
      rows: [
        {
          id: "11",
          status: "completed",
          input: runInput(mitte),
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-02T00:00:00.000Z"),
        },
      ],
    });
    const other = await service.latestPattern("4", "11000001");
    expect(other.runId).toBe("11");
    expect(other.region).toMatchObject({ label: "Mitte", geoKey: "11000001" });
  });

  it("answers 404 for a geoKey with no matching run instead of another region's pattern", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.latestPattern("4", "11000001")).rejects.toMatchObject({
      message: PATTERN_FOR_REGION_NOT_FOUND,
    });
    await expect(service.latestPattern("4", "11000001")).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0]?.[1]?.[1]).toEqual(expect.arrayContaining(["11000001"]));
    expect(query.mock.calls[0]?.[1]?.[1]).not.toEqual(expect.arrayContaining(["09162000"]));
  });

  it("matches a Berlin Bezirk alias onto the official AGS stored on the snapshot", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "12",
          status: "completed",
          input: runInput(
            snapshotRegion({
              label: "Steglitz-Zehlendorf",
              geoKey: "11000006",
              ags: "11000006",
              level: "bezirk",
              parentLabel: "Berlin",
            }),
          ),
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-02T00:00:00.000Z"),
        },
      ],
    });
    const result = await service.latestPattern("4", "11006006");
    expect(result.runId).toBe("12");
    expect(result.region.geoKey).toBe("11000006");
    expect(query.mock.calls[0]?.[1]?.[1]).toEqual(expect.arrayContaining(["11006006", "11000006"]));
  });

  it("filters yearlySeries to the requested Zielregion when geoKey is set", async () => {
    const muenchen = snapshotRegion();
    const mitte = snapshotRegion({
      label: "Mitte",
      geoKey: "11000001",
      ags: "11000001",
      level: "bezirk",
      parentLabel: "Berlin",
    });
    buildSeries.mockResolvedValue([
      seriesRow("09162000"),
      seriesRow("11000001"),
    ]);
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "15",
          status: "completed",
          input: runInput(muenchen, [muenchen, mitte]),
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-02T00:00:00.000Z"),
        },
      ],
    });
    const result = await service.latestPattern("4", "09162000");
    expect(result.pattern.yearlySeries).toEqual([seriesRow("09162000")]);
    expect(result.pattern.criteria).toEqual([]);
    expect(buildSeries).toHaveBeenCalledWith(
      [expect.objectContaining({ geoKey: "09162000" })],
      expect.any(Date),
      undefined,
    );
    expect(buildSeries.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("fills catalog display on an old target-region row for analysis", async () => {
    catalogSearch.mockResolvedValue([{ label: "80331", level: "plz", parentLabel: "München" }]);
    query
      .mockResolvedValueOnce({
        rows: [
          {
            label: "80331",
            grain: "plz5",
            geo_key: "80331",
            level: null,
            parent_label: null,
            ags: null,
            plz: "80331",
            lon: 11.58,
            lat: 48.14,
            updated_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
          storeRow({ year: 2025, month: 2, revenue_eur: "110.00" }),
        ],
      });
    const input = await service.getInput("4");
    expect(input.region).toMatchObject({
      label: "80331",
      level: "plz",
      parentLabel: "München",
    });
    expect(catalogSearch).toHaveBeenCalledWith({ geoKey: "80331" });
  });

  it("marks stale queued and running rows interrupted on startup", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "9" }, { id: "10" }] });
    await service.onModuleInit();
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining("interrupted"));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining("'queued'"));
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining("'running'"));
  });

  it("answers GET while a large run is in flight", async () => {
    let resolveSearch!: (value: AnalysisBrain) => void;
    const searchPending = new Promise<AnalysisBrain>((resolve) => {
      resolveSearch = resolve;
    });
    search.mockImplementation(() => searchPending);
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "40", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: "40",
              status: "running",
              input: runInput(snapshotRegion()),
              brain: brainResult,
              pattern,
              created_at: new Date("2026-04-02T00:00:00.000Z"),
              started_at: new Date("2026-04-02T00:00:01.000Z"),
              completed_at: null,
              failure_reason: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const queued = await service.createRun("4");
    expect(queued.status).toBe("queued");
    await expect(service.getRun("4", "40")).resolves.toMatchObject({ status: "running", id: "40" });
    resolveSearch(brainResult);
    await service.whenIdle();
  });

  it("marks the run failed with timeout when the overall deadline elapses", async () => {
    const previous = process.env.ANALYSIS_RUN_DEADLINE_MS;
    process.env.ANALYSIS_RUN_DEADLINE_MS = "30";
    const timed = new AnalysisService(
      { query } as unknown as DatabaseService,
      { search } as unknown as BrainSearchService,
      { derive } as unknown as PatternService,
      { search: catalogSearch, lookupAdminNames: async () => new Map() } as unknown as GeoCatalogService,
      { build: buildSeries } as unknown as YearlySeriesService,
      { create: createRecommendations } as unknown as RecommendationsService,
    );
    search.mockImplementation(() => new Promise(() => undefined));
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "41", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: "41",
              status: "running",
              input: runInput(snapshotRegion()),
              brain: brainResult,
              pattern,
              created_at: new Date("2026-04-02T00:00:00.000Z"),
            },
          ],
        };
      }
      return { rows: [] };
    });
    try {
      const queued = await timed.createRun("4");
      expect(queued.status).toBe("queued");
      await timed.whenIdle();
      const failed = query.mock.calls.find((call) => String(call[0]).includes("'failed'"));
      expect(failed?.[1]?.[2]).toBe("timeout");
      expect(createRecommendations).not.toHaveBeenCalled();
      expect(query.mock.calls.some((call) => String(call[0]).includes("recommendation_sets"))).toBe(false);
    } finally {
      await timed.whenIdle();
      if (previous === undefined) delete process.env.ANALYSIS_RUN_DEADLINE_MS;
      else process.env.ANALYSIS_RUN_DEADLINE_MS = previous;
    }
  });

  it("aborts an in-flight recommendation phase and never stores a set", async () => {
    const previous = process.env.ANALYSIS_RUN_DEADLINE_MS;
    process.env.ANALYSIS_RUN_DEADLINE_MS = "40";
    const afterDeadline = jest.fn();
    const timed = new AnalysisService(
      { query } as unknown as DatabaseService,
      { search } as unknown as BrainSearchService,
      { derive } as unknown as PatternService,
      { search: catalogSearch, lookupAdminNames: async () => new Map() } as unknown as GeoCatalogService,
      { build: buildSeries } as unknown as YearlySeriesService,
      { create: createRecommendations } as unknown as RecommendationsService,
    );
    createRecommendations.mockImplementation(async (_userId: string, _runId: string, _asOf: Date, options?: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 10_000);
        options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      });
      afterDeadline();
      return { id: "should-not-insert" };
    });
    query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "42", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs")) {
        return {
          rows: [
            {
              id: "42",
              status: "running",
              input: runInput(snapshotRegion()),
              brain: brainResult,
              pattern,
              created_at: new Date("2026-04-02T00:00:00.000Z"),
            },
          ],
        };
      }
      return { rows: [] };
    });
    try {
      await timed.createRun("4");
      await timed.whenIdle();
      const failed = query.mock.calls.find((call) => String(call[0]).includes("'failed'"));
      expect(failed?.[1]?.[2]).toBe("timeout");
      expect(afterDeadline).not.toHaveBeenCalled();
      expect(query.mock.calls.some((call) => String(call[0]).includes("INSERT INTO app.recommendation_sets"))).toBe(
        false,
      );
    } finally {
      await timed.whenIdle();
      if (previous === undefined) delete process.env.ANALYSIS_RUN_DEADLINE_MS;
      else process.env.ANALYSIS_RUN_DEADLINE_MS = previous;
    }
  });

  it("uses the analysis pool for worker writes and leaves the HTTP query mock for snapshots", async () => {
    const httpQuery = jest.fn();
    const analysisQuery = jest.fn();
    const isolated = new AnalysisService(
      {
        query: httpQuery,
        queryAnalysis: analysisQuery,
        withAnalysisTransaction: async (fn: (q: typeof analysisQuery) => Promise<unknown>) => fn(analysisQuery),
      } as unknown as DatabaseService,
      { search } as unknown as BrainSearchService,
      { derive } as unknown as PatternService,
      { search: catalogSearch, lookupAdminNames: async () => new Map() } as unknown as GeoCatalogService,
      { build: buildSeries } as unknown as YearlySeriesService,
      { create: createRecommendations } as unknown as RecommendationsService,
    );
    const handleSql = async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM app.target_regions")) return { rows: [regionRow()] };
      if (text.includes("FROM app.store_locations")) {
        return {
          rows: [
            storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
            storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
          ],
        };
      }
      if (text.includes("INSERT INTO app.analysis_runs")) {
        return { rows: [{ id: "50", created_at: new Date("2026-04-02T00:00:00.000Z") }] };
      }
      if (text.includes("FROM app.analysis_runs") || text.includes("INSERT INTO app.recommendation_sets")) {
        return {
          rows: [
            {
              id: "50",
              status: "running",
              input: runInput(snapshotRegion()),
              brain: brainResult,
              pattern,
              created_at: new Date("2026-04-02T00:00:00.000Z"),
              started_at: new Date("2026-04-02T00:00:01.000Z"),
              completed_at: new Date("2026-04-02T00:00:02.000Z"),
            },
          ],
        };
      }
      return { rows: [{ started_at: new Date(), completed_at: new Date() }] };
    };
    httpQuery.mockImplementation(handleSql);
    analysisQuery.mockImplementation(handleSql);
    try {
      await isolated.createRun("4");
      await isolated.whenIdle();
      expect(httpQuery.mock.calls.some((call) => String(call[0]).includes("'queued'"))).toBe(true);
      expect(analysisQuery.mock.calls.some((call) => String(call[0]).includes("'running'"))).toBe(true);
      expect(analysisQuery.mock.calls.some((call) => String(call[0]).includes("'completed'"))).toBe(true);
      expect(httpQuery.mock.calls.some((call) => String(call[0]).includes("'running'"))).toBe(false);
      expect(httpQuery.mock.calls.some((call) => String(call[0]).includes("'completed'"))).toBe(false);
    } finally {
      await isolated.whenIdle();
    }
  });
});

function regionRow() {
  return {
    label: "München",
    grain: "ags",
    geo_key: "09162000",
    ags: "09162000",
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

function snapshotRegion(overrides: Partial<AnalysisRegion> = {}): AnalysisRegion {
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
    ...overrides,
  };
}

function runInput(region: AnalysisRegion, regions: AnalysisRegion[] = [region]): AnalysisInput {
  return {
    region,
    regions,
    stores: [],
    revenueDirection: "up",
    capturedAt: "2026-10-05T00:00:00.000Z",
  };
}

function seriesRow(requestedGeoKey: string): YearlySeries {
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
