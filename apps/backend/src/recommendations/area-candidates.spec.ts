import { AnalysisRegion } from "../analysis/types";
import {
  AREA_CANDIDATE_LIMIT,
  areaCandidateParams,
  buildAreaCandidateSql,
  isRegionAnchor,
} from "./area-candidates";

function region(overrides: Partial<AnalysisRegion> = {}): AnalysisRegion {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [11.4, 48.0],
          [11.7, 48.0],
          [11.7, 48.3],
          [11.4, 48.3],
          [11.4, 48.0],
        ],
      ],
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("area candidate SQL", () => {
  it("intersects geo_ref Ortsteil, Bezirk, and PLZ and never uses embeddings", () => {
    const sql = buildAreaCandidateSql();
    expect(sql).toContain("geo.geo_ref_ortsteil");
    expect(sql).toContain("geo.geo_ref_bezirk");
    expect(sql).toContain("geo.geo_ref_plz");
    expect(sql).toContain("ST_Intersects");
    expect(sql).toContain("ST_GeomFromGeoJSON");
    expect(sql).toContain("geo.geo_ref_admin");
    expect(sql).toContain(`LIMIT ${AREA_CANDIDATE_LIMIT}`);
    expect(sql).not.toContain("<=>");
    expect(sql).not.toContain("location_feature_docs");
    expect(sql).toContain("geo_key IS DISTINCT FROM $4");
  });

  it("sends geometry and excludes the region geoKey; Kreis also asks for Gemeinden", () => {
    const city = areaCandidateParams(region());
    expect(city[0]).toContain("Polygon");
    expect(city[1]).toBe("09162000");
    expect(city[3]).toBe("09162000");
    expect(city[5]).toBe(false);

    const kreis = areaCandidateParams(
      region({
        label: "Köln",
        grain: "ags5",
        geoKey: "05315",
        ags: "05315",
        geometry: null,
      }),
    );
    expect(kreis[0]).toBeNull();
    expect(kreis[1]).toBe("05315");
    expect(kreis[4]).toBe("05315");
    expect(kreis[5]).toBe(true);
  });
});

describe("isRegionAnchor", () => {
  it("never treats the Zielregion geoKey as a hit", () => {
    expect(
      isRegionAnchor(
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
      ),
    ).toBe(true);
    expect(
      isRegionAnchor(
        { geoKey: "ags:09162000", grain: "ags", ags: "09162000", plz: null },
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
      ),
    ).toBe(true);
    expect(
      isRegionAnchor(
        { geoKey: "ortsteil:osm:1", grain: "other", ags: "09162000", plz: null },
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
      ),
    ).toBe(false);
    expect(
      isRegionAnchor(
        { geoKey: "80801", grain: "plz5", ags: null, plz: "80801" },
        { geoKey: "80801", grain: "plz5", ags: null, plz: "80801" },
      ),
    ).toBe(true);
  });
});
