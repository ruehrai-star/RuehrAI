import { DatabaseService } from "../database/database.service";
import { PlaceCatalogService, regionFeatureIds } from "./place-catalog.service";

describe("PlaceCatalogService", () => {
  const query = jest.fn();
  const service = new PlaceCatalogService({ query } as unknown as DatabaseService);

  beforeEach(() => {
    query.mockReset();
  });

  it("reads the PLZ centroid from search_places", async () => {
    query.mockResolvedValue({ rows: [{ plz: "80331", lon: "11.576", lat: "48.137" }] });
    await expect(service.plzCentroids(["80331"])).resolves.toEqual(
      new Map([["80331", { lon: 11.576, lat: 48.137 }]]),
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("app.search_places");
    expect(query.mock.calls[0]?.[1]).toEqual([["80331"]]);
  });

  it("falls back to a Point map feature when the PLZ is missing from search_places", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ plz: "10115", lon: 13.387, lat: 52.532 }] });
    const found = await service.plzCentroids(["10115"]);
    expect(found.get("10115")).toEqual({ lon: 13.387, lat: 52.532 });
    expect(query.mock.calls[1]?.[0]).toContain("app.map_features");
    expect(query.mock.calls[1]?.[1]).toEqual([["10115"], ["plz5:10115", "plz8:10115"]]);
  });

  it("returns a polygon outline and the matching catalog point", async () => {
    const polygon = { type: "Polygon", coordinates: [[[11.36, 48.06], [11.72, 48.06], [11.72, 48.25], [11.36, 48.25], [11.36, 48.06]]] };
    query
      .mockResolvedValueOnce({ rows: [{ geometry: polygon }] })
      .mockResolvedValueOnce({ rows: [{ lon: 11.5755, lat: 48.1374 }] });
    const hit = await service.lookupRegion({
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
      plz: null,
    });
    expect(hit.geometry).toEqual(polygon);
    expect(hit.point).toEqual({ lon: 11.5755, lat: 48.1374 });
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(["09162000", "ags:09162000"]);
  });

  it("builds feature ids from grain, ags, and plz", () => {
    expect(
      regionFeatureIds({ grain: "plz5", geoKey: "80331", ags: null, plz: "80331" }),
    ).toEqual(["80331", "plz5:80331", "plz8:80331"]);
  });
});
