import { QueryResult } from "pg";
import { PatternCriterion } from "../analysis/types";
import { YearlySeries } from "../analysis/yearly-series";
import { SqlQuery } from "../database/database.service";
import { AreaCandidate } from "./area-candidates";
import { NEAREST_LOR_PLR_SQL } from "../analysis/store-surroundings.service";
import {
  DEFAULT_LOO_USER_ID,
  ORTSTEIL_AT_POINT_SQL,
  assertReadOnlySql,
  loadLooFromDatabase,
  looError,
} from "./score-loo-stage";

const polygon = {
  type: "Polygon" as const,
  coordinates: [
    [
      [13.3, 52.4],
      [13.4, 52.4],
      [13.4, 52.5],
      [13.3, 52.5],
      [13.3, 52.4],
    ],
  ],
};

const criterion: PatternCriterion = {
  key: "unfallatlas",
  metricId: "unfallatlas",
  label: "Unfälle",
  direction: "down",
  evidence: "fällt",
  kind: "trend",
  baseline: "per_km2",
};

function asQuery(fn: (sql: string, params?: unknown[]) => Promise<unknown>): SqlQuery {
  return fn as SqlQuery;
}

function rows<T extends object>(items: T[]): QueryResult<T> {
  return { rows: items, command: "SELECT", rowCount: items.length, oid: 0, fields: [] };
}

function plrCandidate(geoKey: string, ortsteil: string): AreaCandidate {
  return {
    id: `other:${geoKey}@${ortsteil}`,
    geoKey,
    grain: "other",
    kind: "lor",
    title: geoKey,
    name: geoKey,
    ags: "11000000",
    plz: null,
    lon: 13.34,
    lat: 52.43,
    targetRegionGeoKey: ortsteil,
  };
}

function yearly(geoKey: string): YearlySeries {
  return {
    metricId: "unfallatlas",
    requestedLevel: "lor",
    requestedGeoKey: geoKey,
    sourceLevel: "lor",
    sourceGeoKey: geoKey,
    granularity: "year",
    coverage: "multi",
    valueKey: "unfaelle_je_km2",
    points: [
      { period: "2023", status: "present", value: 2.1 },
      { period: "2025", status: "present", value: 1.4 },
    ],
  };
}

describe("STAGE LOO loader", () => {
  it("loads stores, nearest PLR, live yearly series with valueKey, and Ortsteil PLR pool", async () => {
    const sqls: string[] = [];
    const yearlyRegions: Array<{ geoKey?: string | null; level?: string | null }>[] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      sqls.push(text);
      if (text.includes("FROM app.store_locations")) {
        expect(params[0]).toBe(DEFAULT_LOO_USER_ID);
        return rows([
          { id: "1", label: "Filiale 1", street: "A 1", postal_code: "12247", city: "Berlin", lon: 13.34, lat: 52.43 },
          { id: "2", label: "Filiale 2", street: "B 2", postal_code: "12169", city: "Berlin", lon: 13.35, lat: 52.45 },
          { id: "3", label: "Filiale 3", street: "C 3", postal_code: "12209", city: "Berlin", lon: 13.36, lat: 52.41 },
        ]);
      }
      if (text.includes("lor:plr:%") && text.includes("berlin_lor_ewr_bevoelkerung")) {
        const lat = Number(params[1]);
        const key = lat > 52.44 ? "lor:plr:06100206" : lat < 52.42 ? "lor:plr:06200422" : "lor:plr:06200313";
        return rows([{ geo_key: key, geo_ags: "11000000" }]);
      }
      if (text.includes("geo.geo_ref_ortsteil")) {
        const lat = Number(params[1]);
        const key = lat > 52.44 ? "ortsteil:osm:stadtpark" : "ortsteil:osm:lankwitz";
        return rows([
          {
            geo_key: key,
            geo_ags: "11000000",
            name: key.endsWith("stadtpark") ? "Steglitz" : "Lankwitz",
            geometry_geojson: JSON.stringify(polygon),
          },
        ]);
      }
      if (text.includes("FROM app.analysis_runs")) {
        expect(params[0]).toBe("2");
        expect(params[1]).toBeNull();
        return rows([
          {
            id: "62",
            input: { capturedAt: "2026-10-06T13:39:00.000Z" },
            pattern: { source: "heuristic", summary: "x", revenueDirection: "up", criteria: [criterion] },
          },
        ]);
      }
      if (text.includes("FROM app.recommendation_sets")) {
        return rows([]);
      }
      throw new Error(`unexpected sql: ${text.slice(0, 120)}`);
    });

    const fixture = await loadLooFromDatabase(
      {
        query: asQuery(query),
        yearlyBuild: async (regions) => {
          yearlyRegions.push(regions);
          return regions.map((region) => yearly(region.geoKey ?? ""));
        },
        loadAreas: async (regions) => {
          expect(regions.map((region) => region.geoKey).sort()).toEqual([
            "ortsteil:osm:lankwitz",
            "ortsteil:osm:stadtpark",
          ]);
          expect(regions.every((region) => region.geometry != null)).toBe(true);
          return [
            plrCandidate("lor:plr:06200313", "ortsteil:osm:lankwitz"),
            plrCandidate("lor:plr:06200422", "ortsteil:osm:lankwitz"),
            plrCandidate("lor:plr:06100206", "ortsteil:osm:stadtpark"),
            plrCandidate("lor:plr:06100207", "ortsteil:osm:stadtpark"),
          ];
        },
      },
      { userId: DEFAULT_LOO_USER_ID },
    );

    expect(sqls.some((sql) => sql.includes("INSERT") || sql.includes("UPDATE"))).toBe(false);
    expect(sqls.some((text) => text.includes(NEAREST_LOR_PLR_SQL.slice(0, 40)) || text.includes("lor:plr:%"))).toBe(true);
    expect(sqls.some((text) => text.includes("geo.geo_ref_ortsteil"))).toBe(true);
    expect(ORTSTEIL_AT_POINT_SQL).toContain("ST_AsGeoJSON");
    expect(fixture.stores.map((store) => store.geoKey)).toEqual([
      "lor:plr:06200313",
      "lor:plr:06100206",
      "lor:plr:06200422",
    ]);
    expect(fixture.criteria[0]?.baseline).toBe("per_km2");
    expect(fixture.yearly.every((entry) => entry.valueKey === "unfaelle_je_km2")).toBe(true);
    expect(fixture.pool.every((item) => item.targetRegionGeoKey === fixture.targetRegionGeoKey)).toBe(true);
    expect(fixture.targetRegionStampNote).toMatch(/multiple Ortsteile/);
    expect(yearlyRegions[0]?.every((region) => region.level === "lor")).toBe(true);
    expect(yearlyRegions[0]?.map((region) => region.geoKey)).toEqual(
      expect.arrayContaining(["lor:plr:06200313", "lor:plr:06100206", "lor:plr:06200422", "lor:plr:06100207"]),
    );
  });

  it("aborts LOO_TOO_FEW_STORES when fewer than 3 store_locations exist", async () => {
    const query = jest.fn(async (sql: string) => {
      if (String(sql).includes("store_locations")) {
        return rows([
          { id: "1", label: "A", street: "A", postal_code: "12247", city: "Berlin", lon: 13.3, lat: 52.4 },
          { id: "2", label: "B", street: "B", postal_code: "12169", city: "Berlin", lon: 13.3, lat: 52.4 },
        ]);
      }
      throw new Error("should not query further");
    });
    await expect(
      loadLooFromDatabase(
        { query: asQuery(query), yearlyBuild: async () => [], loadAreas: async () => [] },
        { userId: "2" },
      ),
    ).rejects.toMatchObject({ code: "LOO_TOO_FEW_STORES" });
  });

  it("falls back to last completed set items when Ortsteil PLR catalog is empty", async () => {
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      if (text.includes("store_locations")) {
        return rows([
          { id: "1", label: "A", street: "A", postal_code: "12247", city: "Berlin", lon: 13.34, lat: 52.43 },
          { id: "2", label: "B", street: "B", postal_code: "12169", city: "Berlin", lon: 13.35, lat: 52.45 },
          { id: "3", label: "C", street: "C", postal_code: "12209", city: "Berlin", lon: 13.36, lat: 52.41 },
        ]);
      }
      if (text.includes("berlin_lor_ewr_bevoelkerung")) {
        return rows([{ geo_key: "lor:plr:06200313", geo_ags: "11000000" }]);
      }
      if (text.includes("geo_ref_ortsteil")) {
        return rows([]);
      }
      if (text.includes("recommendation_sets")) {
        return rows([
          {
            id: "58",
            payload: {
              runId: "64",
              window: { from: "2023", to: "2025" },
              count: 2,
              reason: null,
              pattern: { source: "heuristic", summary: "x", revenueDirection: "up", criteria: [criterion] },
              items: [
                {
                  id: "other:lor:plr:06200313",
                  rank: 1,
                  rationale: "x",
                  source: "heuristic",
                  title: "A",
                  kind: "lor",
                  grain: "other",
                  name: "A",
                  parentLabel: null,
                  targetRegionGeoKey: "ortsteil:osm:lankwitz",
                  dataAsOf: "2025",
                  location: { geoKey: "lor:plr:06200313", grain: "other", lon: 13.3, lat: 52.4, name: "A" },
                  score: 0.2,
                  criteriaEvidence: [],
                },
                {
                  id: "other:lor:plr:09999999",
                  rank: 2,
                  rationale: "x",
                  source: "heuristic",
                  title: "Other",
                  kind: "lor",
                  grain: "other",
                  name: "Other",
                  parentLabel: null,
                  targetRegionGeoKey: "ortsteil:osm:lankwitz",
                  dataAsOf: "2025",
                  location: { geoKey: "lor:plr:09999999", grain: "other", lon: 13.3, lat: 52.4, name: "Other" },
                  score: 0.1,
                  criteriaEvidence: [],
                },
              ],
            },
          },
        ]);
      }
      if (text.includes("FROM app.analysis_runs")) {
        return rows([
          {
            id: "64",
            input: { capturedAt: "2026-10-06T16:14:00.000Z" },
            pattern: { source: "heuristic", summary: "x", revenueDirection: "up", criteria: [criterion] },
          },
        ]);
      }
      throw new Error(text.slice(0, 80));
    });

    const fixture = await loadLooFromDatabase(
      { query: asQuery(query), yearlyBuild: async (regions) => regions.map((region) => yearly(region.geoKey ?? "")), loadAreas: async () => [] },
      { userId: "2", runId: "64" },
    );
    expect(query.mock.calls.some((call) => String(call[0]).includes("analysis_runs") && call[1]?.[1] === "64")).toBe(
      true,
    );
    expect(fixture.pool.map((item) => item.geoKey)).toEqual(expect.arrayContaining(["lor:plr:06200313", "lor:plr:09999999"]));
    expect(fixture.yearly.every((entry) => entry.valueKey === "unfaelle_je_km2")).toBe(true);
  });

  it("refuses write SQL", () => {
    expect(() => assertReadOnlySql("INSERT INTO app.store_locations (user_id) VALUES (1)")).toThrow(/read-only/);
    expect(() => assertReadOnlySql("SELECT id FROM app.store_locations")).not.toThrow();
    expect(looError("LOO_WRITE_FORBIDDEN", "x")).toMatchObject({ code: "LOO_WRITE_FORBIDDEN" });
  });
});
