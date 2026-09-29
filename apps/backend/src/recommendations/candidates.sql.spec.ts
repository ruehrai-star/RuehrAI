import { buildCandidateSql, regionQueryParams } from "./candidates.sql";
import { AnalysisRegion } from "../analysis/types";

const columns = new Set([
  "id",
  "geo_key",
  "grain",
  "ref_period",
  "name",
  "title",
  "metadata",
  "lon",
  "lat",
]);

function region(overrides: Partial<AnalysisRegion> = {}): AnalysisRegion {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("candidate SQL", () => {
  it("filters the region, metadata tags, and the six-month keys", () => {
    const sql = buildCandidateSql("location_feature_docs", columns);
    expect(sql).toContain("FROM features.location_feature_docs");
    expect(sql).toContain("grain IN ('ags', 'ags5')");
    expect(sql).toContain("grain IN ('plz5', 'plz8')");
    expect(sql).toContain("metadata->>'geo_ags' = $1");
    expect(sql).toContain("metadata->>'plz' = $2");
    expect(sql).toContain("left(btrim(ref_period), 7) = ANY($5::text[])");
    expect(sql).toContain("lon");
    expect(sql).toContain("LIMIT 2400");
    expect(sql).not.toContain("<=>");
  });

  it("omits metadata predicates when that column is absent", () => {
    const sql = buildCandidateSql(
      "v_location_search",
      new Set(["id", "geo_key", "grain", "ref_period", "title"]),
    );
    expect(sql).not.toContain("metadata->>");
    expect(sql).toContain("NULL::float8 AS lon");
  });

  it("sends a label pattern only when the region has no geo key", () => {
    expect(regionQueryParams(region())).toEqual(["09162000", null, "09162000", null]);
    const labelOnly = regionQueryParams(
      region({ ags: null, plz: null, geoKey: null, label: "München" }),
    );
    expect(labelOnly[3]).toBe("%München%");
  });
});
