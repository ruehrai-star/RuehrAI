import { classifyFactGeo } from "./pattern-geo";
import { AnalysisRegion } from "./types";

describe("classifyFactGeo", () => {
  const koelnKreis = region({
    label: "Köln",
    grain: "ags5",
    geoKey: "05315",
    ags: "05315",
  });

  it("keeps Köln ags5 and ags8 and rejects Dortmund and Düsseldorf", () => {
    expect(classifyFactGeo({ geoKey: "05315", grain: "ags5" }, [koelnKreis])?.tier).toBe("requested");
    expect(classifyFactGeo({ geoKey: "05315000", grain: "ags" }, [koelnKreis])?.tier).toBe("kreis");
    expect(classifyFactGeo({ geoKey: "ags5:05315", grain: "ags5" }, [koelnKreis])).not.toBeNull();
    expect(classifyFactGeo({ geoKey: "05913000", grain: "ags" }, [koelnKreis])).toBeNull();
    expect(classifyFactGeo({ geoKey: "05111000", grain: "ags" }, [koelnKreis])).toBeNull();
    expect(classifyFactGeo({ geoKey: "05913", grain: "ags5" }, [koelnKreis])).toBeNull();
  });

  it("does not treat another NRW AGS8 as Land 05", () => {
    expect(classifyFactGeo({ geoKey: "05", grain: "other" }, [koelnKreis])?.tier).toBe("land");
    expect(classifyFactGeo({ geoKey: "land:05", grain: "other" }, [koelnKreis])?.tier).toBe("land");
    expect(classifyFactGeo({ geoKey: "05913000", grain: "ags" }, [koelnKreis])).toBeNull();
  });

  it("marks Destatis Kreis as higher than an Ortsteil request", () => {
    const deutz = region({
      label: "Deutz",
      grain: "other",
      geoKey: "ortsteil:osm:deutz",
      ags: "05315000",
      level: "ortsteil",
    });
    const match = classifyFactGeo({ geoKey: "05315", grain: "ags5" }, [deutz]);
    expect(match?.tier).toBe("kreis");
    expect(match?.sourceLevel).toBe("kreis");
    expect(match?.requestedLevel).toBe("ortsteil");
  });
});

function region(overrides: Partial<AnalysisRegion>): AnalysisRegion {
  return {
    label: "Köln",
    grain: "ags5",
    geoKey: "05315",
    ags: "05315",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
