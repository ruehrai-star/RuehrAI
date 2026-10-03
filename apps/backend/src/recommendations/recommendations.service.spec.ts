import { NotFoundException } from "@nestjs/common";
import { PATTERN_NOT_FOUND, RUN_NOT_FOUND } from "../analysis/messages";
import { AnalysisInput, AnalysisPattern } from "../analysis/types";
import { DatabaseService } from "../database/database.service";
import { CandidateSearchService } from "./candidate-search.service";
import { RECOMMENDATIONS_NOT_FOUND } from "./messages";
import { RecommendationsService } from "./recommendations.service";
import { RationaleService } from "./rationale.service";
import { CandidateRow } from "./types";

const asOf = new Date("2026-09-29T12:00:00.000Z");

const pattern: AnalysisPattern = {
  source: "heuristic",
  summary: "Einwohner steigen mit dem Umsatz.",
  revenueDirection: "up",
  criteria: [{ key: "einwohner", label: "einwohner", direction: "up", evidence: "steigt" }],
};

function input(): AnalysisInput {
  return {
    region: {
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
      plz: null,
      lon: null,
      lat: null,
      bounds: null,
      geometry: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    stores: [],
    revenueDirection: "up",
    capturedAt: "2026-09-01T00:00:00.000Z",
  };
}

function place(geoKey: string, title: string, early: number, late: number): CandidateRow[] {
  return [
    {
      id: "1",
      geoKey,
      grain: "plz5",
      name: title,
      title,
      refPeriod: "2026-04",
      metadata: { einwohner: early },
      lon: 11.5,
      lat: 48.1,
    },
    {
      id: "2",
      geoKey,
      grain: "plz5",
      name: title,
      title,
      refPeriod: "2026-09",
      metadata: { einwohner: late },
      lon: 11.5,
      lat: 48.1,
    },
  ];
}

describe("RecommendationsService", () => {
  const query = jest.fn();
  const load = jest.fn();
  const write = jest.fn();
  const service = new RecommendationsService(
    { query } as unknown as DatabaseService,
    { load, loadMany: load } as unknown as CandidateSearchService,
    { write } as unknown as RationaleService,
  );

  beforeEach(() => {
    query.mockReset();
    load.mockReset();
    write.mockReset();
    write.mockImplementation(async (_pattern: AnalysisPattern, _window: unknown, items: unknown[]) =>
      (items as { id: string }[]).map((item) => ({
        ...item,
        rationale: `Heuristik ${item.id}`,
        source: "heuristic",
      })),
    );
  });

  it("answers 404 when the user has no completed pattern", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.create("4", undefined, asOf)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create("4", undefined, asOf)).rejects.toMatchObject({
      message: PATTERN_NOT_FOUND,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("answers 404 when the requested run belongs to someone else", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.create("4", "9", asOf)).rejects.toMatchObject({
      message: RUN_NOT_FOUND,
    });
  });

  it("persists the top three and a null reason when the region is full", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "15", input: input(), pattern }] })
      .mockResolvedValueOnce({
        rows: [{ id: "3", created_at: new Date("2026-09-29T12:00:00.000Z") }],
      });
    load.mockResolvedValue({
      rows: [
        ...place("80801", "Schwabing", 10, 20),
        ...place("81369", "Sendling", 10, 30),
        ...place("81541", "Giesing", 10, 12),
        ...place("80686", "Laim", 20, 10),
      ],
      truncated: false,
    });

    const set = await service.create("4", undefined, asOf);
    expect(set.id).toBe("3");
    expect(set.runId).toBe("15");
    expect(set.count).toBe(3);
    expect(set.reason).toBeNull();
    expect(set.window).toEqual({ from: "2026-04", to: "2026-09" });
    expect(set.items.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(set.items.map((item) => item.title)).toEqual(["Giesing", "Schwabing", "Sendling"]);
    expect(set.items.every((item) => item.source === "heuristic")).toBe(true);
    expect(set.items.map((item) => item.id)).not.toContain("plz5:80686");

    const insert = query.mock.calls[1] as [string, unknown[]];
    expect(insert[0]).toContain("INSERT INTO app.recommendation_sets");
    expect(insert[1]?.[0]).toBe("4");
    expect(insert[1]?.[1]).toBe("15");
    expect(load.mock.calls[0]?.[1]).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("stores a German reason when only one location fits", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "15", input: input(), pattern }] })
      .mockResolvedValueOnce({
        rows: [{ id: "4", created_at: "2026-09-29T12:00:00.000Z" }],
      });
    load.mockResolvedValue({ rows: place("80801", "Schwabing", 10, 20), truncated: false });

    const set = await service.create("4", "15", asOf);
    expect(set.count).toBe(1);
    expect(set.reason).toContain("nur 1 Standort");
    expect(set.items[0]?.rank).toBe(1);
  });

  it("reads only the caller's latest set", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.latest("4")).rejects.toMatchObject({
      message: RECOMMENDATIONS_NOT_FOUND,
    });

    query.mockResolvedValue({
      rows: [
        {
          id: "8",
          created_at: "2026-09-29T12:00:00.000Z",
          payload: {
            runId: "15",
            window: { from: "2026-04", to: "2026-09" },
            count: 0,
            reason: "Keine passenden Standorte in der Zielregion.",
            pattern,
            items: [],
          },
        },
      ],
    });
    const latest = await service.latest("4");
    expect(latest.id).toBe("8");
    expect(latest.count).toBe(0);
    expect(String(query.mock.calls.at(-1)?.[0])).toContain("user_id = $1::bigint");
  });
});
