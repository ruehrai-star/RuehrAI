import { AnalysisRegion } from "../analysis/types";
import {
  AREA_CANDIDATE_LIMIT,
  adminGeom4326,
  areaCandidateParams,
  buildAddressCandidateSql,
  buildAreaCandidateSql,
  buildGrid100CandidateSql,
  buildTeilCatalogSql,
  isRegionAnchor,
  parentMemberships,
  selectFinestHits,
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
  it("reads parent→child from geo_ref_zielregion_teil and uses admin 4326, never embeddings", () => {
    const sql = buildTeilCatalogSql();
    expect(sql).toContain("geo.geo_ref_zielregion_teil");
    expect(sql).toContain("geo.geo_ref_ortsteil");
    expect(sql).toContain("geo.geo_ref_bezirk");
    expect(sql).toContain("geo.geo_ref_plz");
    expect(sql).toContain("geo.geo_ref_admin");
    expect(sql).toContain("geom_4326");
    expect(sql).toContain("geom_display");
    expect(sql).toContain(`LIMIT ${AREA_CANDIDATE_LIMIT}`);
    expect(sql).not.toContain("<=>");
    expect(sql).not.toContain("location_feature_docs");
    expect(adminGeom4326("a", "prefer")).toContain("geom_4326");
    expect(adminGeom4326("a", "legacy")).toContain("3035");
  });

  it("probes address and grid100 feature docs without embeddings", () => {
    const address = buildAddressCandidateSql();
    const grid = buildGrid100CandidateSql();
    expect(address).toContain("grain = 'address'");
    expect(grid).toContain("grain = 'grid100'");
    expect(grid).toContain("breitband_gitter");
    expect(address).not.toContain("<=>");
    expect(grid).not.toContain("<=>");
  });

  it("keeps an intersect fallback that still avoids treating admin geom as WGS84", () => {
    const sql = buildAreaCandidateSql();
    expect(sql).toContain("ST_Intersects");
    expect(sql).toContain("ST_GeomFromGeoJSON");
    expect(sql).toContain("geom_4326");
    expect(sql).toContain("geo_key IS DISTINCT FROM $4");
  });

  it("sends geometry and Kreis parent memberships for Gemeinden", () => {
    const city = areaCandidateParams(region());
    expect(city[0]).toContain("Polygon");
    expect(city[1]).toBe("09162000");
    expect(city[5]).toBe(false);

    const membership = parentMemberships(region());
    expect(membership.grains).toContain("gemeinde");
    expect(membership.ids).toContain("09162000");

    const kreis = parentMemberships(
      region({
        label: "Köln",
        grain: "ags5",
        geoKey: "05315",
        ags: "05315",
        geometry: null,
      }),
    );
    expect(kreis.grains).toContain("kreis");
    expect(kreis.ids).toContain("05315");
  });
});

describe("selectFinestHits", () => {
  const regions = [region()];

  it("keeps Ortsteile and drops parent PLZ, Bezirk, and Gemeinde", () => {
    const hits = selectFinestHits(
      [
        {
          id: "ags:09162000",
          geoKey: "09162000",
          grain: "ags",
          kind: "gemeinde",
          title: "München",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
        {
          id: "plz5:80801",
          geoKey: "80801",
          grain: "plz5",
          kind: "plz",
          title: "80801",
          name: "80801",
          ags: "09162000",
          plz: "80801",
          lon: null,
          lat: null,
        },
        {
          id: "other:ortsteil:osm:1",
          geoKey: "ortsteil:osm:1",
          grain: "other",
          kind: "ortsteil",
          title: "Schwabing",
          name: "Schwabing",
          ags: "09162000",
          plz: null,
          lon: 11.58,
          lat: 48.16,
        },
        {
          id: "other:stadtbezirk:4",
          geoKey: "stadtbezirk:4",
          grain: "other",
          kind: "stadtbezirk",
          title: "Schwabing-West",
          name: "Schwabing-West",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
      ],
      regions,
    );
    expect(hits.map((item) => item.geoKey)).toEqual(["ortsteil:osm:1"]);
  });

  it("promotes to PLZ only when no finer hit exists", () => {
    const hits = selectFinestHits(
      [
        {
          id: "plz5:80801",
          geoKey: "80801",
          grain: "plz5",
          kind: "plz",
          title: "80801",
          name: "80801",
          ags: "09162000",
          plz: "80801",
          lon: null,
          lat: null,
        },
        {
          id: "ags:09162000",
          geoKey: "09162000",
          grain: "ags",
          kind: "gemeinde",
          title: "München",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
      ],
      regions,
    );
    expect(hits.map((item) => item.kind)).toEqual(["plz"]);
  });

  it("prefers grid100 over Ortsteil when raster cells exist", () => {
    const hits = selectFinestHits(
      [
        {
          id: "grid100:cell-1",
          geoKey: "cell-1",
          grain: "grid100",
          kind: "grid100",
          title: "cell-1",
          name: "cell-1",
          ags: "09162000",
          plz: null,
          lon: 11.5,
          lat: 48.1,
        },
        {
          id: "other:ortsteil:osm:1",
          geoKey: "ortsteil:osm:1",
          grain: "other",
          kind: "ortsteil",
          title: "Schwabing",
          name: "Schwabing",
          ags: "09162000",
          plz: null,
          lon: 11.58,
          lat: 48.16,
        },
      ],
      regions,
    );
    expect(hits.map((item) => item.kind)).toEqual(["grid100"]);
  });

  it("never treats the Zielregion geoKey as a hit", () => {
    expect(
      isRegionAnchor(
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
      ),
    ).toBe(true);
    const hits = selectFinestHits(
      [
        {
          id: "ags:09162000",
          geoKey: "09162000",
          grain: "ags",
          kind: "gemeinde",
          title: "München",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
      ],
      regions,
    );
    expect(hits).toEqual([]);
  });
});
