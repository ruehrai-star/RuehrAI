import { NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { AnalysisService } from "./analysis.service";
import { BrainSearchService } from "./brain-search.service";
import { PATTERN_NOT_FOUND, REGION_MISSING, REVENUE_INSUFFICIENT, RUN_NOT_FOUND } from "./messages";
import { PatternService } from "./pattern.service";
import { AnalysisBrain, AnalysisPattern } from "./types";

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
  let service: AnalysisService;

  beforeEach(() => {
    query.mockReset();
    search.mockReset();
    catalogSearch.mockReset();
    derive.mockReset();
    search.mockResolvedValue(brainResult);
    catalogSearch.mockResolvedValue([]);
    derive.mockResolvedValue(pattern);
    service = new AnalysisService(
      { query } as unknown as DatabaseService,
      { search } as unknown as BrainSearchService,
      { derive } as unknown as PatternService,
      { search: catalogSearch } as unknown as GeoCatalogService,
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
        level: null,
        parentLabel: null,
      }),
    ]);
    expect(catalogSearch).toHaveBeenCalledWith({ geoKey: "09162000" });
    expect(run.input.stores[0]?.changes).toEqual([
      expect.objectContaining({ changeEur: 30.5 }),
    ]);
    expect(search).toHaveBeenCalledWith(run.input);
    expect(derive).toHaveBeenCalledWith(run.input, []);
    expect(query.mock.calls[2]?.[0]).toEqual(expect.stringContaining("INSERT INTO app.analysis_runs"));
    expect(query.mock.calls[2]?.[1]?.[0]).toBe("4");
    expect(run.pattern).toEqual(pattern);
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
          input: {},
          brain: brainResult,
          pattern,
          created_at: new Date("2026-04-02T00:00:00.000Z"),
        },
      ],
    });
    await expect(service.latestPattern("4")).resolves.toEqual({
      runId: "15",
      createdAt: "2026-04-02T00:00:00.000Z",
      pattern,
    });
    expect(query.mock.calls.at(-1)?.[1]).toEqual(["4"]);
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
