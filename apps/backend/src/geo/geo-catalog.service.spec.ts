import { DatabaseService } from "../database/database.service";
import { GEO_CATALOG_SEARCH_SQL, GEO_CATALOG_SEARCH_SQL_NO_ADMIN } from "./geo-catalog";
import { GeoCatalogService } from "./geo-catalog.service";

describe("GeoCatalogService", () => {
  const queryReadingFeatures = jest.fn();
  let service: GeoCatalogService;

  beforeEach(() => {
    queryReadingFeatures.mockReset();
    service = new GeoCatalogService({
      queryReadingFeatures,
    } as unknown as DatabaseService);
  });

  it("maps catalog rows under SET ROLE and keeps parentLabel off the area name", async () => {
    queryReadingFeatures.mockResolvedValue({
      rows: [
        {
          id: "stadtteil:1",
          label: "Neustadt",
          grain: "other",
          geo_key: "stadtteil:1",
          level: "stadtteil",
          parent_label: "Dresden",
          geo_ags: "14612000",
          lon: "13.74",
          lat: "51.06",
        },
      ],
    });
    await expect(service.search({ q: "Neustadt" })).resolves.toEqual([
      {
        id: "stadtteil:1",
        label: "Neustadt",
        grain: "other",
        geoKey: "stadtteil:1",
        level: "stadtteil",
        parentLabel: "Dresden",
        geoAgs: "14612000",
        lon: 13.74,
        lat: 51.06,
      },
    ]);
    expect(queryReadingFeatures.mock.calls[0]?.[0]).toBe(GEO_CATALOG_SEARCH_SQL);
    expect(queryReadingFeatures.mock.calls[0]?.[1]?.[3]).toBe("%Neustadt%");
    expect(queryReadingFeatures.mock.calls[0]?.[1]?.[7]).toBe(false);
    expect(queryReadingFeatures.mock.calls[0]?.[1]?.[8]).toEqual(["%Neustadt%"]);
  });

  it("allows PLZ rows only for an all-digit q and drops a nameless row", async () => {
    queryReadingFeatures.mockResolvedValue({
      rows: [
        {
          id: "plz5:12247",
          label: "12247",
          grain: "plz5",
          geo_key: "12247",
          level: "plz",
          parent_label: "Berlin",
          geo_ags: "11000000",
          lon: "13.34",
          lat: "52.44",
        },
        {
          id: "ortsteil:osm:12247773",
          label: "  ",
          grain: "other",
          geo_key: "ortsteil:osm:12247773",
          level: "ortsteil",
          parent_label: "Berlin",
          geo_ags: "11000000",
          lon: "13.34",
          lat: "52.43",
        },
      ],
    });
    await expect(service.search({ q: "12247" })).resolves.toEqual([
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
    expect(queryReadingFeatures.mock.calls[0]?.[1]?.[7]).toBe(true);
  });

  it("returns no hits when schema geo is missing", async () => {
    queryReadingFeatures.mockRejectedValue(
      Object.assign(new Error('relation "geo.geo_ref_plz" does not exist'), { code: "42P01" }),
    );
    await expect(service.search({ q: "Mitte" })).resolves.toEqual([]);
  });

  it("looks up municipality names by exact AGS", async () => {
    queryReadingFeatures.mockResolvedValue({
      rows: [{ geo_ags: "09162000", name: "München" }],
    });
    await expect(service.lookupAdminNames(["09162004", "ags:09162000", "09162000"])).resolves.toEqual(
      new Map([["09162000", "München"]]),
    );
    expect(queryReadingFeatures.mock.calls[0]?.[1]).toEqual([["09162004", "09162000"]]);
  });

  it("returns an empty admin map when schema geo is missing", async () => {
    queryReadingFeatures.mockRejectedValue(
      Object.assign(new Error('relation "geo.geo_ref_admin" does not exist'), { code: "42P01" }),
    );
    await expect(service.lookupAdminNames(["09162000"])).resolves.toEqual(new Map());
  });

  it("retries without geo.geo_ref_admin", async () => {
    queryReadingFeatures
      .mockRejectedValueOnce(
        Object.assign(new Error('relation "geo.geo_ref_admin" does not exist'), { code: "42P01" }),
      )
      .mockResolvedValueOnce({ rows: [] });
    await expect(service.search({ q: "Altona" })).resolves.toEqual([]);
    expect(queryReadingFeatures.mock.calls[1]?.[0]).toBe(GEO_CATALOG_SEARCH_SQL_NO_ADMIN);
    expect(GEO_CATALOG_SEARCH_SQL_NO_ADMIN).not.toContain("LEFT JOIN geo.geo_ref_admin");
  });
});
