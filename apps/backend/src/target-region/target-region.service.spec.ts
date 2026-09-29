import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { TargetRegionService } from "./target-region.service";

describe("TargetRegionService", () => {
  const query = jest.fn();
  let service: TargetRegionService;

  beforeEach(async () => {
    query.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [TargetRegionService, { provide: DatabaseService, useValue: { query } }],
    }).compile();
    service = moduleRef.get(TargetRegionService);
  });

  it("returns 404 when the user has no region", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.get("4")).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("app.target_regions"), ["4"]);
  });

  it("stores omitted geo fields as null for that user only", async () => {
    query.mockResolvedValue({
      rows: [
        {
          label: "München",
          grain: null,
          geo_key: null,
          ags: null,
          plz: null,
          lon: null,
          lat: null,
          updated_at: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
    });
    await expect(service.put("4", { label: " München " })).resolves.toEqual({
      label: "München",
      grain: null,
      geoKey: null,
      ags: null,
      plz: null,
      lon: null,
      lat: null,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO app.target_regions"), [
      "4",
      "München",
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("rejects a lon without a lat", async () => {
    await expect(service.put("4", { label: "München", lon: 11.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
