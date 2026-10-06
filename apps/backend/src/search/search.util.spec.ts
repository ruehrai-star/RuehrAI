import {
  allowPlzHits,
  hasVisibleLabel,
  isArealessAdminHit,
  isInternalCatalogKeyQuery,
  isPlzHit,
  matchCatalogAdminHit,
  normalizeAdminSearchName,
  searchFilterParams,
  toContainsPattern,
} from "./search.util";

describe("toContainsPattern", () => {
  it("wraps a plain value", () => {
    expect(toContainsPattern("München")).toBe("%München%");
  });

  it("escapes LIKE wildcards", () => {
    expect(toContainsPattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});

describe("allowPlzHits", () => {
  it("allows PLZ when q is absent or only digits", () => {
    expect(allowPlzHits(undefined)).toBe(true);
    expect(allowPlzHits("12247")).toBe(true);
    expect(allowPlzHits("80331")).toBe(true);
  });

  it("rejects PLZ for any name query, not only München", () => {
    expect(allowPlzHits("München")).toBe(false);
    expect(allowPlzHits("Hamburg")).toBe(false);
    expect(allowPlzHits("Leipzig")).toBe(false);
    expect(allowPlzHits("plz5:12247")).toBe(false);
    expect(allowPlzHits("12 247")).toBe(false);
  });
});

describe("isInternalCatalogKeyQuery", () => {
  it("recognizes catalog keys and ignores place names", () => {
    expect(isInternalCatalogKeyQuery("plz5:12247")).toBe(true);
    expect(isInternalCatalogKeyQuery("ortsteil:osm:5712247")).toBe(true);
    expect(isInternalCatalogKeyQuery("stadtteil:osm:1")).toBe(true);
    expect(isInternalCatalogKeyQuery("stadtbezirk:osm:2")).toBe(true);
    expect(isInternalCatalogKeyQuery("ags:11000001")).toBe(true);
    expect(isInternalCatalogKeyQuery("12247")).toBe(false);
    expect(isInternalCatalogKeyQuery("München")).toBe(false);
  });
});

describe("searchFilterParams", () => {
  it("keeps exact geoKey and passes the PLZ gate as $8", () => {
    expect(searchFilterParams({ q: "12247", geoKey: "plz5:12247" })).toEqual([
      null,
      null,
      null,
      "%12247%",
      null,
      "plz5:12247",
      null,
      true,
      ["%12247%"],
    ]);
    expect(searchFilterParams({ q: "München" })[7]).toBe(false);
    expect(searchFilterParams({ q: "Innenstadt Köln" })[8]).toEqual(["%Innenstadt%", "%Köln%"]);
    expect(searchFilterParams({ q: "Altona Hamburg" })[8]).toEqual(["%Altona%", "%Hamburg%"]);
    expect(searchFilterParams({ q: "Hamburg Altona" })[8]).toEqual(["%Hamburg%", "%Altona%"]);
  });
});

describe("visible labels", () => {
  it("drops blank names and recognizes PLZ hits", () => {
    expect(hasVisibleLabel("12247")).toBe(true);
    expect(hasVisibleLabel("  ")).toBe(false);
    expect(hasVisibleLabel("")).toBe(false);
    expect(isPlzHit({ level: "plz", grain: "plz5" })).toBe(true);
    expect(isPlzHit({ level: "ortsteil", grain: "other" })).toBe(false);
  });
});

describe("arealess admin search hits", () => {
  it("treats Köln 05315001 as a district without catalog area", () => {
    expect(
      isArealessAdminHit({ grain: "ags", geoKey: "05315001", level: "stadtbezirk" }),
    ).toBe(true);
    expect(
      isArealessAdminHit({
        grain: "other",
        geoKey: "stadtbezirk:osm:2613798",
        level: "stadtbezirk",
      }),
    ).toBe(false);
    expect(isArealessAdminHit({ grain: "ags", geoKey: "05315000", level: "gemeinde" })).toBe(false);
  });

  it("normalizes Bezirk Köln Innenstadt onto Innenstadt", () => {
    expect(normalizeAdminSearchName("Bezirk Köln Innenstadt", "Köln")).toBe("innenstadt");
    expect(normalizeAdminSearchName("Innenstadt", "Köln")).toBe("innenstadt");
    const catalog = [
      {
        label: "Innenstadt",
        level: "stadtbezirk",
        parentLabel: "Köln",
        geoKey: "stadtbezirk:osm:2613798",
        geoAgs: "05315000",
      },
    ];
    expect(
      matchCatalogAdminHit(
        {
          label: "Bezirk Köln Innenstadt",
          level: "stadtbezirk",
          parentLabel: "Köln",
          geoKey: "05315001",
          geoAgs: "05315001",
        },
        catalog,
      )?.geoKey,
    ).toBe("stadtbezirk:osm:2613798");
  });
});
