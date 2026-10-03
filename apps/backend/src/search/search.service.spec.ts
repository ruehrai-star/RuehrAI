import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { SearchService } from "./search.service";

describe("SearchService", () => {
  const query = jest.fn();
  const queryReadingFeatures = jest.fn();
  const geoSearch = jest.fn();
  const lookupAdminNames = jest.fn();
  let service: SearchService;

  beforeEach(async () => {
    query.mockReset();
    queryReadingFeatures.mockReset();
    geoSearch.mockReset();
    lookupAdminNames.mockReset();
    geoSearch.mockResolvedValue([]);
    lookupAdminNames.mockResolvedValue(new Map());
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
        { provide: GeoCatalogService, useValue: { search: geoSearch, lookupAdminNames } },
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
    expect(params).toEqual(["09162000", null, null, "%München\\%%", "ags", null, null, false]);
    expect(result.hits).toEqual([
      {
        id: "ags:09162000",
        label: "München",
        grain: "ags",
        geoKey: "09162000",
        level: "gemeinde",
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
    expect(params).toEqual([null, null, null, "%Alpha\\%%", null, "04011000", "ags", false]);
    expect(query).not.toHaveBeenCalled();
    expect(result.hits).toEqual([
      {
        id: "42",
        label: "Alpha Ort",
        grain: "ags",
        geoKey: "04011000",
        level: "gemeinde",
        lon: null,
        lat: null,
      },
    ]);
  });

  it("classifies official AGS districts as stadtbezirk and copies catalog parentLabel", async () => {
    queryReadingFeatures.mockReset().mockResolvedValue({ rows: [{ has_rows: false }] });
    query.mockResolvedValue({
      rows: [
        {
          id: "ags:09162004",
          label: "Bezirk München Schwabing-West",
          grain: "ags",
          geo_key: "09162004",
          lon: 11.57,
          lat: 48.17,
        },
        {
          id: "ags:09162001",
          label: "Bezirk München Altstadt-Lehel",
          grain: "ags",
          geo_key: "09162001",
          lon: 11.58,
          lat: 48.14,
        },
        {
          id: "ags:09162000",
          label: "München",
          grain: "ags",
          geo_key: "09162000",
          lon: 11.58,
          lat: 48.14,
        },
      ],
    });
    geoSearch.mockResolvedValue([
      {
        id: "stadtbezirk:osm:54383",
        label: "Allach-Untermenzing",
        grain: "other",
        geoKey: "stadtbezirk:osm:54383",
        level: "stadtbezirk",
        parentLabel: "München",
        geoAgs: "09162000",
        lon: 11.46,
        lat: 48.2,
      },
    ]);
    lookupAdminNames.mockResolvedValue(new Map([["09162000", "München"]]));

    const result = await service.search({ q: "München" });
    const byKey = Object.fromEntries(result.hits.map((hit) => [hit.geoKey, hit]));
    expect(byKey["09162000"]).toMatchObject({ level: "gemeinde", label: "München" });
    expect(byKey["09162000"]?.parentLabel).toBeUndefined();
    expect(byKey["09162004"]).toMatchObject({
      label: "Bezirk München Schwabing-West",
      grain: "ags",
      level: "stadtbezirk",
      parentLabel: "München",
    });
    expect(byKey["09162001"]).toMatchObject({
      label: "Bezirk München Altstadt-Lehel",
      level: "stadtbezirk",
      parentLabel: "München",
    });
    expect(byKey["stadtbezirk:osm:54383"]).toMatchObject({
      level: "stadtbezirk",
      parentLabel: "München",
    });
    expect(result.hits.some((hit) => hit.geoKey === "09162004" && hit.level === "gemeinde")).toBe(false);
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
    expect(geoSearch).toHaveBeenCalledWith({ q: "Mitte" });
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

  it("keeps PLZ 12247 for a digit query and drops osm-key Ortsteile and nameless rows", async () => {
    queryReadingFeatures.mockReset().mockResolvedValue({ rows: [{ has_rows: false }] });
    query.mockResolvedValue({ rows: [] });
    geoSearch.mockResolvedValue([
      {
        id: "plz5:12247",
        label: "12247",
        grain: "plz5",
        geoKey: "12247",
        level: "plz",
        parentLabel: "Berlin",
        geoAgs: "11000000",
        lon: 13.34,
        lat: 52.44,
      },
    ]);

    const digits = await service.search({ q: "12247" });
    expect(digits.hits.map((hit) => hit.id)).toEqual(["plz5:12247"]);
    expect(digits.hits[0]).toMatchObject({
      id: "plz5:12247",
      label: "12247",
      level: "plz",
      parentLabel: "Berlin",
    });

    geoSearch.mockResolvedValue([
      {
        id: "ortsteil:osm:5712247",
        label: "Lankwitz",
        grain: "other",
        geoKey: "ortsteil:osm:5712247",
        level: "ortsteil",
        parentLabel: "Berlin",
        geoAgs: "11000000",
        lon: 13.34,
        lat: 52.43,
      },
    ]);
    geoSearch.mockClear();
    await expect(service.search({ q: "ortsteil:osm:5712247" })).resolves.toEqual({ hits: [] });
    await expect(service.search({ q: "plz5:12247" })).resolves.toEqual({ hits: [] });
    expect(geoSearch).not.toHaveBeenCalled();
  });

  it("drops PLZ rows on a name query and never returns a blank label", async () => {
    queryReadingFeatures.mockReset().mockResolvedValue({ rows: [{ has_rows: false }] });
    query.mockResolvedValue({
      rows: [
        {
          id: "plz5:80331",
          label: "80331 München",
          grain: "plz5",
          geo_key: "80331",
          lon: 11.57,
          lat: 48.13,
        },
        {
          id: "ags:09162000",
          label: "   ",
          grain: "ags",
          geo_key: "09162000",
          lon: 11.57,
          lat: 48.13,
        },
      ],
    });
    geoSearch.mockResolvedValue([
      {
        id: "plz5:80331",
        label: "80331",
        grain: "plz5",
        geoKey: "80331",
        level: "plz",
        parentLabel: "München",
        geoAgs: "09162000",
        lon: 11.57,
        lat: 48.13,
      },
      {
        id: "stadtteil:s-schwabing",
        label: "Schwabing",
        grain: "other",
        geoKey: "stadtteil:s-schwabing",
        level: "stadtteil",
        parentLabel: "München",
        geoAgs: "09162000",
        lon: 11.58,
        lat: 48.16,
      },
    ]);

    const named = await service.search({ q: "München" });
    expect(named.hits.every((hit) => hit.level !== "plz" && hit.grain !== "plz5")).toBe(true);
    expect(named.hits.map((hit) => hit.id)).toEqual(["stadtteil:s-schwabing"]);
    expect(named.hits.every((hit) => hit.label.trim().length > 0)).toBe(true);
  });

  it("returns one hit per geo key and keeps distinct Berlin places", async () => {
    queryReadingFeatures.mockReset().mockResolvedValue({ rows: [{ has_rows: false }] });
    query.mockResolvedValue({
      rows: [
        agsRow("8379", "Berlin, Stadt", "11000000", 13.405, 52.52),
        agsRow("26787", "Berlin, Stadt", "11000000", 13.405, 52.52),
        agsRow("40354", "Berlin, Stadt", "11000000", 13.404954, 52.520008),
        agsRow("14287", "Berlin", "11000000", 13.405, 52.52),
        agsRow("11000-1", "Berlin, kreisfreie Stadt", "11000", 13.4, 52.52),
        agsRow("07233004-a", "Berlingen", "07233004", 6.45, 50.03),
        agsRow("07233004-b", "Berlingen", "07233004", 6.45, 50.03),
        agsRow("07233004-c", "Berlingen", "07233004", 6.45, 50.03),
        agsRow("16061003-a", "Berlingerode", "16061003", 10.24, 51.46),
        agsRow("16061003-b", "Berlingerode", "16061003", 10.24, 51.46),
        agsRow("16061003-c", "Berlingerode", "16061003", 10.24, 51.46),
        agsRow("12060020-a", "Bernau bei Berlin, Stadt", "12060020", 13.59, 52.68),
        agsRow("12060020-b", "Bernau bei Berlin, Stadt", "12060020", 13.59, 52.68),
        agsRow("12060020-c", "Bernau bei Berlin, Stadt", "12060020", 13.59, 52.68),
      ],
    });
    geoSearch.mockResolvedValue([
      {
        id: "ags:11000012",
        label: "Berlin-Treptow-Köpenick",
        grain: "ags",
        geoKey: "11000012",
        level: "bezirk",
        parentLabel: "Berlin",
        geoAgs: "11000000",
        lon: 13.58,
        lat: 52.45,
      },
      {
        id: "stadtteil:berlinchen",
        label: "Berlinchen",
        grain: "other",
        geoKey: "stadtteil:berlinchen",
        level: "stadtteil",
        parentLabel: "Wittstock/Dosse",
        geoAgs: "12070040",
        lon: 12.51,
        lat: 53.16,
      },
      {
        id: "stadtteil:berliner-chaussee",
        label: "Berliner Chaussee",
        grain: "other",
        geoKey: "stadtteil:berliner-chaussee",
        level: "stadtteil",
        parentLabel: "Magdeburg",
        geoAgs: "15003000",
        lon: 11.66,
        lat: 52.12,
      },
      {
        id: "stadtteil:berliner-platz",
        label: "Berliner Platz",
        grain: "other",
        geoKey: "stadtteil:berliner-platz",
        level: "stadtteil",
        parentLabel: "Erfurt",
        geoAgs: "16051000",
        lon: 11.03,
        lat: 50.98,
      },
    ]);

    const result = await service.search({ q: "Berlin" });
    const labels = result.hits.map((hit) => hit.label);
    const byKey = Object.fromEntries(result.hits.map((hit) => [hit.geoKey, hit]));

    expect(labels.filter((label) => label === "Berlin" || label === "Berlin, Stadt")).toHaveLength(1);
    expect(byKey["11000000"]).toMatchObject({
      id: "14287",
      label: "Berlin",
      grain: "ags",
      geoKey: "11000000",
      level: "gemeinde",
    });
    expect(labels.filter((label) => label === "Berlin, kreisfreie Stadt")).toEqual(["Berlin, kreisfreie Stadt"]);
    expect(byKey["11000"]).toMatchObject({ label: "Berlin, kreisfreie Stadt", geoKey: "11000" });
    expect(labels.filter((label) => label === "Berlingen")).toEqual(["Berlingen"]);
    expect(byKey["07233004"]).toMatchObject({ label: "Berlingen", geoKey: "07233004" });
    expect(labels.filter((label) => label === "Berlingerode")).toEqual(["Berlingerode"]);
    expect(byKey["16061003"]).toMatchObject({ label: "Berlingerode", geoKey: "16061003" });
    expect(labels.filter((label) => label === "Bernau bei Berlin, Stadt")).toEqual(["Bernau bei Berlin, Stadt"]);
    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ags:11000012",
          label: "Berlin-Treptow-Köpenick",
          geoKey: "11000012",
          level: "bezirk",
        }),
        expect.objectContaining({
          label: "Berlinchen",
          parentLabel: "Wittstock/Dosse",
          level: "stadtteil",
        }),
        expect.objectContaining({
          label: "Berliner Chaussee",
          parentLabel: "Magdeburg",
          level: "stadtteil",
        }),
        expect.objectContaining({
          label: "Berliner Platz",
          parentLabel: "Erfurt",
          level: "stadtteil",
        }),
      ]),
    );
  });
});

function agsRow(id: string, label: string, geoKey: string, lon: number, lat: number) {
  return { id, label, grain: "ags", geo_key: geoKey, lon, lat };
}
