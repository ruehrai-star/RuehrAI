import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { PlaceCatalogService } from "../geo/place-catalog.service";
import { StoresService } from "./stores.service";

describe("StoresService", () => {
  const query = jest.fn();
  const withTransaction = jest.fn(async (fn: (q: typeof query) => Promise<unknown>) => fn(query));
  const plzCentroids = jest.fn();
  let service: StoresService;

  beforeEach(async () => {
    query.mockReset();
    withTransaction.mockClear();
    plzCentroids.mockReset();
    plzCentroids.mockResolvedValue(new Map());
    const moduleRef = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: DatabaseService, useValue: { query, withTransaction } },
        { provide: PlaceCatalogService, useValue: { plzCentroids } },
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

function storeRow(coords: { lon?: number | null; lat?: number | null } = {}) {
  return {
    id: "3",
    label: null,
    street: "Marienplatz 1",
    postal_code: "80331",
    city: "München",
    country_code: "DE",
    lon: coords.lon ?? null,
    lat: coords.lat ?? null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}
