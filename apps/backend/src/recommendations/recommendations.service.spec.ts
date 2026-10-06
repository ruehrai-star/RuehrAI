import { NotFoundException } from "@nestjs/common";
import { PATTERN_NOT_FOUND, RUN_NOT_FOUND } from "../analysis/messages";
import { AnalysisInput, AnalysisPattern } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import { StoreSurroundingsService } from "../analysis/store-surroundings.service";
import { YearlySeriesService } from "../analysis/yearly-series.service";
import { DatabaseService } from "../database/database.service";
import { AreaCandidate } from "./area-candidates";
import { AreaCandidateService } from "./area-candidate.service";
import { RECOMMENDATIONS_NOT_FOUND } from "./messages";
import { RecommendationsService } from "./recommendations.service";
import { RationaleService } from "./rationale.service";

const asOf = new Date("2026-09-29T12:00:00.000Z");

const pattern: AnalysisPattern = {
  source: "heuristic",
  summary: "Unfälle fallen mit dem Umsatz.",
  revenueDirection: "up",
  criteria: [{ key: "unfallatlas", label: "Unfälle", direction: "down", evidence: "fällt", kind: "trend" }],
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
    stores: [
      {
        id: "7",
        label: null,
        street: "Marienplatz 1",
        postalCode: "80331",
        city: "München",
        lon: null,
        lat: null,
        points: [],
        changes: [],
      },
    ],
    revenueDirection: "up",
    capturedAt: "2026-09-01T00:00:00.000Z",
  };
}

function area(geoKey: string, title: string, kind: AreaCandidate["kind"] = "ortsteil"): AreaCandidate {
  return {
    id: `other:${geoKey}`,
    geoKey,
    grain: "other",
    kind,
    title,
    name: title,
    ags: "09162000",
    plz: null,
    lon: 11.5,
    lat: 48.1,
  };
}

function trend(
  requestedGeoKey: string,
  first: number,
  last: number,
  requestedLevel: YearlySeries["requestedLevel"] = "ortsteil",
): YearlySeries {
  return {
    metricId: "unfallatlas",
    requestedLevel,
    requestedGeoKey,
    sourceLevel: requestedLevel,
    sourceGeoKey: requestedGeoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: first },
      { period: "2024", status: "present", value: (first + last) / 2 },
      { period: "2025", status: "present", value: last },
    ],
  };
}

function inhabitants(
  requestedGeoKey: string,
  requestedLevel: YearlySeries["requestedLevel"] = "ortsteil",
  value = 10_000,
): YearlySeries {
  return {
    metricId: "bevoelkerung",
    requestedLevel,
    requestedGeoKey,
    sourceLevel: requestedLevel,
    sourceGeoKey: requestedGeoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value },
      { period: "2024", status: "present", value },
      { period: "2025", status: "present", value },
    ],
  };
}

describe("RecommendationsService", () => {
  const query = jest.fn();
  const load = jest.fn();
  const resolve = jest.fn();
  const build = jest.fn();
  const write = jest.fn();
  const service = new RecommendationsService(
    { query } as unknown as DatabaseService,
    { load } as unknown as AreaCandidateService,
    { resolve } as unknown as StoreSurroundingsService,
    { build } as unknown as YearlySeriesService,
    { write } as unknown as RationaleService,
  );

  beforeEach(() => {
    query.mockReset();
    load.mockReset();
    resolve.mockReset();
    build.mockReset();
    write.mockReset();
    resolve.mockResolvedValue({
      regions: [
        { grain: "other", geoKey: "ortsteil:osm:store", level: "ortsteil" },
        { grain: "plz5", geoKey: "80331", plz: "80331", level: "plz" },
      ],
      keys: ["ortsteil:osm:store", "80331"],
    });
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
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining("IN ('running', 'completed')"));
  });

  it("persists ranked Teilflächen and never includes the region anchor", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "15", input: input(), pattern }] })
      .mockResolvedValueOnce({
        rows: [{ id: "3", created_at: new Date("2026-09-29T12:00:00.000Z") }],
      });
    load.mockResolvedValue({
      items: [
        area("ortsteil:osm:1", "Schwabing"),
        area("ortsteil:osm:2", "Sendling"),
        area("ortsteil:osm:3", "Giesing"),
      ],
      truncated: false,
    });
    build
      .mockResolvedValueOnce([
        trend("ortsteil:osm:store", 20, 8, "ortsteil"),
        inhabitants("ortsteil:osm:store", "ortsteil"),
        trend("80331", 20, 8, "plz"),
        inhabitants("80331", "plz"),
      ])
      .mockResolvedValueOnce([
        trend("ortsteil:osm:1", 20, 8),
        inhabitants("ortsteil:osm:1"),
        trend("ortsteil:osm:2", 18, 9),
        inhabitants("ortsteil:osm:2"),
        trend("ortsteil:osm:3", 10, 30),
        inhabitants("ortsteil:osm:3"),
      ]);

    const set = await service.create("4", undefined, asOf);
    expect(set.id).toBe("3");
    expect(set.runId).toBe("15");
    expect(set.count).toBe(3);
    expect(set.reason).toBeNull();
    expect(set.window).toEqual({ from: "2023", to: "2025" });
    expect(set.items.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(set.items.map((item) => item.title)).toEqual(["Schwabing", "Sendling", "Giesing"]);
    expect(set.items[0]).toMatchObject({
      grain: "other",
      name: "Schwabing",
      parentLabel: "München",
    });
    expect(set.items[0]?.intersectionOf).toBeUndefined();
    expect(set.items.map((item) => item.location.geoKey)).not.toContain("09162000");
    expect(set.pattern.criteria[0]?.kind).toBe("trend");
    expect(set.patternByLevel?.map((item) => item.level)).toEqual(["ortsteil", "plz"]);
    expect(set.patternByLevel?.find((item) => item.level === "ortsteil")?.criteria[0]?.scope).toBe("local");
    expect(set.patternByLevel?.find((item) => item.level === "plz")?.geoKeys).toEqual(["80331"]);
    expect(set.patternByDataset?.[0]).toMatchObject({
      metricId: "unfallatlas",
      baseline: "per_1000_inhabitants",
      sourceLevel: "ortsteil",
    });
    expect(set.pattern.criteria[0]?.baseline).toBe("per_1000_inhabitants");
    expect(set.pattern.criteria[0]?.normalizedValue).toBe(0.8);

    const insert = query.mock.calls[1] as [string, unknown[]];
    expect(insert[0]).toContain("INSERT INTO app.recommendation_sets");
    expect(resolve).toHaveBeenCalled();
    expect(load.mock.calls[0]?.[0]?.[0]?.geoKey).toBe("09162000");
  });

  it("scores Ortsteil candidates against a PLZ-store dataset on normalized values", async () => {
    resolve.mockResolvedValue({
      regions: [{ grain: "plz5", geoKey: "80331", plz: "80331", level: "plz" }],
      keys: ["80331"],
    });
    query
      .mockResolvedValueOnce({ rows: [{ id: "15", input: input(), pattern }] })
      .mockResolvedValueOnce({
        rows: [{ id: "5", created_at: new Date("2026-09-29T12:00:00.000Z") }],
      });
    load.mockResolvedValue({
      items: [area("ortsteil:osm:1", "Schwabing"), area("ortsteil:osm:2", "Sendling")],
      truncated: false,
    });
    build
      .mockResolvedValueOnce([trend("80331", 20, 8, "plz"), inhabitants("80331", "plz")])
      .mockResolvedValueOnce([
        trend("ortsteil:osm:1", 20, 8),
        inhabitants("ortsteil:osm:1"),
        trend("ortsteil:osm:2", 10, 30),
        inhabitants("ortsteil:osm:2"),
      ]);

    const set = await service.create("4", undefined, asOf);
    expect(set.patternByLevel?.map((item) => item.level)).toEqual(["plz"]);
    expect(set.patternByDataset?.[0]?.sourceLevel).toBe("plz");
    expect(set.items.map((item) => item.title)).toEqual(["Schwabing", "Sendling"]);
    expect(set.items[0]?.score).toBe(1);
    expect(set.items[1]?.score).toBe(0);
    expect(set.items[0]?.criteriaEvidence[0]?.baseline).toBe("per_1000_inhabitants");
    expect(set.items[0]?.criteriaEvidence[0]?.match).toBe(true);
    expect(set.items.every((item) => item.criteriaEvidence.length === 1)).toBe(true);
  });

  it("does not insert a recommendation set when persist is false", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "15", input: input(), pattern }] });
    load.mockResolvedValue({ items: [area("ortsteil:osm:1", "Schwabing")], truncated: false });
    build.mockResolvedValue([]);
    const set = await service.create("4", "15", asOf, { persist: false, analysisPool: true });
    expect(set.runId).toBe("15");
    expect(query.mock.calls.some((call) => String(call[0]).includes("INSERT INTO app.recommendation_sets"))).toBe(
      false,
    );
  });

  it("returns an empty list only when no sub-area exists", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "15", input: input(), pattern }] })
      .mockResolvedValueOnce({
        rows: [{ id: "4", created_at: "2026-09-29T12:00:00.000Z" }],
      });
    load.mockResolvedValue({ items: [], truncated: false });
    build.mockResolvedValue([]);

    const set = await service.create("4", "15", asOf);
    expect(set.count).toBe(0);
    expect(set.items).toEqual([]);
    expect(set.reason).toContain("keine feinere Teilfläche");
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
            window: { from: "2023", to: "2025" },
            count: 0,
            reason: "In der Zielregion liegt keine Teilfläche vor.",
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
    expect(String(query.mock.calls.at(-1)?.[0])).toContain("r.status = 'completed'");
    expect(String(query.mock.calls.at(-1)?.[0])).toContain("analysis_run_id IS NULL");
  });

  it("never returns a set bound to a failed run as latest", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.latest("2")).rejects.toMatchObject({
      message: RECOMMENDATIONS_NOT_FOUND,
    });
    const sql = String(query.mock.calls.at(-1)?.[0]);
    expect(sql).toContain("LEFT JOIN app.analysis_runs");
    expect(sql).toContain("r.status = 'completed'");
    expect(sql).not.toMatch(/status IN \('running',\s*'completed'\)/);
  });

  it("reads a stored set by runId and never ranks", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "28",
          created_at: "2026-10-06T07:44:00.000Z",
          payload: {
            runId: "31",
            window: { from: "2023", to: "2025" },
            count: 1,
            reason: null,
            pattern,
            items: [{ id: "other:ortsteil:osm:1", rank: 1, title: "Altstadt-Nord" }],
          },
        },
      ],
    });
    const stored = await service.latest("2", "31");
    expect(stored.id).toBe("28");
    expect(stored.runId).toBe("31");
    expect(String(query.mock.calls.at(-1)?.[0])).toContain("analysis_run_id = $2::bigint");
    expect(load).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing runId set without computing", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.latest("2", "31")).rejects.toMatchObject({
      message: RECOMMENDATIONS_NOT_FOUND,
    });
    expect(load).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
