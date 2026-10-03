import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { SearchService } from "./search.service";

describe("SearchService", () => {
  const query = jest.fn();
  const queryReadingFeatures = jest.fn();
  const geoSearch = jest.fn();
  let service: SearchService;

  beforeEach(async () => {
    query.mockReset();
    queryReadingFeatures.mockReset();
    geoSearch.mockReset();
    geoSearch.mockResolvedValue([]);
    query.mockResolvedValue({
      rows: [
        {
          id: "ags:09162000",
          label: "München",
          grain: "ags",
          geo_key: "09162000",
          lon: "11.5755",
          lat: 48.1374,
        },
      ],
    });
    queryReadingFeatures.mockRejectedValue(
      Object.assign(new Error('relation "features.v_location_search" does not exist'), {
        code: "42P01",
      }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: DatabaseService, useValue: { query, queryReadingFeatures } },
        { provide: GeoCatalogService, useValue: { search: geoSearch } },
      ],
    }).compile();
    service = moduleRef.get(SearchService);
  });

  it("falls back to the app seed when the feature view is missing", async () => {
    const result = await service.search({
      q: "München%",
      type: "ags",
      ags: "09162000",
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("app.search_places");
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).not.toContain("München");
    expect(sql).not.toContain("09162000");
    expect(params).toEqual(["09162000", null, null, "%München\\%%", "ags", null, null]);
    expect(result.hits).toEqual([
      {
        id: "ags:09162000",
        label: "München",
        grain: "ags",
        geoKey: "09162000",
        lon: 11.5755,
        lat: 48.1374,
      },
    ]);
  });

  it("queries the feature view by name, grain, and geo_key and keeps null coordinates", async () => {
    queryReadingFeatures
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ has_rows: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "42",
            label: "Alpha Ort",
            grain: "ags",
            geo_key: "04011000",
            lon: null,
            lat: null,
          },
        ],
      });

    const result = await service.search({
      q: "Alpha%",
      grain: "ags",
      geoKey: "04011000",
    });

    const [sql, params] = queryReadingFeatures.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("features.v_location_search");
    expect(sql).not.toContain("Alpha");
    expect(sql).not.toContain("04011000");
    expect(params).toEqual([null, null, null, "%Alpha\\%%", null, "04011000", "ags"]);
    expect(query).not.toHaveBeenCalled();
    expect(result.hits).toEqual([
      {
        id: "42",
        label: "Alpha Ort",
        grain: "ags",
        geoKey: "04011000",
        lon: null,
        lat: null,
      },
    ]);
  });

  it("uses the seed catalog when the feature view has no rows", async () => {
    queryReadingFeatures.mockReset().mockResolvedValue({ rows: [{ has_rows: false }] });
    await service.search({ q: "München" });
    expect(query.mock.calls[0][0]).toContain("app.search_places");
  });

  it("merges the geo catalog and drops a duplicate Berlin Bezirk", async () => {
    queryReadingFeatures.mockReset().mockResolvedValue({ rows: [{ has_rows: false }] });
    query.mockResolvedValue({
      rows: [
        {
          id: "ags:11000001",
          label: "Berlin-Mitte",
          grain: "ags",
          geo_key: "11000001",
          lon: 13.36,
          lat: 52.52,
        },
      ],
    });
    geoSearch.mockResolvedValue([
      {
        id: "ags:11000001",
        label: "Mitte",
        grain: "ags",
        geoKey: "11000001",
        level: "bezirk",
        parentLabel: "Berlin",
        geoAgs: "11000000",
        lon: 13.37,
        lat: 52.53,
      },
      {
        id: "stadtteil:schwabing",
        label: "Schwabing",
        grain: "other",
        geoKey: "stadtteil:schwabing",
        level: "stadtteil",
        parentLabel: "München",
        geoAgs: "09162000",
        lon: 11.58,
        lat: 48.16,
      },
    ]);

    const result = await service.search({ q: "Mitte" });
    expect(result.hits).toEqual([
      {
        id: "ags:11000001",
        label: "Mitte",
        grain: "ags",
        geoKey: "11000001",
        level: "bezirk",
        parentLabel: "Berlin",
        geoAgs: "11000000",
        lon: 13.37,
        lat: 52.53,
      },
      {
        id: "stadtteil:schwabing",
        label: "Schwabing",
        grain: "other",
        geoKey: "stadtteil:schwabing",
        level: "stadtteil",
        parentLabel: "München",
        geoAgs: "09162000",
        lon: 11.58,
        lat: 48.16,
      },
    ]);
  });
});
