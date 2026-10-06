import { AnalysisRegion } from "../analysis/types";
import { AreaKind } from "./area-candidates";
import { attachHitOverlaps, groupOverlapsByHit, selectOverlaps, HitOverlapRow } from "./hit-overlaps";
import {
  OVERLAP_MIN_SHARE,
  buildHitOverlapSql,
  hitOverlapQuery,
  highestSqlPlaceholder,
  overlapEligibleKind,
  overlapRegionMeta,
  regionsGeometryParam,
} from "./area-candidates";
import { ScoredLocation } from "./types";

function row(overrides: Partial<HitOverlapRow> & Pick<HitOverlapRow, "hit_geo_key" | "label" | "share">): HitOverlapRow {
  return {
    geo_key: overrides.geo_key ?? `ortsteil:${overrides.label}`,
    kind: overrides.kind ?? "ortsteil",
    is_target_region: overrides.is_target_region ?? false,
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
    targetRegionGeoKey: "09162000",
    dataAsOf: null,
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

  it("puts the Zielregion first even when an Ortsteil share is larger", () => {
    const parts = selectOverlaps([
      row({ hit_geo_key: "lor:plr:06200311", label: "Lankwitz", share: 0.98, geo_key: "ortsteil:osm:lankwitz" }),
      row({
        hit_geo_key: "lor:plr:06200311",
        label: "Tempelhof",
        share: 0.02,
        geo_key: "ortsteil:osm:162894",
        is_target_region: true,
      }),
    ]);
    expect(parts).toEqual([
      { geoKey: "ortsteil:osm:162894", label: "Tempelhof", kind: "ortsteil", share: 0.02, isTargetRegion: true },
      { geoKey: "ortsteil:osm:lankwitz", label: "Lankwitz", kind: "ortsteil", share: 0.98 },
    ]);
  });

  it("drops catalog keys used as labels", () => {
    expect(
      selectOverlaps([
        row({ hit_geo_key: "x", label: "ortsteil:osm:162894", share: 1, is_target_region: true }),
      ]),
    ).toEqual([]);
  });

  it("clamps a PostGIS share of 1 + ulp to 1 instead of dropping the row", () => {
    expect(
      selectOverlaps([
        row({
          hit_geo_key: "koeln:sq:101010001",
          label: "Innenstadt",
          share: 1.0000000000000002,
          geo_key: "ortsteil:innenstadt",
          is_target_region: true,
        }),
      ]),
    ).toEqual([
      {
        geoKey: "ortsteil:innenstadt",
        label: "Innenstadt",
        kind: "ortsteil",
        share: 1,
        isTargetRegion: true,
      },
    ]);
  });

  it("includes grid100 and address, typically one Stadtbezirk at share 1", async () => {
    expect(overlapEligibleKind("grid100")).toBe(true);
    expect(overlapEligibleKind("address")).toBe(true);
    const queryReadingFeatures = jest.fn().mockResolvedValue({
      rows: [
        row({
          hit_geo_key: "grid100:1",
          label: "Innenstadt",
          share: 1,
          geo_key: "bezirk:osm:innenstadt",
          kind: "bezirk",
          is_target_region: true,
        }),
        row({
          hit_geo_key: "address:1",
          label: "Innenstadt",
          share: 1,
          geo_key: "bezirk:osm:innenstadt",
          kind: "bezirk",
          is_target_region: true,
        }),
      ],
    });
    const result = await attachHitOverlaps(
      { queryReadingFeatures },
      [hit("grid100:1", "grid100"), hit("address:1", "address")],
      [zielregion()],
    );
    expect(result[0]?.overlaps).toEqual([
      { geoKey: "bezirk:osm:innenstadt", label: "Innenstadt", kind: "bezirk", share: 1, isTargetRegion: true },
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
      overlapRegionMeta(zielregion()),
    );
    expect(query.params).toHaveLength(highestSqlPlaceholder(query.sql));
    expect(highestSqlPlaceholder(query.sql)).toBe(6);
    expect(query.sql).toContain("ST_Transform");
    expect(query.sql).toContain("3035");
    expect(query.sql).toContain("geo.geo_ref_ortsteil");
    expect(query.sql).toContain("geo.geo_ref_plz");
    expect(query.sql).toContain("geo.geo_ref_address");
    expect(query.sql).toContain("geo.geo_ref_quartier");
    expect(query.sql).toContain("kind = 'quartier'");
    expect(query.sql).toContain("grid100");
    expect(query.sql).toContain("region_geom");
    expect(query.sql).toContain("is_target_region");
    expect(query.sql).toContain("ST_Covers");
    expect(query.sql).toContain("ST_Dimension");
    expect(query.sql).not.toContain("geo.geo_ref_bezirk");
    expect(query.sql).not.toContain("<=>");
    expect(query.params[4]).toBe("Innenstadt");
    expect(query.params[5]).toBe("bezirk");
  });

  it("clips overlaps to each item's own Zielregion when the same Fläche appears twice", async () => {
    const left = zielregion({ geoKey: "ortsteil:osm:licht", label: "Lichterfelde", parentLabel: "Berlin" });
    const right = zielregion({
      geoKey: "ortsteil:osm:steg",
      label: "Steglitz",
      parentLabel: "Berlin",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [13.3, 52.4],
            [13.4, 52.4],
            [13.4, 52.5],
            [13.3, 52.5],
            [13.3, 52.4],
          ],
        ],
      },
    });
    const queryReadingFeatures = jest.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
      const label = String(params[4] ?? "");
      const geoKey = String(params[3] ?? "");
      return {
        rows: [
          row({
            hit_geo_key: "12207",
            label,
            share: 1,
            geo_key: geoKey,
            kind: "ortsteil",
            is_target_region: true,
          }),
        ],
      };
    });
    const leftHit = { ...hit("12207"), id: "plz5:12207@ortsteil:osm:licht", targetRegionGeoKey: left.geoKey ?? "" };
    const rightHit = { ...hit("12207"), id: "plz5:12207@ortsteil:osm:steg", targetRegionGeoKey: right.geoKey ?? "" };
    const result = await attachHitOverlaps({ queryReadingFeatures }, [leftHit, rightHit], [left, right]);
    expect(queryReadingFeatures).toHaveBeenCalledTimes(2);
    expect(result[0]?.overlaps).toEqual([
      { geoKey: "ortsteil:osm:licht", label: "Lichterfelde", kind: "ortsteil", share: 1, isTargetRegion: true },
    ]);
    expect(result[1]?.overlaps).toEqual([
      { geoKey: "ortsteil:osm:steg", label: "Steglitz", kind: "ortsteil", share: 1, isTargetRegion: true },
    ]);
    expect(result[0]?.id).not.toBe(result[1]?.id);
  });
});
