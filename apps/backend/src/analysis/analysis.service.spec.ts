import { Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { AnalysisService } from "./analysis.service";
import { BrainSearchService } from "./brain-search.service";
import { PATTERN_FOR_REGION_NOT_FOUND, PATTERN_NOT_FOUND, REGION_MISSING, REVENUE_INSUFFICIENT, RUN_NOT_FOUND } from "./messages";
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

  it("snapshots the caller's input and stores the pattern on a run", async () => {
    query
      .mockResolvedValueOnce({ rows: [regionRow()] })
      .mockResolvedValueOnce({
        rows: [
          storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
          storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "15", created_at: new Date("2026-04-02T00:00:00.000Z") }],
      });

    const run = await service.createRun("4");
    expect(run.id).toBe("15");
    expect(run.status).toBe("completed");
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
    expect(search).toHaveBeenCalledWith(run.input);
    expect(derive).toHaveBeenCalledWith(run.input, []);
    expect(buildSeries).toHaveBeenCalledWith(run.input.regions, expect.any(Date));
    expect(query.mock.calls[2]?.[0]).toEqual(expect.stringContaining("INSERT INTO app.analysis_runs"));
    expect(query.mock.calls[2]?.[1]?.[0]).toBe("4");
    expect(run.pattern).toEqual({ ...pattern, yearlySeries: [] });
    expect(createRecommendations).toHaveBeenCalledWith("4", "15");
  });

  it("still returns the run when ranking the recommendation set fails", async () => {
    const log = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    createRecommendations.mockRejectedValue(
      Object.assign(new Error('bind message supplies 4 parameters, but prepared statement "" requires 3'), {
        code: "08P01",
      }),
    );
    query
      .mockResolvedValueOnce({ rows: [regionRow()] })
      .mockResolvedValueOnce({
        rows: [
          storeRow({ year: 2025, month: 1, revenue_eur: "100.00" }),
          storeRow({ year: 2025, month: 2, revenue_eur: "130.50" }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "15", created_at: new Date("2026-04-02T00:00:00.000Z") }],
      });

    const run = await service.createRun("4");
    expect(run.id).toBe("15");
    expect(run.status).toBe("completed");
    expect(createRecommendations).toHaveBeenCalledWith("4", "15");
    expect(String(log.mock.calls[0]?.[0])).toContain("Recommendation set for run 15 was not stored");
    expect(String(log.mock.calls[0]?.[0])).toContain("requires 3");
    log.mockRestore();
  });

  it("recomputes yearlySeries on GET even when the stored pattern already has the field", async () => {
    const stored = [{ metricId: "bevoelkerung", coverage: "single" }];
    const muenchen = snapshotRegion();
    buildSeries.mockResolvedValue([{ metricId: "bevoelkerung", coverage: "multi" }]);
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
      pattern: { ...pattern, yearlySeries: [{ metricId: "bevoelkerung", coverage: "multi" }] },
    });
    expect(buildSeries).toHaveBeenCalled();
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
    expect(buildSeries).toHaveBeenCalledWith([expect.objectContaining({ geoKey: "09162000" })], expect.any(Date));
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
