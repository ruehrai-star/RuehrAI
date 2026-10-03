import {
  CATALOG_LEVELS,
  GEO_BEZIRK_OUTLINE_SQL,
  GEO_CATALOG_SEARCH_SQL,
  GEO_ORTSTEIL_OUTLINE_SQL,
  GEO_PLZ_OUTLINE_SQL,
  catalogDedupKey,
  catalogLevelForBezirk,
  catalogLevelForOrtsteilKind,
  catalogLookupPlan,
  toCatalogHit,
} from "./geo-catalog";

describe("geo catalog contract", () => {
  it("uses the locked level tokens", () => {
    expect(CATALOG_LEVELS).toEqual(["plz", "bezirk", "stadtbezirk", "stadtteil", "ortsteil"]);
    expect(catalogLevelForBezirk("11000001")).toBe("bezirk");
    expect(catalogLevelForBezirk("11000012")).toBe("bezirk");
    expect(catalogLevelForBezirk("02000002")).toBe("stadtbezirk");
    expect(catalogLevelForBezirk("11000000")).toBe("stadtbezirk");
    expect(catalogLevelForOrtsteilKind("Stadtteil")).toBe("stadtteil");
    expect(catalogLevelForOrtsteilKind("ortsteil")).toBe("ortsteil");
    expect(catalogLevelForOrtsteilKind("gemeinde")).toBeNull();
    expect(catalogLevelForOrtsteilKind("both")).toBeNull();
  });

  it("drops a row whose level is not one of the five tokens", () => {
    expect(
      toCatalogHit({
        id: "ags:09162000",
        label: "München",
        grain: "ags",
        geo_key: "09162000",
        level: "gemeinde",
        parent_label: null,
        geo_ags: "09162000",
        lon: 11.5,
        lat: 48.1,
      }),
    ).toBeNull();
  });

  it("drops a nameless catalog row instead of using the key as the label", () => {
    expect(
      toCatalogHit({
        id: "ortsteil:osm:5712247",
        label: "  ",
        grain: "other",
        geo_key: "ortsteil:osm:5712247",
        level: "ortsteil",
        parent_label: "Berlin",
        geo_ags: "11000000",
        lon: 13.3,
        lat: 52.4,
      }),
    ).toBeNull();
  });

  it("dedups Berlin Bezirke and PLZ keys", () => {
    expect(
      catalogDedupKey({ id: "ags:11000001", grain: "ags", geoKey: "11000001", level: "bezirk" }),
    ).toBe(catalogDedupKey({ id: "ags:11001001", grain: "ags", geoKey: "11001001" }));
    expect(catalogDedupKey({ id: "plz5:80331", grain: "plz5", geoKey: "80331", level: "plz" })).toBe(
      catalogDedupKey({ id: "plz5:80331", grain: "plz5", geoKey: "80331" }),
    );
  });

  it("routes PUT keys to the matching geo table", () => {
    expect(
      catalogLookupPlan({ grain: "plz5", geoKey: "80331", ags: null, plz: "80331" }),
    ).toEqual({ plz: "80331", bezirkId: null, ortsteilId: null });
    expect(
      catalogLookupPlan({ grain: "ags", geoKey: "11006006", ags: "11006006", plz: null }),
    ).toEqual({ plz: null, bezirkId: "11000006", ortsteilId: null });
    expect(
      catalogLookupPlan({
        grain: "other",
        geoKey: "stadtbezirk:02000002",
        ags: null,
        plz: null,
      }),
    ).toEqual({ plz: null, bezirkId: "02000002", ortsteilId: null });
    expect(
      catalogLookupPlan({
        grain: "other",
        geoKey: "stadtteil:42",
        ags: null,
        plz: null,
      }),
    ).toEqual({ plz: null, bezirkId: null, ortsteilId: "42" });
    expect(
      catalogLookupPlan({ grain: "ags", geoKey: "09162000", ags: "09162000", plz: null }),
    ).toEqual({ plz: null, bezirkId: null, ortsteilId: null });
    expect(
      catalogLookupPlan({
        grain: "other",
        geoKey: "ortsteil:osm:5712247",
        ags: null,
        plz: null,
      }),
    ).toEqual({ plz: null, bezirkId: null, ortsteilId: "osm:5712247" });
  });

  it("reads Brain schema geo and skips empty geom", () => {
    expect(GEO_CATALOG_SEARCH_SQL).toContain("geo.geo_ref_plz");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("geo.geo_ref_bezirk");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("geo.geo_ref_ortsteil");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("ST_IsEmpty(geom)");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("'bezirk'");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("'stadtbezirk'");
    expect(GEO_CATALOG_SEARCH_SQL).not.toContain("'gemeinde'");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("LIMIT 50");
    expect(GEO_PLZ_OUTLINE_SQL).toContain("geo.geo_ref_plz");
    expect(GEO_BEZIRK_OUTLINE_SQL).toContain("geo.geo_ref_bezirk");
    expect(GEO_ORTSTEIL_OUTLINE_SQL).toContain("geo.geo_ref_ortsteil");
    expect(GEO_ORTSTEIL_OUTLINE_SQL).toContain("stadtteil");
    expect(GEO_PLZ_OUTLINE_SQL).not.toContain(";");
  });

  it("does not let free-text q match internal catalog keys", () => {
    expect(GEO_CATALOG_SEARCH_SQL).not.toMatch(/src\.id ILIKE \$4/);
    expect(GEO_CATALOG_SEARCH_SQL).not.toMatch(/src\.geo_key ILIKE \$4/);
    expect(GEO_CATALOG_SEARCH_SQL).not.toContain("src.geo_ags, '') ILIKE $4");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("$8::boolean OR src.level <> 'plz'");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("src.label IS NOT NULL");
    expect(GEO_CATALOG_SEARCH_SQL).toContain("$6::text IS NULL OR src.geo_key = $6 OR src.id = $6");
  });
});
