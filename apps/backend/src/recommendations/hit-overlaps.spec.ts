import { AreaKind } from "./area-candidates";
import { attachHitOverlaps, groupOverlapsByHit, selectOverlaps, HitOverlapRow } from "./hit-overlaps";
import { OVERLAP_MIN_SHARE, buildHitOverlapSql, hitOverlapQuery, highestSqlPlaceholder } from "./area-candidates";
import { ScoredLocation } from "./types";

function row(overrides: Partial<HitOverlapRow> & Pick<HitOverlapRow, "hit_geo_key" | "label" | "share">): HitOverlapRow {
  return {
    geo_key: overrides.geo_key ?? `stadtbezirk:${overrides.label}`,
    kind: overrides.kind ?? "stadtbezirk",
    ...overrides,
  };
}

function hit(geoKey: string, kind: AreaKind = "plz"): ScoredLocation {
  return {
    id: `plz5:${geoKey}`,
    title: `PLZ ${geoKey}`,
    kind,
    grain: kind === "plz" ? "plz5" : "other",
    name: `PLZ ${geoKey}`,
    parentLabel: "München",
    location: { geoKey, grain: kind === "plz" ? "plz5" : "other", lon: null, lat: null, name: `PLZ ${geoKey}` },
    score: 1,
    criteriaEvidence: [],
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
    const result = await attachHitOverlaps({ queryReadingFeatures }, ranked);
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
    const result = await attachHitOverlaps({ queryReadingFeatures }, [hit("81541"), hit("81249")]);
    expect(result[0]?.overlaps?.map((part) => part.label)).toEqual(["Au-Haidhausen", "Obergiesing-Fasangarten"]);
    expect(result[1]?.overlaps?.map((part) => part.label)).toEqual(["Aubing-Lochhausen-Langwied"]);
    expect(queryReadingFeatures).toHaveBeenCalledTimes(1);
    const [sql, params] = queryReadingFeatures.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe(buildHitOverlapSql());
    expect(params).toHaveLength(highestSqlPlaceholder(sql));
  });

  it("matches overlap SQL $n to params", () => {
    const query = hitOverlapQuery([
      { geoKey: "81541", kind: "plz" },
      { geoKey: "lor:plr:1", kind: "lor" },
    ]);
    expect(query.params).toHaveLength(highestSqlPlaceholder(query.sql));
    expect(query.sql).toContain("ST_Transform");
    expect(query.sql).toContain("3035");
    expect(query.sql).toContain("geo.geo_ref_bezirk");
    expect(query.sql).toContain("geo.geo_ref_plz");
    expect(query.sql).not.toContain("<=>");
  });
});
