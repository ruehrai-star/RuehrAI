import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { AddressGeocoderService } from "../geo/address-geocoder.service";
import { PlaceCatalogService } from "../geo/place-catalog.service";
import { StoresService } from "./stores.service";

describe("StoresService", () => {
  const query = jest.fn();
  const withTransaction = jest.fn(async (fn: (q: typeof query) => Promise<unknown>) => fn(query));
  const plzCentroids = jest.fn();
  const lookupAddress = jest.fn();
  const lookupPlzCentroid = jest.fn();
  let service: StoresService;

  beforeEach(async () => {
    query.mockReset();
    withTransaction.mockClear();
    plzCentroids.mockReset();
    plzCentroids.mockResolvedValue(new Map());
    lookupAddress.mockReset();
    lookupAddress.mockResolvedValue(null);
    lookupPlzCentroid.mockReset();
    lookupPlzCentroid.mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: DatabaseService, useValue: { query, withTransaction } },
        { provide: PlaceCatalogService, useValue: { plzCentroids } },
        { provide: AddressGeocoderService, useValue: { lookupAddress, lookupPlzCentroid } },
      ],
    }).compile();
    service = moduleRef.get(StoresService);
  });

  it("lists only the caller's stores", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.list("9")).resolves.toEqual({ stores: [] });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("user_id = $1::bigint"), ["9"]);
  });

  it("hides a store owned by someone else", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.get("9", "3")).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["3", "9"]);
  });

  it("rejects duplicate months before writing", async () => {
    await expect(
      service.putRevenue("9", "3", {
        points: [
          { year: 2025, month: 1, revenueEur: 10 },
          { year: 2025, month: 1, revenueEur: null },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("rejects a write that would exceed 36 months", async () => {
    query
      .mockResolvedValueOnce({ rows: [storeRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ n: 37 }] });
    await expect(
      service.putRevenue("9", "3", {
        points: [{ year: 2025, month: 3, revenueEur: null }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it("fills a missing pin from the PLZ centroid and stores that WGS84 pair", async () => {
    plzCentroids.mockResolvedValue(new Map([["80331", { lon: 11.576, lat: 48.137 }]]));
    query.mockResolvedValue({ rows: [storeRow({ lon: 11.576, lat: 48.137 })] });
    const created = await service.create("9", {
      street: "Marienplatz 1",
      postalCode: "80331",
      city: "München",
    });
    expect(lookupAddress).toHaveBeenCalledWith("Marienplatz 1", "80331");
    expect(lookupPlzCentroid).toHaveBeenCalledWith("80331");
    expect(plzCentroids).toHaveBeenCalledWith(["80331"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO app.store_locations"), [
      "9",
      null,
      "Marienplatz 1",
      "80331",
      "München",
      "DE",
      11.576,
      48.137,
    ]);
    expect(created.lon).toBeCloseTo(11.576);
    expect(created.lat).toBeCloseTo(48.137);
  });

  it("keeps an explicit WGS84 pair and does not look up the PLZ", async () => {
    query.mockResolvedValue({ rows: [storeRow({ lon: 11.5, lat: 48.1 })] });
    await service.create("9", {
      street: "Marienplatz 1",
      postalCode: "80331",
      city: "München",
      lon: 11.5,
      lat: 48.1,
    });
    expect(lookupAddress).not.toHaveBeenCalled();
    expect(lookupPlzCentroid).not.toHaveBeenCalled();
    expect(plzCentroids).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[1]).toEqual([
      "9",
      null,
      "Marienplatz 1",
      "80331",
      "München",
      "DE",
      11.5,
      48.1,
    ]);
  });

  it("persists a catalog pin when a stored address has no pair yet", async () => {
    query
      .mockResolvedValueOnce({ rows: [storeRow()] })
      .mockResolvedValueOnce({
        rows: [{ id: "3", updated_at: new Date("2026-04-01T00:00:00.000Z") }],
      });
    plzCentroids.mockResolvedValue(new Map([["80331", { lon: 11.576, lat: 48.137 }]]));
    await expect(service.list("9")).resolves.toEqual({
      stores: [
        expect.objectContaining({
          lon: 11.576,
          lat: 48.137,
          postalCode: "80331",
          updatedAt: "2026-04-01T00:00:00.000Z",
        }),
      ],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("UPDATE app.store_locations");
    expect(query.mock.calls[1]?.[0]).toContain("s.lon IS NULL");
    expect(query.mock.calls[1]?.[1]).toEqual([["3"], [11.576], [48.137]]);
  });

  it("persists a catalog pin when reading one store", async () => {
    query
      .mockResolvedValueOnce({ rows: [storeRow()] })
      .mockResolvedValueOnce({
        rows: [{ id: "3", updated_at: new Date("2026-04-01T00:00:00.000Z") }],
      });
    plzCentroids.mockResolvedValue(new Map([["80331", { lon: 11.576, lat: 48.137 }]]));
    await expect(service.get("9", "3")).resolves.toEqual(
      expect.objectContaining({ lon: 11.576, lat: 48.137, updatedAt: "2026-04-01T00:00:00.000Z" }),
    );
    expect(query.mock.calls[1]?.[0]).toContain("UPDATE app.store_locations");
    expect(query.mock.calls[1]?.[0]).toContain("s.lon IS NULL");
  });

  it("leaves null coordinates when the catalog has no PLZ", async () => {
    query.mockResolvedValue({ rows: [storeRow()] });
    plzCentroids.mockResolvedValue(new Map());
    await expect(service.list("9")).resolves.toEqual({
      stores: [expect.objectContaining({ lon: null, lat: null, postalCode: "80331" })],
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).not.toContain("UPDATE app.store_locations");
  });

  it("stores a Data-Scout address hit and skips the PLZ catalog", async () => {
    lookupAddress.mockResolvedValue({ lon: 13.31, lat: 52.48 });
    query.mockResolvedValue({ rows: [storeRow({ lon: 13.31, lat: 52.48, postal_code: "12247" })] });
    const created = await service.create("9", {
      street: "Schloßstraße 12",
      postalCode: "12247",
      city: "Berlin",
    });
    expect(lookupPlzCentroid).not.toHaveBeenCalled();
    expect(plzCentroids).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[1]).toEqual([
      "9",
      null,
      "Schloßstraße 12",
      "12247",
      "Berlin",
      "DE",
      13.31,
      52.48,
    ]);
    expect(created.lon).toBeCloseTo(13.31);
    expect(created.lat).toBeCloseTo(52.48);
  });

  it("uses the Data-Scout PLZ centroid when the address misses", async () => {
    lookupPlzCentroid.mockResolvedValue({ lon: 13.35, lat: 52.46 });
    query.mockResolvedValue({ rows: [storeRow({ lon: 13.35, lat: 52.46, postal_code: "12169" })] });
    await service.create("9", {
      street: "Unbekannt 1",
      postalCode: "12169",
      city: "Berlin",
    });
    expect(plzCentroids).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[1]?.slice(-2)).toEqual([13.35, 52.46]);
  });

  it("persists an address hit over a null pin on read", async () => {
    query
      .mockResolvedValueOnce({ rows: [storeRow({ postal_code: "10115" })] })
      .mockResolvedValueOnce({
        rows: [{ id: "3", updated_at: new Date("2026-09-29T12:00:00.000Z") }],
      });
    lookupAddress.mockResolvedValue({ lon: 13.39, lat: 52.53 });
    const store = await service.get("9", "3");
    expect(store.lon).toBeCloseTo(13.39);
    expect(store.lat).toBeCloseTo(52.53);
    expect(store.updatedAt).toBe("2026-09-29T12:00:00.000Z");
    expect(plzCentroids).not.toHaveBeenCalled();
    expect(query.mock.calls[1]?.[0]).toContain("s.lon IS NULL");
    expect(query.mock.calls[1]?.[1]).toEqual([["3"], [13.39], [52.53]]);
  });

  it("upgrades a stored PLZ centroid when the address matches", async () => {
    query
      .mockResolvedValueOnce({
        rows: [storeRow({ lon: 13.387, lat: 52.532, postal_code: "10115" })],
      })
      .mockResolvedValueOnce({ rows: [{ updated_at: new Date("2026-09-29T12:00:00.000Z") }] });
    lookupAddress.mockResolvedValue({ lon: 13.393, lat: 52.53 });
    plzCentroids.mockResolvedValue(new Map([["10115", { lon: 13.387, lat: 52.532 }]]));
    const listed = await service.list("9");
    expect(listed.stores[0]?.lon).toBeCloseTo(13.393);
    expect(query.mock.calls[1]?.[0]).toContain("UPDATE app.store_locations");
    expect(query.mock.calls[1]?.[1]).toEqual(["3", 13.393, 52.53, 13.387, 52.532]);
  });

  it("keeps an explicit pin that is not the PLZ centroid", async () => {
    query.mockResolvedValue({
      rows: [storeRow({ lon: 13.4, lat: 52.5, postal_code: "10115" })],
    });
    lookupAddress.mockResolvedValue({ lon: 13.393, lat: 52.53 });
    plzCentroids.mockResolvedValue(new Map([["10115", { lon: 13.387, lat: 52.532 }]]));
    const listed = await service.list("9");
    expect(listed.stores[0]?.lon).toBeCloseTo(13.4);
    expect(listed.stores[0]?.lat).toBeCloseTo(52.5);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns null revenue for a month marked missing", async () => {
    query
      .mockResolvedValueOnce({ rows: [storeRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            year: 2025,
            month: 2,
            revenue_eur: null,
            updated_at: new Date("2026-03-01T00:00:00.000Z"),
          },
        ],
      });
    await expect(
      service.putRevenue("9", "3", {
        points: [{ year: 2025, month: 2, revenueEur: null }],
      }),
    ).resolves.toEqual({
      points: [
        {
          year: 2025,
          month: 2,
          revenueEur: null,
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO app.store_monthly_revenue"), [
      "3",
      2025,
      2,
      null,
    ]);
  });
});

function storeRow(
  coords: { lon?: number | null; lat?: number | null; postal_code?: string } = {},
) {
  return {
    id: "3",
    label: null,
    street: "Marienplatz 1",
    postal_code: coords.postal_code ?? "80331",
    city: "München",
    country_code: "DE",
    lon: coords.lon ?? null,
    lat: coords.lat ?? null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}
