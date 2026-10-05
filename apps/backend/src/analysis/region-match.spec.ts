import { filterYearlySeries, matchingGeoKeys, placeKeysMatch } from "./region-match";
import { YearlySeries } from "./yearly-series";

describe("matchingGeoKeys", () => {
  it("rewrites a Berlin Bezirk alias onto the official AGS and keeps both", () => {
    const keys = matchingGeoKeys("11006006");
    expect(keys).toEqual(expect.arrayContaining(["11006006", "11000006", "ags:11000006", "ags:11006006"]));
  });

  it("treats an ags: prefix as the same catalog place", () => {
    expect(placeKeysMatch("ags:09162000", "09162000")).toBe(true);
    expect(placeKeysMatch("ortsteil:osm:5712247", "ortsteil:osm:5712247")).toBe(true);
    expect(placeKeysMatch("09162000", "11000001")).toBe(false);
  });
});

describe("filterYearlySeries", () => {
  it("keeps only rows whose requestedGeoKey matches after key normalization", () => {
    const series = [
      row("09162000"),
      row("11000001"),
      row("ags:09162000"),
    ];
    expect(filterYearlySeries(series, "09162000").map((item) => item.requestedGeoKey)).toEqual([
      "09162000",
      "ags:09162000",
    ]);
  });
});

function row(requestedGeoKey: string): YearlySeries {
  return {
    metricId: "bevoelkerung",
    requestedLevel: "gemeinde",
    requestedGeoKey,
    sourceLevel: "gemeinde",
    sourceGeoKey: requestedGeoKey,
    granularity: "year",
    coverage: "single",
    points: [{ period: "2025", status: "present", value: 1 }],
  };
}
