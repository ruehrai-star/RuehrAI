import { DatabaseService } from "../database/database.service";
import { StoreSurroundingsService } from "./store-surroundings.service";

describe("StoreSurroundingsService", () => {
  const queryReadingFeatures = jest.fn();
  const service = new StoreSurroundingsService({
    queryReadingFeatures,
  } as unknown as DatabaseService);

  beforeEach(() => {
    queryReadingFeatures.mockReset();
  });

  it("resolves PLZ, Gemeinde and Kreis of the store, not the Zielregion", async () => {
    queryReadingFeatures.mockResolvedValue({
      rows: [{ plz: "80331", geo_ags: "09162000", geo_ags5: "09162" }],
    });
    const resolved = await service.resolve([
      {
        id: "7",
        label: null,
        street: "Marienplatz 1",
        postalCode: "80331",
        city: "München",
        lon: null,
        lat: null,
        points: [],
        changes: [],
      },
    ]);
    expect(resolved.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ geoKey: "80331", level: "plz" }),
        expect.objectContaining({ geoKey: "09162000", level: "gemeinde" }),
        expect.objectContaining({ geoKey: "09162", level: "kreis" }),
      ]),
    );
    expect(resolved.keys).toEqual(expect.arrayContaining(["80331", "09162000", "09162"]));
    expect(String(queryReadingFeatures.mock.calls[0]?.[0])).toContain("geo.geo_ref_plz");
  });
});
