import { buildPatternByLevel, canonicalPatternLevel, criteriaForPatternLevel } from "./pattern-profile";
import { YearlySeries } from "./yearly-series";

function series(overrides: Partial<YearlySeries> & Pick<YearlySeries, "metricId" | "requestedLevel" | "requestedGeoKey">): YearlySeries {
  return {
    sourceLevel: overrides.requestedLevel,
    sourceGeoKey: overrides.requestedGeoKey,
    granularity: "year",
    coverage: "multi",
    points: [
      { period: "2023", status: "present", value: 20 },
      { period: "2024", status: "present", value: 15 },
      { period: "2025", status: "present", value: 10 },
    ],
    ...overrides,
  };
}

describe("buildPatternByLevel", () => {
  it("mirrors every store Ebene and keeps Kreis as frame", () => {
    const profiles = buildPatternByLevel(
      [
        { grain: "address", geoKey: "address:1", level: "address" },
        { grain: "grid100", geoKey: "cell-1", level: "grid100" },
        { grain: "other", geoKey: "lor:plr:01100101", level: "lor" },
        { grain: "other", geoKey: "koeln:sq:1", level: "quartier" },
        { grain: "other", geoKey: "ortsteil:osm:1", level: "stadtteil" },
        { grain: "plz5", geoKey: "50667", plz: "50667", level: "plz" },
        { grain: "other", geoKey: "stadtbezirk:1", level: "stadtbezirk" },
        { grain: "ags", geoKey: "05315000", ags: "05315000", level: "gemeinde" },
        { grain: "ags5", geoKey: "05315", ags: "05315", level: "kreis" },
      ],
      [
        series({
          metricId: "unfallatlas",
          requestedLevel: "ortsteil",
          requestedGeoKey: "ortsteil:osm:1",
          sourceLevel: "ortsteil",
        }),
        series({
          metricId: "bevoelkerung",
          requestedLevel: "plz",
          requestedGeoKey: "50667",
          sourceLevel: "gemeinde",
          sourceGeoKey: "05315000",
        }),
        series({
          metricId: "destatis",
          requestedLevel: "kreis",
          requestedGeoKey: "05315",
          sourceLevel: "kreis",
        }),
        series({
          metricId: "breitband",
          requestedLevel: "ortsteil",
          requestedGeoKey: "ortsteil:osm:1",
          coverage: "none",
          points: [
            { period: "2023", status: "absent" },
            { period: "2024", status: "absent" },
            { period: "2025", status: "absent" },
          ],
        }),
      ],
    );

    expect(profiles.map((item) => item.level)).toEqual([
      "address",
      "grid100",
      "lor",
      "quartier",
      "ortsteil",
      "plz",
      "bezirk",
      "gemeinde",
      "kreis",
    ]);
    expect(canonicalPatternLevel("stadtteil")).toBe("ortsteil");
    expect(canonicalPatternLevel("stadtbezirk")).toBe("bezirk");
    expect(profiles.find((item) => item.level === "kreis")?.role).toBe("frame");
    expect(profiles.filter((item) => item.level !== "kreis").every((item) => item.role === "pattern")).toBe(true);

    const ortsteil = profiles.find((item) => item.level === "ortsteil");
    expect(ortsteil?.geoKeys).toEqual(["ortsteil:osm:1"]);
    expect(ortsteil?.criteria[0]?.key).toBe("unfallatlas");
    expect(ortsteil?.criteria[0]?.scope).toBe("local");
    expect(ortsteil?.yearlySeries.find((item) => item.metricId === "breitband")).toBeUndefined();
    expect(JSON.stringify(ortsteil?.yearlySeries)).not.toMatch(/"value":0/);

    const plz = profiles.find((item) => item.level === "plz");
    expect(plz?.criteria[0]?.scope).toBe("inherited");
    expect(plz?.criteria[0]?.sourceLevel).toBe("gemeinde");

    expect(criteriaForPatternLevel("ortsteil", profiles, [])[0]?.key).toBe("unfallatlas");
    expect(criteriaForPatternLevel("stadtteil", profiles, [])[0]?.key).toBe("unfallatlas");
    expect(criteriaForPatternLevel("kreis", profiles, [{ key: "x", label: "x", direction: "up", evidence: "x" }])).toEqual(
      [],
    );
    expect(criteriaForPatternLevel("grid100", profiles, [])).toEqual([]);
  });
});
