import { DatabaseService } from "../database/database.service";
import { AnalysisRegion } from "../analysis/types";
import { AreaCandidateService } from "./area-candidate.service";
import { buildAreaCandidateSql } from "./area-candidates";

function region(overrides: Partial<AnalysisRegion> = {}): AnalysisRegion {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [11.4, 48.0],
          [11.7, 48.0],
          [11.7, 48.3],
          [11.4, 48.3],
          [11.4, 48.0],
        ],
      ],
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AreaCandidateService", () => {
  const queryReadingFeatures = jest.fn();
  const service = new AreaCandidateService({ queryReadingFeatures } as unknown as DatabaseService);

  beforeEach(() => {
    queryReadingFeatures.mockReset();
  });

  it("drops the region anchor even if geo_ref returned it", async () => {
    queryReadingFeatures.mockResolvedValue({
      rows: [
        {
          geo_key: "09162000",
          grain: "ags",
          kind: "gemeinde",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: 11.5,
          lat: 48.1,
        },
        {
          geo_key: "ortsteil:osm:1",
          grain: "other",
          kind: "ortsteil",
          name: "Schwabing",
          ags: "09162000",
          plz: null,
          lon: 11.58,
          lat: 48.16,
        },
      ],
    });

    const loaded = await service.load([region()]);
    expect(loaded.items.map((item) => item.geoKey)).toEqual(["ortsteil:osm:1"]);
    expect(loaded.items.map((item) => item.id)).not.toContain("ags:09162000");
    expect(String(queryReadingFeatures.mock.calls[0]?.[0])).toBe(buildAreaCandidateSql());
    expect(queryReadingFeatures.mock.calls[0]?.[1]?.[3]).toBe("09162000");
  });

  it("returns an empty list only when geo_ref has no sub-area", async () => {
    queryReadingFeatures.mockResolvedValue({ rows: [] });
    await expect(service.load([region()])).resolves.toEqual({ items: [], truncated: false });
  });

  it("swallows a missing geo catalog", async () => {
    queryReadingFeatures.mockRejectedValue(
      Object.assign(new Error('relation "geo.geo_ref_ortsteil" does not exist'), { code: "42P01" }),
    );
    await expect(service.load([region()])).resolves.toEqual({ items: [], truncated: false });
  });
});
