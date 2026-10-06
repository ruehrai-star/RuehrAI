import { AnalysisRegion } from "../analysis/types";
import { AreaCandidate } from "./area-candidates";
import { hitParentLabel, isHiddenCatalogKey, visibleAreaName } from "./hit-display";

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
  it("drops catalog keys and empty names", () => {
    expect(isHiddenCatalogKey("ortsteil:osm:5712247")).toBe(true);
    expect(isHiddenCatalogKey("plz5:12247")).toBe(true);
    expect(isHiddenCatalogKey("12247")).toBe(false);
    expect(visibleAreaName("  Lankwitz  ")).toBe("Lankwitz");
    expect(visibleAreaName("ortsteil:osm:5712247")).toBeNull();
    expect(visibleAreaName("")).toBeNull();
    expect(visibleAreaName(null)).toBeNull();
  });

  it("uses the Bezirk name as parent of an Ortsteil when that Bezirk is in the pool", () => {
    const lankwitz = area({
      geoKey: "ortsteil:osm:5712247",
      kind: "ortsteil",
      name: "Lankwitz",
      ags: "11000006",
    });
    const bezirk = area({
      geoKey: "11000006",
      kind: "bezirk",
      grain: "ags",
      name: "Steglitz-Zehlendorf",
      ags: "11000006",
    });
    expect(hitParentLabel(lankwitz, [lankwitz, bezirk], [])).toBe("Steglitz-Zehlendorf");
  });

  it("falls back to the Zielregion label when the region is the parent Bezirk", () => {
    const lankwitz = area({
      geoKey: "ortsteil:osm:5712247",
      kind: "ortsteil",
      name: "Lankwitz",
      ags: "11000006",
    });
    expect(hitParentLabel(lankwitz, [lankwitz], [region()])).toBe("Steglitz-Zehlendorf");
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
    const keyed = area({
      geoKey: "ortsteil:osm:1",
      kind: "ortsteil",
      name: "Schwabing",
      ags: "09162000",
    });
    const parentKey = area({
      geoKey: "09162000",
      kind: "gemeinde",
      grain: "ags",
      name: "ags:09162000",
      title: "ags:09162000",
      ags: "09162000",
    });
    expect(hitParentLabel(keyed, [keyed, parentKey], [])).toBeNull();
  });
});
