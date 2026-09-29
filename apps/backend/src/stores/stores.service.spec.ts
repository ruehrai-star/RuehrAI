import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { StoresService } from "./stores.service";

describe("StoresService", () => {
  const query = jest.fn();
  const withTransaction = jest.fn(async (fn: (q: typeof query) => Promise<unknown>) => fn(query));
  let service: StoresService;

  beforeEach(async () => {
    query.mockReset();
    withTransaction.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: DatabaseService, useValue: { query, withTransaction } },
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

function storeRow() {
  return {
    id: "3",
    label: null,
    street: "Marienplatz 1",
    postal_code: "80331",
    city: "München",
    country_code: "DE",
    lon: null,
    lat: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}
