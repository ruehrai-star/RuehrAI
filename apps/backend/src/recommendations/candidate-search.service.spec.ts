import { DatabaseService } from "../database/database.service";
import { AnalysisRegion } from "../analysis/types";
import { CandidateSearchService } from "./candidate-search.service";

const columns = [
  "id",
  "geo_key",
  "grain",
  "ref_period",
  "name",
  "title",
  "metadata",
  "lon",
  "lat",
].map((column_name) => ({ column_name }));

function region(): AnalysisRegion {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("CandidateSearchService", () => {
  const queryReadingFeatures = jest.fn();
  const service = new CandidateSearchService({
    queryReadingFeatures,
  } as unknown as DatabaseService);

  beforeEach(() => {
    queryReadingFeatures.mockReset();
  });

  it("returns no rows when Brain relations are missing", async () => {
    queryReadingFeatures.mockResolvedValue({ rows: [] });
    await expect(service.load(region(), ["2026-09"])).resolves.toEqual({
      rows: [],
      truncated: false,
    });
  });

  it("reads the document table with the region and the month window", async () => {
    queryReadingFeatures
      .mockResolvedValueOnce({ rows: columns })
      .mockResolvedValueOnce({ rows: columns })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "4",
            geo_key: "80801",
            grain: "plz5",
            name: "Schwabing",
            ref_period: "2026-09",
            title: "Schwabing",
            metadata: { einwohner: 20, geo_ags: "09162000" },
            lon: "11.58",
            lat: "48.16",
          },
        ],
      });

    const loaded = await service.load(region(), ["2026-04", "2026-09"]);
    expect(loaded.truncated).toBe(false);
    expect(loaded.rows[0]).toMatchObject({
      geoKey: "80801",
      grain: "plz5",
      lon: 11.58,
      lat: 48.16,
    });
    const sql = String(queryReadingFeatures.mock.calls[2]?.[0]);
    expect(sql).toContain("features.location_feature_docs");
    expect(queryReadingFeatures.mock.calls[2]?.[1]).toEqual([
      "09162000",
      null,
      "09162000",
      null,
      ["2026-04", "2026-09"],
    ]);
  });
});
