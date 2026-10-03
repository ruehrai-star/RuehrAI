import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { PlaceCatalogService } from "../geo/place-catalog.service";
import { TARGET_REGION_NO_MAP_AREA, TargetRegionService } from "./target-region.service";

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
  let service: TargetRegionService;

  beforeEach(async () => {
    query.mockReset();
    lookupRegion.mockReset();
    lookupRegion.mockResolvedValue({ geometry: null, point: null });
    const moduleRef = await Test.createTestingModule({
      providers: [
        TargetRegionService,
        { provide: DatabaseService, useValue: { query } },
        { provide: PlaceCatalogService, useValue: { lookupRegion } },
      ],
    }).compile();
    service = moduleRef.get(TargetRegionService);
  });

  it("returns 404 when the user has no region", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.get("4")).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("app.target_regions"), ["4"]);
  });

  it("rejects a label with no catalog area instead of storing null geometry", async () => {
    await expect(service.put("4", { label: " München " })).rejects.toThrow(TARGET_REGION_NO_MAP_AREA);
    expect(lookupRegion).toHaveBeenCalledWith({
      grain: null,
      geoKey: null,
      ags: null,
      plz: null,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a catalog miss so a previous polygon is not wiped", async () => {
    lookupRegion.mockResolvedValue({ geometry: null, point: null });
    await expect(
      service.put("4", {
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
    query.mockResolvedValue({
      rows: [
        {
          label: "Steglitz-Zehlendorf",
          grain: "ags",
          geo_key: "11000006",
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
    const saved = await service.put("4", {
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
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[3]).toBe("11000006");
    expect(params[4]).toBe("11000006");
    expect(JSON.parse(params[12] as string)).toEqual(geometry);
    expect(saved.ags).toBe("11000006");
    expect(saved.geometry).toEqual(geometry);
  });

  it("copies the seeded polygon and derives bounds for fitBounds", async () => {
    lookupRegion.mockResolvedValue({
      geometry: muenchenPolygon,
      point: { lon: 11.5755, lat: 48.1374 },
    });
    query.mockResolvedValue({
      rows: [
        {
          label: "München",
          grain: "ags",
          geo_key: "09162000",
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
    const saved = await service.put("4", {
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
    });
    expect(saved.bounds).toEqual({ west: 11.36, south: 48.06, east: 11.72, north: 48.25 });
    expect(saved.geometry).toEqual(muenchenPolygon);
    expect(saved.lon).toBeCloseTo(11.5755);
    expect(saved.lat).toBeCloseTo(48.1374);
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[6]).toBeCloseTo(11.5755);
    expect(params[7]).toBeCloseTo(48.1374);
    expect(params.slice(8, 12)).toEqual([11.36, 48.06, 11.72, 48.25]);
    expect(JSON.parse(params[12] as string)).toEqual(muenchenPolygon);
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
    query.mockResolvedValue({
      rows: [
        {
          label: "Berlin",
          grain: "ags",
          geo_key: "11000000",
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
    await service.put("4", {
      label: "Berlin",
      grain: "ags",
      ags: "11000000",
      geometry,
    });
    expect(lookupRegion).not.toHaveBeenCalled();
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[6]).toBeCloseTo(13.3);
    expect(params[7]).toBeCloseTo(52.5);
    expect(params.slice(8, 12)).toEqual([13, 52.3, 13.6, 52.7]);
  });

  it("refuses bounds without a catalog or client polygon", async () => {
    await expect(
      service.put("4", {
        label: "Kasten",
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
    await expect(service.put("4", { label: "Berlin", grain: "ags", ags: "11000000" })).rejects.toThrow(
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
    const region = await service.get("4");
    expect(region.geometry).toBeNull();
    expect(region.bounds).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("derives a missing outline on read from the catalog", async () => {
    query.mockResolvedValue({
      rows: [
        {
          label: "München",
          grain: "ags",
          geo_key: "09162000",
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
    const region = await service.get("4");
    expect(region.geometry).toEqual(muenchenPolygon);
    expect(region.bounds).toEqual({ west: 11.36, south: 48.06, east: 11.72, north: 48.25 });
    expect(region.lon).toBeCloseTo(11.5755);
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
    query.mockResolvedValue({
      rows: [
        {
          label: "Lankwitz",
          grain: "other",
          geo_key: "ortsteil:osm:5712247",
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
    const saved = await service.put("4", {
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
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(JSON.parse(params[12] as string)).toEqual(geometry);
    expect(saved.geometry).toEqual(geometry);
    expect(saved.geoKey).toBe("ortsteil:osm:5712247");
  });

  it("rejects a lon without a lat", async () => {
    await expect(service.put("4", { label: "München", lon: 11.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
    expect(lookupRegion).not.toHaveBeenCalled();
  });

  it("rejects a geometry that is not a closed polygon", async () => {
    await expect(
      service.put("4", {
        label: "München",
        geometry: { type: "Point", coordinates: [11.5, 48.1] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.put("4", {
        label: "München",
        bounds: { west: 12, south: 48, east: 11, north: 49 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});

function savedRow() {
  return {
    label: "Kasten",
    grain: null,
    geo_key: null,
    ags: null,
    plz: null,
    lon: 11.5,
    lat: 48.5,
    bounds_west: 11,
    bounds_south: 48,
    bounds_east: 12,
    bounds_north: 49,
    geometry: null,
    updated_at: new Date("2026-01-02T00:00:00.000Z"),
  };
}
