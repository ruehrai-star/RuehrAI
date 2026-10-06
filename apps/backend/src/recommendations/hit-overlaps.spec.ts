import { AnalysisRegion } from "../analysis/types";
import { AreaKind } from "./area-candidates";
import { attachHitOverlaps, groupOverlapsByHit, selectOverlaps, HitOverlapRow } from "./hit-overlaps";
import {
  OVERLAP_MIN_SHARE,
  buildHitOverlapSql,
  hitOverlapQuery,
  highestSqlPlaceholder,
  overlapEligibleKind,
  regionsGeometryParam,
} from "./area-candidates";
import { ScoredLocation } from "./types";

function row(overrides: Partial<HitOverlapRow> & Pick<HitOverlapRow, "hit_geo_key" | "label" | "share">): HitOverlapRow {
  return {
    geo_key: overrides.geo_key ?? `stadtbezirk:${overrides.label}`,
    kind: overrides.kind ?? "stadtbezirk",
    ...overrides,
  };
}

function hit(geoKey: string, kind: AreaKind = "plz"): ScoredLocation {
  const grain = kind === "plz" ? "plz5" : kind === "grid100" ? "grid100" : kind === "address" ? "address" : "other";
  return {
    id: `${grain}:${geoKey}`,
    title: geoKey,
    kind,
    grain,
    name: geoKey,
    parentLabel: "München",
    location: { geoKey, grain, lon: null, lat: null, name: geoKey },
    score: 1,
    criteriaEvidence: [],
  };
}

const innenstadtGeom = {
  type: "Polygon" as const,
  coordinates: [
    [
      [6.94, 50.93],
      [6.97, 50.93],
      [6.97, 50.95],
      [6.94, 50.95],
      [6.94, 50.93],
    ],
  ],
};

function zielregion(overrides: Partial<AnalysisRegion> = {}): AnalysisRegion {
  return {
    label: "Innenstadt",
    grain: "other",
    geoKey: "bezirk:osm:innenstadt",
    level: "bezirk",
    parentLabel: "Köln",
    ags: "05315000",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: innenstadtGeom,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("hit overlaps", () => {
  it("keeps München 81541 shares ≥ 1 % sorted descending", () => {
    const parts = selectOverlaps([
      row({ hit_geo_key: "81541", label: "Au-Haidhausen", share: 0.4168 }),
      row({ hit_geo_key: "81541", label: "Obergiesing-Fasangarten", share: 0.3801 }),
      row({ hit_geo_key: "81541", label: "Ramersdorf-Perlach", share: 0.1647 }),
      row({ hit_geo_key: "81541", label: "Ludwigsvorstadt-Isarvorstadt", share: 0.0375 }),
      row({ hit_geo_key: "81541", label: "Splitter", share: 0.009 }),
    ]);
    expect(parts.map((part) => part.label)).toEqual([
      "Au-Haidhausen",
      "Obergiesing-Fasangarten",
      "Ramersdorf-Perlach",
      "Ludwigsvorstadt-Isarvorstadt",
    ]);
    expect(parts[0]?.share).toBe(0.4168);
    expect(parts.every((part) => part.share >= OVERLAP_MIN_SHARE)).toBe(true);
  });

  it("keeps a nearly mono PLZ as a single overlap", () => {
    const byHit = groupOverlapsByHit([
      row({ hit_geo_key: "81249", label: "Aubing-Lochhausen-Langwied", share: 0.9974 }),
      row({ hit_geo_key: "81249", label: "Splitter", share: 0.0026 }),
    ]);
    expect(byHit.get("81249")?.map((part) => part.label)).toEqual(["Aubing-Lochhausen-Langwied"]);
  });

  it("omits overlaps and still completes when Brain fails", async () => {
    const queryReadingFeatures = jest.fn().mockRejectedValue(new Error("Brain unavailable"));
    const ranked = [hit("81541"), hit("81249")];
    const result = await attachHitOverlaps({ queryReadingFeatures }, ranked, [zielregion()]);
    expect(result).toHaveLength(2);
    expect(result[0]?.overlaps).toBeUndefined();
    expect(result[1]?.overlaps).toBeUndefined();
  });

  it("attaches grouped overlaps from a batched query", async () => {
    const queryReadingFeatures = jest.fn().mockResolvedValue({
      rows: [
        row({ hit_geo_key: "81541", label: "Au-Haidhausen", share: 0.42 }),
        row({ hit_geo_key: "81541", label: "Obergiesing-Fasangarten", share: 0.38 }),
        row({ hit_geo_key: "81249", label: "Aubing-Lochhausen-Langwied", share: 0.997 }),
      ],
    });
    const result = await attachHitOverlaps({ queryReadingFeatures }, [hit("81541"), hit("81249")], [zielregion()]);
    expect(result[0]?.overlaps?.map((part) => part.label)).toEqual(["Au-Haidhausen", "Obergiesing-Fasangarten"]);
    expect(result[1]?.overlaps?.map((part) => part.label)).toEqual(["Aubing-Lochhausen-Langwied"]);
    expect(queryReadingFeatures).toHaveBeenCalledTimes(1);
    const [sql, params] = queryReadingFeatures.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe(buildHitOverlapSql());
    expect(params).toHaveLength(highestSqlPlaceholder(sql));
    expect(params[2]).toBe(regionsGeometryParam([zielregion()]));
  });

  it("clips shares to the Zielregion so an outer Bezirk does not appear", () => {
    const sql = buildHitOverlapSql();
    expect(sql).toContain("region_geom");
    expect(sql).toContain("$3");
    expect(sql).toContain("ST_Intersection");
    expect(sql).toContain("ST_MakeValid(ST_Intersection");
    const clipped = selectOverlaps([
      row({ hit_geo_key: "50667", label: "Innenstadt", share: 0.62 }),
      row({ hit_geo_key: "50667", label: "Altstadt-Süd", share: 0.38 }),
    ]);
    expect(clipped.map((part) => part.label)).toEqual(["Innenstadt", "Altstadt-Süd"]);
    expect(clipped.find((part) => part.label === "Nippes")).toBeUndefined();
    expect(clipped.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 5);
  });

  it("includes grid100 and address, typically one Stadtbezirk at share 1", async () => {
    expect(overlapEligibleKind("grid100")).toBe(true);
    expect(overlapEligibleKind("address")).toBe(true);
    const queryReadingFeatures = jest.fn().mockResolvedValue({
      rows: [
        row({ hit_geo_key: "grid100:1", label: "Maxvorstadt", share: 1 }),
        row({ hit_geo_key: "address:1", label: "Maxvorstadt", share: 1 }),
      ],
    });
    const result = await attachHitOverlaps(
      { queryReadingFeatures },
      [hit("grid100:1", "grid100"), hit("address:1", "address")],
      [zielregion()],
    );
    expect(result[0]?.overlaps).toEqual([
      { geoKey: "stadtbezirk:Maxvorstadt", label: "Maxvorstadt", kind: "stadtbezirk", share: 1 },
    ]);
    expect(result[1]?.overlaps?.[0]?.share).toBe(1);
    const params = queryReadingFeatures.mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toEqual(["grid100:1", "address:1"]);
    expect(params[1]).toEqual(["grid100", "address"]);
  });

  it("matches overlap SQL $n to params including the Zielregion geom", () => {
    const query = hitOverlapQuery(
      [
        { geoKey: "81541", kind: "plz" },
        { geoKey: "lor:plr:1", kind: "lor" },
        { geoKey: "grid100:1", kind: "grid100" },
        { geoKey: "address:1", kind: "address" },
      ],
      regionsGeometryParam([zielregion()]),
    );
    expect(query.params).toHaveLength(highestSqlPlaceholder(query.sql));
    expect(highestSqlPlaceholder(query.sql)).toBe(3);
    expect(query.sql).toContain("ST_Transform");
    expect(query.sql).toContain("3035");
    expect(query.sql).toContain("geo.geo_ref_bezirk");
    expect(query.sql).toContain("geo.geo_ref_plz");
    expect(query.sql).toContain("geo.geo_ref_address");
    expect(query.sql).toContain("grid100");
    expect(query.sql).toContain("region_geom");
    expect(query.sql).not.toContain("<=>");
  });
});
