import { buildPatternByDataset, buildPatternByLevel, canonicalPatternLevel } from "./pattern-profile";
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
          requestedLevel: "ortsteil",
          requestedGeoKey: "ortsteil:osm:1",
          sourceLevel: "ortsteil",
          sourceGeoKey: "ortsteil:osm:1",
          points: [
            { period: "2023", status: "present", value: 10_000 },
            { period: "2024", status: "present", value: 10_000 },
            { period: "2025", status: "present", value: 10_000 },
          ],
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
  });
});

describe("buildPatternByDataset", () => {
  it("exposes one normalized Musterprofil per dataset at the finest store Fläche", () => {
    const profiles = buildPatternByDataset([
      series({
        metricId: "kba_elektro_pkw",
        requestedLevel: "bezirk",
        requestedGeoKey: "11000001",
        sourceLevel: "bezirk",
        sourceGeoKey: "11000001",
        points: [
          { period: "2023", status: "present", value: 20 },
          { period: "2025", status: "present", value: 40 },
        ],
      }),
      series({
        metricId: "bevoelkerung",
        requestedLevel: "bezirk",
        requestedGeoKey: "11000001",
        sourceLevel: "bezirk",
        sourceGeoKey: "11000001",
        points: [
          { period: "2023", status: "present", value: 10_000 },
          { period: "2025", status: "present", value: 10_000 },
        ],
      }),
      series({
        metricId: "kba_elektro_pkw",
        requestedLevel: "plz",
        requestedGeoKey: "50667",
        sourceLevel: "plz",
        sourceGeoKey: "50667",
        points: [
          { period: "2023", status: "present", value: 4 },
          { period: "2025", status: "present", value: 8 },
        ],
      }),
      series({
        metricId: "bevoelkerung",
        requestedLevel: "plz",
        requestedGeoKey: "50667",
        sourceLevel: "plz",
        sourceGeoKey: "50667",
        points: [
          { period: "2023", status: "present", value: 2_000 },
          { period: "2025", status: "present", value: 2_000 },
        ],
      }),
    ]);

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      metricId: "kba_elektro_pkw",
      baseline: "per_1000_inhabitants",
      sourceLevel: "plz",
      sourceGeoKey: "50667",
    });
    expect(profiles[0]?.criterion.normalizedValue).toBe(4);
    expect(profiles[0]?.criterion.rawValue).toBe(8);
    expect(profiles[0]?.criterion.kind).toBe("trend");
    expect(profiles[0]?.criterion.direction).toBe("up");
    expect(profiles.find((item) => item.metricId === "bevoelkerung")).toBeUndefined();
  });
});
