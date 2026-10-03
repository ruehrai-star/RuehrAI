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
  });

  it("returns no hits when schema geo is missing", async () => {
    queryReadingFeatures.mockRejectedValue(
      Object.assign(new Error('relation "geo.geo_ref_plz" does not exist'), { code: "42P01" }),
    );
    await expect(service.search({ q: "Mitte" })).resolves.toEqual([]);
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
