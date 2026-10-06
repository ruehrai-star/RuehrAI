import { AnalysisRegion } from "../analysis/types";
import { AREA_KINDS, AreaCandidate, AreaKind } from "./area-candidates";
import { displayAreaName, hitParentLabel, isHiddenCatalogKey, nameContainsForbiddenToken, textContainsCatalogKey, visibleAreaName } from "./hit-display";

function area(overrides: Partial<AreaCandidate> & Pick<AreaCandidate, "geoKey" | "kind">): AreaCandidate {
  const grain = overrides.grain ?? (overrides.kind === "plz" ? "plz5" : overrides.kind === "gemeinde" ? "ags" : "other");
  return {
    id: `${grain}:${overrides.geoKey}`,
    title: overrides.title ?? overrides.name ?? "Ort",
    name: overrides.name ?? overrides.title ?? null,
    ags: overrides.ags ?? "11000000",
    plz: overrides.plz ?? null,
    lon: null,
    lat: null,
    grain,
    ...overrides,
  };
}

function fallbackWithoutCatalogName(kind: AreaKind): AreaCandidate {
  switch (kind) {
    case "lor":
      return area({ geoKey: "lor:plr:07400823", kind, name: "lor:plr:07400823", title: "Planungsraum 07400823" });
    case "quartier":
      return area({ geoKey: "koeln:sq:101010001", kind, name: null, title: "Quartier 123", ags: "05315000" });
    case "ortsteil":
      return area({ geoKey: "ortsteil:osm:5712247", kind, name: null, title: "ortsteil:osm:5712247" });
    case "stadtteil":
      return area({ geoKey: "stadtteil:osm:1", kind, name: "stadtteil:osm:1" });
    case "bezirk":
      return area({ geoKey: "bezirk:11000006", kind, name: "11000006", title: "Bezirk 11000006" });
    case "stadtbezirk":
      return area({ geoKey: "stadtbezirk:12", kind, name: "12", title: "Stadtbezirk 12" });
    case "gemeinde":
      return area({ geoKey: "09162000", kind, grain: "ags", name: "09162000" });
    case "plz":
      return area({ geoKey: "80331", kind, grain: "plz5", name: "80331", plz: "80331" });
    case "grid100":
      return area({ geoKey: "grid100:cell-9", kind, grain: "grid100", name: "cell-9" });
    case "address":
      return area({ geoKey: "address:geo_addr_99", kind, grain: "address", name: null, title: "address:geo_addr_99" });
  }
}

function region(overrides: Partial<AnalysisRegion> = {}): AnalysisRegion {
  return {
    label: "Steglitz-Zehlendorf",
    grain: "ags",
    geoKey: "11000006",
    level: "bezirk",
    parentLabel: "Berlin",
    ags: "11000006",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("hit display names", () => {
  it("drops catalog keys and empty names from visibleAreaName", () => {
    expect(isHiddenCatalogKey("ortsteil:osm:5712247")).toBe(true);
    expect(isHiddenCatalogKey("plz5:12247")).toBe(true);
    expect(isHiddenCatalogKey("12247")).toBe(false);
    expect(visibleAreaName("  Lankwitz  ")).toBe("Lankwitz");
    expect(visibleAreaName("ortsteil:osm:5712247")).toBeNull();
    expect(visibleAreaName("")).toBeNull();
    expect(visibleAreaName(null)).toBeNull();
    expect(textContainsCatalogKey("lor:plr:01100310")).toBe(true);
    expect(textContainsCatalogKey("Die Teilfläche lor:plr:01100310 im Vergleich")).toBe(true);
    expect(textContainsCatalogKey("Lichterfelde-Ost steigt")).toBe(false);
  });

  it("fills name for every grain including documented fallbacks", () => {
    expect(
      displayAreaName(area({ geoKey: "koeln:sq:101010001", kind: "quartier", name: "koeln:sq:101010001", title: "koeln:sq:101010001", ags: "05315000" })),
    ).toBe("Quartier ohne Namen");
    expect(
      displayAreaName(
        area({
          geoKey: "koeln:sq:101010001",
          kind: "quartier",
          name: null,
          title: "Köln Quartier Kapitol-Viertel (101010001)",
          ags: "05315000",
        }),
      ),
    ).toBe("Kapitol-Viertel");
    expect(
      displayAreaName(
        area({
          geoKey: "lor:plr:07400823",
          kind: "lor",
          name: "Wittekindstraße",
          title: "lor:plr:07400823",
          ags: "11000000",
        }),
      ),
    ).toBe("Wittekindstraße");
    expect(
      displayAreaName(area({ geoKey: "lor:plr:07400823", kind: "lor", name: "lor:plr:07400823", title: "lor:plr:07400823", ags: "11000000" })),
    ).toBe("Planungsraum ohne Namen");
    expect(
      displayAreaName(area({ geoKey: "80331", kind: "plz", grain: "plz5", name: "80331", title: "80331", plz: "80331", ags: "09162000" })),
    ).toBe("PLZ 80331");
    expect(
      displayAreaName(area({ geoKey: "cell-1", kind: "grid100", grain: "grid100", name: "cell-1", title: "cell-1" })),
    ).toBe("100-m-Rasterzelle");
    expect(
      displayAreaName(
        area({ geoKey: "address:1", kind: "address", grain: "address", name: "Sendlinger Str. 1", title: "address:1" }),
      ),
    ).toBe("Sendlinger Str. 1");
    expect(
      displayAreaName(area({ geoKey: "ortsteil:osm:5712247", kind: "ortsteil", name: "ortsteil:osm:5712247", title: "ortsteil:osm:5712247" })),
    ).toBe("Ortsteil ohne Namen");
    expect(
      displayAreaName(area({ geoKey: "address:geo_addr_99", kind: "address", grain: "address", name: null, title: "address:geo_addr_99" })),
    ).toBe("Adresse ohne Hausnummer");
    expect(
      displayAreaName(area({ geoKey: "plz5:x", kind: "plz", grain: "plz5", name: null, title: "plz5:x", plz: null })),
    ).toBe("PLZ ohne Namen");
    expect(
      displayAreaName(area({ geoKey: "koeln:sq:123", kind: "quartier", name: null, title: "Quartier 123", ags: "05315000" })),
    ).toBe("Quartier ohne Namen");
    expect(
      displayAreaName(
        area({ geoKey: "koeln:sq:101010001", kind: "quartier", name: "Quartier 101010001", title: "Quartier 101010001" }),
      ),
    ).toBe("Quartier ohne Namen");
  });

  it("never puts osm:, id:, address:, geo_addr, INSPIRE/cell ids, or unbekannt in name", () => {
    const samples: AreaCandidate[] = [
      area({ geoKey: "ortsteil:osm:5712247", kind: "ortsteil", name: null, title: "osm:5712247" }),
      area({ geoKey: "ortsteil:id:12", kind: "ortsteil", name: "id:12", title: "id:12" }),
      area({ geoKey: "address:geo_addr_1", kind: "address", grain: "address", name: "geo_addr_1", title: "Adresse address:geo_addr_1" }),
      area({ geoKey: "grid100:INSPIRE:100mN3278E4552", kind: "grid100", grain: "grid100", name: "INSPIRE:100mN3278E4552", title: "100mN3278E4552" }),
      area({ geoKey: "grid100:cell-9", kind: "grid100", grain: "grid100", name: "cell-9" }),
      area({ geoKey: "plz5:none", kind: "plz", grain: "plz5", name: "unbekannt", plz: null }),
      area({ geoKey: "koeln:sq:101010001", kind: "quartier", name: "koeln:sq:101010001" }),
      area({ geoKey: "bezirk:osm:1", kind: "bezirk", name: "bezirk:osm:1" }),
      area({ geoKey: "lor:plr:07400823", kind: "lor", name: "Wittekindstraße" }),
      area({ geoKey: "lor:plr:07400823", kind: "lor", name: "lor:plr:07400823", title: "Planungsraum 07400823" }),
      area({ geoKey: "80331", kind: "plz", grain: "plz5", name: "80331", plz: "80331" }),
      area({ geoKey: "address:1", kind: "address", grain: "address", name: "Sendlinger Str. 1" }),
    ];
    for (const sample of samples) {
      const name = displayAreaName(sample);
      expect(name.length).toBeGreaterThan(0);
      expect(nameContainsForbiddenToken(name)).toBe(false);
      expect(name).not.toMatch(/osm:|\bid:|address:|geo_addr|unbekannt|inspire/i);
      expect(name).not.toMatch(/\b\d{8}\b/);
      expect(name).not.toMatch(/Quartier\s+\d/i);
      expect(name).not.toMatch(/Planungsraum\s+\d/i);
    }
  });

  it.each(AREA_KINDS)("fallback name for %s never contains a number or id except PLZ and street+hnr", (kind) => {
    const sample = fallbackWithoutCatalogName(kind);
    const name = displayAreaName(sample);
    expect(name.length).toBeGreaterThan(0);
    expect(nameContainsForbiddenToken(name)).toBe(false);
    expect(name).not.toMatch(/osm:|\bid:|address:|geo_addr|unbekannt|inspire|koeln:sq:|lor:plr:/i);
    expect(name).not.toMatch(/Quartier\s+\d/i);
    expect(name).not.toMatch(/Planungsraum\s+\d/i);
    expect(name).not.toMatch(/\b(?:Ortsteil|Stadtteil|Bezirk|Stadtbezirk|Gemeinde)\s+\S*\d/);
    if (kind === "plz") {
      expect(name).toMatch(/^PLZ \d{4,5}$/);
      return;
    }
    if (kind === "grid100") {
      expect(name).toBe("100-m-Rasterzelle");
      return;
    }
    if (kind === "address") {
      expect(name).toBe("Adresse ohne Hausnummer");
      expect(name).not.toMatch(/\d/);
      const withStreet = displayAreaName(
        area({ geoKey: "address:1", kind: "address", grain: "address", name: "Sendlinger Str. 1" }),
      );
      expect(withStreet).toBe("Sendlinger Str. 1");
      return;
    }
    expect(name).not.toMatch(/\d/);
    expect(name).toMatch(/ohne Namen$/);
  });

  it("uses the Gemeinde as parentLabel, never Allach or a PLZ", () => {
    const plz = area({
      geoKey: "80331",
      kind: "plz",
      grain: "plz5",
      name: "80331",
      plz: "80331",
      ags: "09162000",
    });
    const allach = area({
      geoKey: "stadtbezirk:allach",
      kind: "stadtbezirk",
      name: "Allach-Untermenzing",
      ags: "09162000",
    });
    const maxvorstadt = area({
      geoKey: "stadtbezirk:maxvorstadt",
      kind: "stadtbezirk",
      name: "Maxvorstadt",
      ags: "09162000",
    });
    const munich = area({
      geoKey: "09162000",
      kind: "gemeinde",
      grain: "ags",
      name: "München",
      ags: "09162000",
    });
    expect(hitParentLabel(plz, [plz, allach, maxvorstadt, munich], [])).toBe("München");
    expect(hitParentLabel(plz, [plz, allach, maxvorstadt], [])).toBe("München");

    const stadtteil = area({
      geoKey: "stadtteil:osm:altstadt",
      kind: "stadtteil",
      name: "Altstadt-Nord",
      ags: "05315000",
    });
    const plzCologne = area({
      geoKey: "50667",
      kind: "plz",
      grain: "plz5",
      name: "50667",
      plz: "50667",
      ags: "05315000",
    });
    expect(hitParentLabel(stadtteil, [stadtteil, plzCologne], [region({ label: "Innenstadt", level: "bezirk", parentLabel: "Köln", ags: "05315000", geoKey: "bezirk:osm:1" })])).toBe(
      "Köln",
    );

    const lor = area({
      geoKey: "lor:plr:07400823",
      kind: "lor",
      name: "Wittekindstraße",
      ags: "11000000",
    });
    expect(hitParentLabel(lor, [lor], [region({ label: "Tempelhof", level: "ortsteil", parentLabel: "Berlin", ags: "11000000", geoKey: "ortsteil:osm:162894" })])).toBe(
      "Berlin",
    );
  });

  it("falls back to the Zielregion Gemeinde when the region is a Bezirk", () => {
    const lankwitz = area({
      geoKey: "ortsteil:osm:5712247",
      kind: "ortsteil",
      name: "Lankwitz",
      ags: "11000006",
    });
    expect(hitParentLabel(lankwitz, [lankwitz], [region()])).toBe("Berlin");
  });

  it("leaves parentLabel empty on a Gemeinde and never uses a key", () => {
    const munich = area({
      geoKey: "09162000",
      kind: "gemeinde",
      grain: "ags",
      name: "München",
      ags: "09162000",
    });
    expect(
      hitParentLabel(munich, [munich], [
        region({ label: "München", geoKey: "09162000", ags: "09162000", level: "gemeinde", parentLabel: null }),
      ]),
    ).toBeNull();
  });

  it("covers Hamburg Stadtteil parentLabel as Hamburg", () => {
    const altona = area({
      geoKey: "ortsteil:osm:altona",
      kind: "ortsteil",
      name: "Altona-Altstadt",
      ags: "02000000",
    });
    expect(
      hitParentLabel(altona, [altona], [
        region({ label: "Altona-Altstadt", level: "ortsteil", parentLabel: "Hamburg", ags: "02000000", geoKey: "ortsteil:osm:altona" }),
      ]),
    ).toBe("Hamburg");
  });

  it("never gives a Berliner LOR a Kölner parentLabel even when ags is null", () => {
    const koeln = region({
      label: "Innenstadt",
      level: "bezirk",
      parentLabel: "Köln",
      ags: null,
      geoKey: "bezirk:osm:2613798",
    });
    const tempelhof = region({
      label: "Tempelhof",
      level: "ortsteil",
      parentLabel: "Berlin",
      ags: null,
      geoKey: "ortsteil:osm:162894",
    });
    const lor = area({
      geoKey: "lor:plr:07400823",
      kind: "lor",
      name: "Wittekindstraße",
      ags: null,
      targetRegionGeoKey: "ortsteil:osm:162894",
    });
    expect(hitParentLabel(lor, [lor], [koeln, tempelhof])).toBe("Berlin");
    expect(hitParentLabel(lor, [lor], [koeln, tempelhof])).not.toBe("Köln");
    expect(hitParentLabel(lor, [lor], [koeln, tempelhof])).not.toBe("Innenstadt");

    const unnamed = area({
      geoKey: "lor:plr:07400823",
      kind: "lor",
      name: "Wittekindstraße",
      ags: null,
    });
    expect(hitParentLabel(unnamed, [unnamed], [koeln, tempelhof])).not.toBe("Köln");
    expect(hitParentLabel(unnamed, [unnamed], [koeln, tempelhof])).not.toBe("Innenstadt");
  });
});
