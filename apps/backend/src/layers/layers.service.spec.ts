import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { LayersService } from "./layers.service";

describe("LayersService", () => {
  const query = jest.fn();
  let service: LayersService;

  beforeEach(async () => {
    query.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [LayersService, { provide: DatabaseService, useValue: { query } }],
    }).compile();
    service = moduleRef.get(LayersService);
  });

  it("returns a GeoJSON FeatureCollection", async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: "demo-plz", name: "Demo-PLZ", description: "Stub" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "plz5:80331",
            properties: { label: "80331 München", stub: true },
            geometry: { type: "Point", coordinates: [11.576, 48.137] },
          },
        ],
      });

    const body = await service.getFeatureCollection("demo-plz");
    expect(body).toEqual({
      type: "FeatureCollection",
      name: "Demo-PLZ",
      description: "Stub",
      features: [
        {
          type: "Feature",
          id: "plz5:80331",
          geometry: { type: "Point", coordinates: [11.576, 48.137] },
          properties: { label: "80331 München", stub: true },
        },
      ],
    });
  });

  it("returns 404 when the layer does not exist", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(service.getFeatureCollection("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
