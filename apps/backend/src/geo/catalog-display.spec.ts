import { fillMissingCatalogDisplay } from "./catalog-display";

describe("fillMissingCatalogDisplay", () => {
  const muenchen = {
    label: "München",
    grain: "ags" as const,
    geoKey: "09162000",
    ags: "09162000",
    plz: null,
    level: null,
    parentLabel: null,
  };

  it("sets level gemeinde on a pre-011 municipality and leaves parentLabel empty", async () => {
    const search = jest.fn().mockResolvedValue([]);
    await expect(fillMissingCatalogDisplay(muenchen, search)).resolves.toEqual({
      ...muenchen,
      level: "gemeinde",
    });
    expect(search).toHaveBeenCalledWith({ geoKey: "09162000" });
  });

  it("does not invent a parent name or change the stored label", async () => {
    const search = jest.fn().mockResolvedValue([
      { label: "Stadt München", level: null, parentLabel: null },
    ]);
    const filled = await fillMissingCatalogDisplay(muenchen, search);
    expect(filled.label).toBe("München");
    expect(filled.level).toBe("gemeinde");
    expect(filled.parentLabel).toBeNull();
  });

  it("never uses gemeinde for a PLZ, Bezirk, or Ortsteil", async () => {
    const search = jest.fn().mockResolvedValue([]);
    await expect(
      fillMissingCatalogDisplay(
        { label: "80331", grain: "plz5", geoKey: "80331", ags: null, plz: "80331", level: null, parentLabel: null },
        search,
      ),
    ).resolves.toMatchObject({ level: null, parentLabel: null });
    await expect(
      fillMissingCatalogDisplay(
        { label: "Mitte", grain: "ags", geoKey: "11000001", ags: "11000001", plz: null, level: null, parentLabel: null },
        search,
      ),
    ).resolves.toMatchObject({ level: "bezirk" });
    await expect(
      fillMissingCatalogDisplay(
        {
          label: "Lankwitz",
          grain: "other",
          geoKey: "ortsteil:osm:5712247",
          ags: null,
          plz: null,
          level: null,
          parentLabel: null,
        },
        search,
      ),
    ).resolves.toMatchObject({ level: "ortsteil" });
  });

  it("sets stadtbezirk and catalog parent on an official AGS district", async () => {
    const search = jest.fn().mockImplementation(async (query: { geoKey?: string; ags?: string }) => {
      if (query.geoKey === "09162004") return [];
      if (query.ags === "09162000") return [{ parentLabel: "München", level: "stadtteil" }];
      return [];
    });
    const filled = await fillMissingCatalogDisplay(
      {
        label: "Bezirk München Schwabing-West",
        grain: "ags",
        geoKey: "09162004",
        ags: "09162004",
        plz: null,
        level: null,
        parentLabel: null,
      },
      search,
    );
    expect(filled.level).toBe("stadtbezirk");
    expect(filled.parentLabel).toBe("München");
    expect(filled.label).toBe("Bezirk München Schwabing-West");
  });

  it("does not invent a parent name when the catalog has none", async () => {
    const search = jest.fn().mockResolvedValue([]);
    const filled = await fillMissingCatalogDisplay(
      {
        label: "Bezirk München Schwabing-West",
        grain: "ags",
        geoKey: "09162004",
        ags: "09162004",
        plz: null,
        level: null,
        parentLabel: null,
      },
      search,
    );
    expect(filled.level).toBe("stadtbezirk");
    expect(filled.parentLabel).toBeNull();
  });

  it("reclassifies an official AGS district that arrived as gemeinde", async () => {
    const search = jest.fn().mockResolvedValue([]);
    const lookupAdmin = jest.fn().mockResolvedValue(new Map([["09162000", "München"]]));
    const district = await fillMissingCatalogDisplay(
      {
        label: "Bezirk München Altstadt-Lehel",
        grain: "ags",
        geoKey: "09162001",
        ags: "09162001",
        plz: null,
        level: "gemeinde",
        parentLabel: null,
      },
      search,
      lookupAdmin,
    );
    expect(district).toMatchObject({
      label: "Bezirk München Altstadt-Lehel",
      level: "stadtbezirk",
      parentLabel: "München",
    });
    await expect(fillMissingCatalogDisplay(muenchen, search, lookupAdmin)).resolves.toMatchObject({
      label: "München",
      level: "gemeinde",
      parentLabel: null,
    });
  });

  it("fills an old PLZ row from the catalog the way a fresh add would", async () => {
    const search = jest.fn().mockResolvedValue([
      { label: "80331", level: "plz", parentLabel: "München" },
    ]);
    const filled = await fillMissingCatalogDisplay(
      {
        label: "80331",
        grain: "plz5" as const,
        geoKey: "80331",
        ags: null,
        plz: "80331",
        level: null,
        parentLabel: null,
      },
      search,
    );
    expect(filled).toMatchObject({
      label: "80331",
      level: "plz",
      parentLabel: "München",
    });
    expect(search).toHaveBeenCalledWith({ geoKey: "80331" });
  });

  it("leaves an already stored catalog display untouched", async () => {
    const search = jest.fn();
    const stored = {
      ...muenchen,
      geoKey: "ortsteil:osm:5712247",
      ags: null,
      level: "ortsteil" as const,
      parentLabel: "Berlin",
    };
    await expect(fillMissingCatalogDisplay(stored, search)).resolves.toEqual(stored);
    expect(search).not.toHaveBeenCalled();
  });
});
