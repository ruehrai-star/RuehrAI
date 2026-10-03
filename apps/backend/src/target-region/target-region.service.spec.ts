import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { GeoCatalogService } from "../geo/geo-catalog.service";
import { PlaceCatalogService } from "../geo/place-catalog.service";
import {
  TARGET_REGION_NO_MAP_AREA,
  TARGET_REGION_PLACE_REQUIRED,
  TargetRegionService,
} from "./target-region.service";

const muenchenPolygon = {
  type: "Polygon" as const,
  coordinates: [
    [
      [11.36, 48.06],
      [11.72, 48.06],
      [11.72, 48.25],
      [11.36, 48.25],
      [11.36, 48.06],
    ],
  ],
};

describe("TargetRegionService", () => {
  const query = jest.fn();
  const lookupRegion = jest.fn();
  const search = jest.fn();
  const lookupAdminNames = jest.fn();
  let service: TargetRegionService;

  beforeEach(async () => {
    query.mockReset();
    lookupRegion.mockReset();
    search.mockReset();
    lookupAdminNames.mockReset();
    lookupRegion.mockResolvedValue({ geometry: null, point: null });
    search.mockResolvedValue([]);
    lookupAdminNames.mockResolvedValue(new Map());
    const moduleRef = await Test.createTestingModule({
      providers: [
        TargetRegionService,
        { provide: DatabaseService, useValue: { query } },
        { provide: PlaceCatalogService, useValue: { lookupRegion } },
        { provide: GeoCatalogService, useValue: { search, lookupAdminNames } },
      ],
    }).compile();
    service = moduleRef.get(TargetRegionService);
  });

  it("returns an empty list when the user has no regions", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.list("4")).resolves.toEqual({ items: [] });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("app.target_regions"), ["4"]);
  });

  it("rejects a label with no catalog place id", async () => {
    await expect(service.add("4", { label: " München " })).rejects.toThrow(TARGET_REGION_PLACE_REQUIRED);
    expect(lookupRegion).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a catalog miss so a previous polygon is not wiped", async () => {
    lookupRegion.mockResolvedValue({ geometry: null, point: null });
    await expect(
      service.add("4", {
        label: "Lichtenberg",
        grain: "ags",
        geoKey: "11000011",
        ags: "11000011",
      }),
    ).rejects.toThrow(TARGET_REGION_NO_MAP_AREA);
    expect(lookupRegion).toHaveBeenCalledWith({
      grain: "ags",
      geoKey: "11000011",
      ags: "11000011",
      plz: null,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("stores the official Bezirk AGS when the client sends the doubled alias", async () => {
    const geometry = {
      type: "MultiPolygon" as const,
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
    lookupRegion.mockResolvedValue({
      geometry,
      point: { lon: 13.2353, lat: 52.4302 },
    });
    search.mockResolvedValue([
      { label: "Steglitz-Zehlendorf", level: "bezirk", parentLabel: "Berlin" },
    ]);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            label: "Steglitz-Zehlendorf",
            grain: "ags",
            geo_key: "11000006",
            level: "bezirk",
            parent_label: "Berlin",
            ags: "11000006",
            plz: null,
            lon: 13.2353,
            lat: 52.4302,
            bounds_west: 13.18,
            bounds_south: 52.39,
            bounds_east: 13.35,
            bounds_north: 52.49,
            geometry,
            updated_at: new Date("2026-01-02T00:00:00.000Z"),
          },
        ],
      });
    const saved = await service.add("4", {
      label: "Steglitz-Zehlendorf",
      grain: "ags",
      geoKey: "11006006",
      ags: "11006006",
    });
    expect(lookupRegion).toHaveBeenCalledWith({
      grain: "ags",
      geoKey: "11000006",
      ags: "11000006",
      plz: null,
    });
    const params = query.mock.calls[1]?.[1] as unknown[];
    expect(params[3]).toBe("11000006");
    expect(params[4]).toBe("bezirk");
    expect(params[5]).toBe("Berlin");
    expect(params[6]).toBe("11000006");
    expect(JSON.parse(params[14] as string)).toEqual(geometry);
    expect(saved.created).toBe(true);
    expect(saved.item.ags).toBe("11000006");
    expect(saved.item.level).toBe("bezirk");
    expect(saved.item.parentLabel).toBe("Berlin");
    expect(saved.item.geometry).toEqual(geometry);
  });

  it("copies the seeded polygon and derives bounds for fitBounds", async () => {
    lookupRegion.mockResolvedValue({
      geometry: muenchenPolygon,
      point: { lon: 11.5755, lat: 48.1374 },
    });
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            label: "München",
            grain: "ags",
            geo_key: "09162000",
            level: null,
            parent_label: null,
            ags: "09162000",
            plz: null,
            lon: 11.5755,
            lat: 48.1374,
            bounds_west: 11.36,
            bounds_south: 48.06,
            bounds_east: 11.72,
            bounds_north: 48.25,
            geometry: muenchenPolygon,
            updated_at: new Date("2026-01-02T00:00:00.000Z"),
          },
        ],
      });
    const saved = await service.add("4", {
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
    });
    expect(saved.item.bounds).toEqual({ west: 11.36, south: 48.06, east: 11.72, north: 48.25 });
    expect(saved.item.geometry).toEqual(muenchenPolygon);
    expect(saved.item.level).toBe("gemeinde");
    expect(saved.item.parentLabel).toBeNull();
    expect(saved.item.lon).toBeCloseTo(11.5755);
    expect(saved.item.lat).toBeCloseTo(48.1374);
    const params = query.mock.calls[1]?.[1] as unknown[];
    expect(params[4]).toBeNull();
    expect(params[8]).toBeCloseTo(11.5755);
    expect(params[9]).toBeCloseTo(48.1374);
    expect(params.slice(10, 14)).toEqual([11.36, 48.06, 11.72, 48.25]);
    expect(JSON.parse(params[14] as string)).toEqual(muenchenPolygon);
  });

  it("stores client geometry and derives bounds from it", async () => {
    const geometry = {
      type: "Polygon" as const,
      coordinates: [
        [
          [13.0, 52.3],
          [13.6, 52.3],
          [13.6, 52.7],
          [13.0, 52.7],
          [13.0, 52.3],
        ],
      ],
    };
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            label: "Berlin",
            grain: "ags",
            geo_key: "11000000",
            level: null,
            parent_label: null,
            ags: "11000000",
            plz: null,
            lon: 13.3,
            lat: 52.5,
            bounds_west: 13,
            bounds_south: 52.3,
            bounds_east: 13.6,
            bounds_north: 52.7,
            geometry,
            updated_at: new Date("2026-01-02T00:00:00.000Z"),
          },
        ],
      });
    await service.add("4", {
      label: "Berlin",
      grain: "ags",
      ags: "11000000",
      geometry,
    });
    expect(lookupRegion).not.toHaveBeenCalled();
    const params = query.mock.calls[1]?.[1] as unknown[];
    expect(params[8]).toBeCloseTo(13.3);
    expect(params[9]).toBeCloseTo(52.5);
    expect(params.slice(10, 14)).toEqual([13, 52.3, 13.6, 52.7]);
  });

  it("returns the stored item instead of inserting a duplicate key", async () => {
    lookupRegion.mockResolvedValue({
      geometry: muenchenPolygon,
      point: { lon: 11.5755, lat: 48.1374 },
    });
    const existing = {
      label: "München",
      grain: "ags",
      geo_key: "09162000",
      level: null,
      parent_label: null,
      ags: "09162000",
      plz: null,
      lon: 11.5755,
      lat: 48.1374,
      bounds_west: 11.36,
      bounds_south: 48.06,
      bounds_east: 11.72,
      bounds_north: 48.25,
      geometry: muenchenPolygon,
      updated_at: new Date("2026-01-02T00:00:00.000Z"),
    };
    query.mockResolvedValue({ rows: [existing] });
    const saved = await service.add("4", {
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
    });
    expect(saved.created).toBe(false);
    expect(saved.item.geoKey).toBe("09162000");
    expect(saved.item.level).toBe("gemeinde");
    expect(saved.item.parentLabel).toBeNull();
    expect(search).toHaveBeenCalledWith({ geoKey: "09162000" });
    expect(query.mock.calls.some((call) => String(call[0]).includes("INSERT"))).toBe(false);
  });

  it("fills catalog display when a second add hits an old stored row", async () => {
    lookupRegion.mockResolvedValue({
      geometry: muenchenPolygon,
      point: { lon: 11.58, lat: 48.14 },
    });
    search.mockResolvedValue([{ label: "80331", level: "plz", parentLabel: "München" }]);
    query.mockResolvedValue({
      rows: [
        {
          label: "80331",
          grain: "plz5",
          geo_key: "80331",
          level: null,
          parent_label: null,
          ags: null,
          plz: "80331",
          lon: 11.58,
          lat: 48.14,
          bounds_west: 11.57,
          bounds_south: 48.13,
          bounds_east: 11.59,
          bounds_north: 48.15,
          geometry: muenchenPolygon,
          updated_at: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    });
    const saved = await service.add("4", {
      label: "80331",
      grain: "plz5",
      geoKey: "80331",
      plz: "80331",
    });
    expect(saved.created).toBe(false);
    expect(saved.item).toMatchObject({
      label: "80331",
      level: "plz",
      parentLabel: "München",
    });
    expect(query.mock.calls.some((call) => String(call[0]).includes("INSERT"))).toBe(false);
  });

  it("refuses bounds without a catalog or client polygon", async () => {
    await expect(
      service.add("4", {
        label: "Kasten",
        geoKey: "kasten",
        bounds: { west: 11, south: 48, east: 12, north: 49 },
        lon: 11.5,
        lat: 48.5,
      }),
    ).rejects.toThrow(TARGET_REGION_NO_MAP_AREA);
    expect(lookupRegion).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a catalog point when there is no outline", async () => {
    lookupRegion.mockResolvedValue({
      geometry: { type: "Point", coordinates: [13.405, 52.52] },
      point: { lon: 13.405, lat: 52.52 },
    });
    await expect(service.add("4", { label: "Berlin", grain: "ags", ags: "11000000" })).rejects.toThrow(
      TARGET_REGION_NO_MAP_AREA,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves a stored null outline on read when the catalog still has none", async () => {
    query.mockResolvedValue({
      rows: [
        {
          label: "Unbekannt",
          grain: "ags",
          geo_key: "11000011",
          level: "bezirk",
          parent_label: "Berlin",
          ags: "11000011",
          plz: null,
          lon: null,
          lat: null,
          bounds_west: null,
          bounds_south: null,
          bounds_east: null,
          bounds_north: null,
          geometry: null,
          updated_at: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    });
    const listed = await service.list("4");
    expect(listed.items[0]?.geometry).toBeNull();
    expect(listed.items[0]?.bounds).toBeNull();
    expect(listed.items[0]?.level).toBe("bezirk");
    expect(listed.items[0]?.parentLabel).toBe("Berlin");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("fills catalog display on a pre-011 München row without inventing a parent", async () => {
    query.mockResolvedValue({
      rows: [
        {
          label: "München",
          grain: "ags",
          geo_key: "09162000",
          level: null,
          parent_label: null,
          ags: "09162000",
          plz: null,
          lon: 11.5755,
          lat: 48.1374,
          bounds_west: 11.36,
          bounds_south: 48.06,
          bounds_east: 11.72,
          bounds_north: 48.25,
          geometry: muenchenPolygon,
          updated_at: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    });
    const listed = await service.list("4");
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      level: "gemeinde",
      parentLabel: null,
    });
    expect(search).toHaveBeenCalledWith({ geoKey: "09162000" });
    expect(listed.items[0]?.geometry).toEqual(muenchenPolygon);
  });

  it("fills level and parentLabel on an old PLZ row from the catalog", async () => {
    query.mockResolvedValue({
      rows: [
        {
          label: "80331",
          grain: "plz5",
          geo_key: "80331",
          level: null,
          parent_label: null,
          ags: null,
          plz: "80331",
          lon: 11.58,
          lat: 48.14,
          bounds_west: 11.57,
          bounds_south: 48.13,
          bounds_east: 11.59,
          bounds_north: 48.15,
          geometry: muenchenPolygon,
          updated_at: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    });
    search.mockResolvedValue([{ label: "80331", level: "plz", parentLabel: "München" }]);
    const listed = await service.list("4");
    expect(listed.items[0]).toMatchObject({
      label: "80331",
      grain: "plz5",
      geoKey: "80331",
      level: "plz",
      parentLabel: "München",
    });
    expect(search).toHaveBeenCalledWith({ geoKey: "80331" });
  });

  it("derives a missing outline on read from the catalog", async () => {
    query.mockResolvedValue({
      rows: [
        {
          label: "München",
          grain: "ags",
          geo_key: "09162000",
          level: null,
          parent_label: null,
          ags: "09162000",
          plz: null,
          lon: 11.5755,
          lat: 48.1374,
          bounds_west: null,
          bounds_south: null,
          bounds_east: null,
          bounds_north: null,
          geometry: null,
          updated_at: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    });
    lookupRegion.mockResolvedValue({ geometry: muenchenPolygon, point: { lon: 11.5755, lat: 48.1374 } });
    const listed = await service.list("4");
    expect(listed.items[0]?.geometry).toEqual(muenchenPolygon);
    expect(listed.items[0]?.bounds).toEqual({ west: 11.36, south: 48.06, east: 11.72, north: 48.25 });
    expect(listed.items[0]?.lon).toBeCloseTo(11.5755);
  });

  it("stores the MultiPolygon for a catalog Ortsteil id", async () => {
    const geometry = {
      type: "MultiPolygon" as const,
      coordinates: [
        [
          [
            [13.33, 52.42],
            [13.35, 52.42],
            [13.34, 52.44],
            [13.33, 52.42],
          ],
        ],
      ],
    };
    lookupRegion.mockResolvedValue({
      geometry,
      point: { lon: 13.34, lat: 52.43 },
    });
    search.mockResolvedValue([
      { label: "Lankwitz", level: "ortsteil", parentLabel: "Berlin" },
    ]);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            label: "Lankwitz",
            grain: "other",
            geo_key: "ortsteil:osm:5712247",
            level: "ortsteil",
            parent_label: "Berlin",
            ags: null,
            plz: null,
            lon: 13.34,
            lat: 52.43,
            bounds_west: 13.33,
            bounds_south: 52.42,
            bounds_east: 13.35,
            bounds_north: 52.44,
            geometry,
            updated_at: new Date("2026-01-02T00:00:00.000Z"),
          },
        ],
      });
    const saved = await service.add("4", {
      label: "Lankwitz",
      grain: "other",
      geoKey: "ortsteil:osm:5712247",
    });
    expect(lookupRegion).toHaveBeenCalledWith({
      grain: "other",
      geoKey: "ortsteil:osm:5712247",
      ags: null,
      plz: null,
    });
    const params = query.mock.calls[1]?.[1] as unknown[];
    expect(JSON.parse(params[14] as string)).toEqual(geometry);
    expect(saved.item.geometry).toEqual(geometry);
    expect(saved.item.geoKey).toBe("ortsteil:osm:5712247");
    expect(saved.item.level).toBe("ortsteil");
    expect(saved.item.parentLabel).toBe("Berlin");
  });

  it("rejects a lon without a lat", async () => {
    await expect(service.add("4", { label: "München", geoKey: "09162000", lon: 11.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
    expect(lookupRegion).not.toHaveBeenCalled();
  });

  it("rejects a geometry that is not a closed polygon", async () => {
    await expect(
      service.add("4", {
        label: "München",
        geoKey: "09162000",
        geometry: { type: "Point", coordinates: [11.5, 48.1] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.add("4", {
        label: "München",
        geoKey: "09162000",
        bounds: { west: 12, south: 48, east: 11, north: 49 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("removes one place by catalog key and leaves the others", async () => {
    query.mockResolvedValue({ rows: [] });
    await service.remove("4", "ortsteil:osm:5712247");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM app.target_regions"),
      ["4", expect.arrayContaining(["ortsteil:osm:5712247"])],
    );
  });
});
