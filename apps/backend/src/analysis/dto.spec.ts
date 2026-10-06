import { AnalysisPatternQueryDto, CreateAnalysisRunDto, markedTargetRegionFromCreate } from "./dto";

describe("markedTargetRegionFromCreate", () => {
  it("prefers markedTargetRegionGeoKey over body and query geoKey", () => {
    const body: CreateAnalysisRunDto = {
      markedTargetRegionGeoKey: "ortsteil:osm:55737",
      geoKey: "ortsteil:osm:162894",
    };
    const query: AnalysisPatternQueryDto = { geoKey: "ags:09162000" };
    expect(markedTargetRegionFromCreate(body, query)).toBe("ortsteil:osm:55737");
  });

  it("uses the web client's body geoKey, then ?geoKey=", () => {
    expect(markedTargetRegionFromCreate({ geoKey: "ortsteil:osm:162894" })).toBe("ortsteil:osm:162894");
    expect(markedTargetRegionFromCreate({}, { geoKey: "ortsteil:osm:162894" })).toBe("ortsteil:osm:162894");
    expect(markedTargetRegionFromCreate()).toBeUndefined();
  });
});
