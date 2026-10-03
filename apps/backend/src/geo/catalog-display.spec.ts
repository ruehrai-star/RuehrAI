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
    ).resolves.toMatchObject({ level: null });
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
    ).resolves.toMatchObject({ level: null });
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
