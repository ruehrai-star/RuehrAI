import { DatabaseService } from "../database/database.service";
import { DataScoutService } from "../database/data-scout.service";
import { GeoCatalogService } from "./geo-catalog.service";
import { PlaceCatalogService, regionFeatureIds } from "./place-catalog.service";

describe("PlaceCatalogService", () => {
  const query = jest.fn();
  const scoutQuery = jest.fn();
  const lookupOutline = jest.fn();
  const service = new PlaceCatalogService(
    { query } as unknown as DatabaseService,
    { enabled: true, query: scoutQuery } as unknown as DataScoutService,
    { lookupOutline } as unknown as GeoCatalogService,
  );

  beforeEach(() => {
    query.mockReset();
    scoutQuery.mockReset();
    lookupOutline.mockReset();
    lookupOutline.mockResolvedValue(null);
    scoutQuery.mockResolvedValue({ rows: [] });
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
    expect(query.mock.calls[0]?.[0]).toContain("stub");
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(["09162000", "ags:09162000"]);
    expect(scoutQuery).not.toHaveBeenCalled();
  });

  it("copies a MultiPolygon from Brain geo before map_features", async () => {
    const outline = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [13.2, 52.4],
            [13.4, 52.4],
            [13.3, 52.5],
            [13.2, 52.4],
          ],
        ],
      ],
    };
    lookupOutline.mockResolvedValue({ geometry: outline, point: { lon: 13.3, lat: 52.45 } });
    const hit = await service.lookupRegion({
      grain: "ags",
      geoKey: "11000001",
      ags: "11000001",
      plz: null,
    });
    expect(hit.geometry).toEqual(outline);
    expect(hit.point).toEqual({ lon: 13.3, lat: 52.45 });
    expect(query).not.toHaveBeenCalled();
    expect(scoutQuery).not.toHaveBeenCalled();
  });

  it("looks up the official Bezirk id and falls back to geo_ref_bezirk", async () => {
    const outline = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [13.18, 52.39],
            [13.35, 52.39],
            [13.35, 52.49],
            [13.18, 52.49],
            [13.18, 52.39],
          ],
        ],
      ],
    };
    query.mockResolvedValue({ rows: [] });
    scoutQuery.mockResolvedValueOnce({
      rows: [{ geometry: outline, lon: 13.2353, lat: 52.4302 }],
    });
    const hit = await service.lookupRegion({
      grain: "ags",
      geoKey: "11006006",
      ags: "11006006",
      plz: null,
    });
    expect(hit.geometry).toEqual(outline);
    expect(hit.point).toEqual({ lon: 13.2353, lat: 52.4302 });
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(
      expect.arrayContaining(["11000006", "ags:11000006"]),
    );
    expect(query.mock.calls[0]?.[1]?.[1]).toBe("11000006");
    expect(scoutQuery.mock.calls[0]?.[0]).toContain("public.geo_ref_bezirk");
    expect(scoutQuery.mock.calls[0]?.[1]).toEqual(["11000006"]);
    expect(scoutQuery).toHaveBeenCalledTimes(1);
  });

  it("reads geo_ref_admin when Brain has no Gemeinde polygon", async () => {
    const outline = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [11.36, 48.06],
            [11.72, 48.06],
            [11.72, 48.25],
            [11.36, 48.25],
            [11.36, 48.06],
          ],
        ],
      ],
    };
    query.mockResolvedValue({ rows: [] });
    scoutQuery.mockResolvedValue({ rows: [{ geometry: outline, lon: 11.57, lat: 48.14 }] });
    const hit = await service.lookupRegion({
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
      plz: null,
    });
    expect(hit.geometry).toEqual(outline);
    expect(scoutQuery).toHaveBeenCalledTimes(1);
    expect(scoutQuery.mock.calls[0]?.[0]).toContain("public.geo_ref_admin");
    expect(scoutQuery.mock.calls[0]?.[1]).toEqual(["09162000"]);
  });

  it("skips Data-Scout when the pool is disabled", async () => {
    const disabled = new PlaceCatalogService(
      { query } as unknown as DatabaseService,
      { enabled: false, query: scoutQuery } as unknown as DataScoutService,
    );
    query.mockResolvedValue({ rows: [] });
    const hit = await disabled.lookupRegion({
      grain: "ags",
      geoKey: "11000007",
      ags: "11000007",
      plz: null,
    });
    expect(hit).toEqual({ geometry: null, point: null });
    expect(scoutQuery).not.toHaveBeenCalled();
  });

  it("does not ask Data-Scout for a PLZ grain", async () => {
    query.mockResolvedValue({ rows: [] });
    await service.lookupRegion({
      grain: "plz5",
      geoKey: "80331",
      ags: null,
      plz: "80331",
    });
    expect(scoutQuery).not.toHaveBeenCalled();
  });

  it("builds feature ids from grain, ags, and plz", () => {
    expect(
      regionFeatureIds({ grain: "plz5", geoKey: "80331", ags: null, plz: "80331" }),
    ).toEqual(["80331", "plz5:80331", "plz8:80331"]);
  });
});
