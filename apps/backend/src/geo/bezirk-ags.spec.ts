import {
  canonicalBerlinBezirkAgs,
  canonicalRegionKeys,
  canonicalizePlaceKey,
  isOfficialBerlinBezirkAgs,
  isRegionalstatistikBerlinBezirkAgs,
  regionalstatistikBerlinBezirkAgs,
} from "./bezirk-ags";

describe("Berlin Bezirk AGS", () => {
  it("maps the doubled alias onto the official Bezirk id", () => {
    expect(canonicalBerlinBezirkAgs("11006006")).toBe("11000006");
    expect(canonicalBerlinBezirkAgs("11007007")).toBe("11000007");
    expect(canonicalBerlinBezirkAgs("11001001")).toBe("11000001");
    expect(canonicalBerlinBezirkAgs("11012012")).toBe("11000012");
    expect(canonicalizePlaceKey("ags:11006006")).toBe("ags:11000006");
  });

  it("leaves official ids, Berlin as a whole, and other AGS unchanged", () => {
    expect(canonicalBerlinBezirkAgs("11000006")).toBe("11000006");
    expect(canonicalBerlinBezirkAgs("11000000")).toBe("11000000");
    expect(canonicalBerlinBezirkAgs("09162000")).toBe("09162000");
    expect(isOfficialBerlinBezirkAgs("11000006")).toBe(true);
    expect(isOfficialBerlinBezirkAgs("11000000")).toBe(false);
    expect(isOfficialBerlinBezirkAgs("11006006")).toBe(false);
    expect(isRegionalstatistikBerlinBezirkAgs("11007007")).toBe(true);
    expect(isRegionalstatistikBerlinBezirkAgs("11000007")).toBe(false);
    expect(regionalstatistikBerlinBezirkAgs("11000007")).toBe("11007007");
    expect(regionalstatistikBerlinBezirkAgs("11007007")).toBe("11007007");
    expect(regionalstatistikBerlinBezirkAgs("11000000")).toBeNull();
  });

  it("persists canonical geoKey and ags together", () => {
    expect(canonicalRegionKeys({ geoKey: "11007007", ags: "11007007" })).toEqual({
      geoKey: "11000007",
      ags: "11000007",
    });
    expect(canonicalRegionKeys({ geoKey: "ags:11006006", ags: null })).toEqual({
      geoKey: "ags:11000006",
      ags: "11000006",
    });
    expect(canonicalRegionKeys({ geoKey: "09162000", ags: null })).toEqual({
      geoKey: "09162000",
      ags: null,
    });
  });
});
