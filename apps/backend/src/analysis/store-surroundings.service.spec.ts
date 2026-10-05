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

  it("resolves Stadtbezirk at the store point and nearest LOR from feature lon/lat, never embeddings", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("geo_ref_plz")) {
        return { rows: [{ plz: "80331", geo_ags: "09162000", geo_ags5: "09162" }] };
      }
      if (text.includes("geo_ref_ortsteil")) {
        return { rows: [{ geo_key: "ortsteil:osm:1", geo_ags: "09162000" }] };
      }
      if (text.includes("geo_ref_bezirk")) {
        return { rows: [{ geo_key: "stadtbezirk:1", geo_ags: "09162000" }] };
      }
      if (text.includes("berlin_lor_ewr_bevoelkerung")) {
        expect(text).not.toMatch(/embedding/i);
        return { rows: [{ geo_key: "lor:110010101", geo_ags: "11000000" }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
    const resolved = await service.resolve([
      {
        id: "7",
        label: null,
        street: "Marienplatz 1",
        postalCode: "80331",
        city: "München",
        lon: 11.58,
        lat: 48.14,
        points: [],
        changes: [],
      },
    ]);
    expect(resolved.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ geoKey: "stadtbezirk:1", level: "stadtbezirk" }),
        expect.objectContaining({ geoKey: "lor:110010101", level: "lor" }),
        expect.objectContaining({ geoKey: "ortsteil:osm:1", level: "ortsteil" }),
      ]),
    );
  });
});
