import { Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { StoreSurroundingsService } from "./store-surroundings.service";

describe("StoreSurroundingsService", () => {
  const queryReadingFeatures = jest.fn();
  let service: StoreSurroundingsService;

  beforeEach(() => {
    queryReadingFeatures.mockReset();
    service = new StoreSurroundingsService({
      queryReadingFeatures,
    } as unknown as DatabaseService);
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

  it("resolves Adresse, Raster, Ortsteil, Bezirk and nearest LOR PLR, never embeddings", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      expect(text).not.toMatch(/embedding/i);
      if (text.includes("geo_ref_plz")) {
        return { rows: [{ plz: "80331", geo_ags: "09162000", geo_ags5: "09162" }] };
      }
      if (text.includes("geo_ref_address")) {
        return { rows: [{ geo_key: "address:marienplatz-1", geo_ags: "09162000" }] };
      }
      if (text.includes("breitband_gitter") || text.includes("grain = 'grid100'")) {
        return { rows: [{ geo_key: "grid:80331:1", geo_ags: "09162000" }] };
      }
      if (text.includes("geo_ref_ortsteil")) {
        return { rows: [{ geo_key: "ortsteil:osm:1", geo_ags: "09162000" }] };
      }
      if (text.includes("geo_ref_bezirk")) {
        return { rows: [{ geo_key: "stadtbezirk:1", geo_ags: "09162000" }] };
      }
      if (text.includes("berlin_lor_ewr_bevoelkerung") && text.includes("lor:plr:%")) {
        return { rows: [{ geo_key: "lor:plr:01100101", geo_ags: "11000000" }] };
      }
      if (text.includes("koeln_statistischer_datenkatalog")) {
        throw new Error("quartier lookup must not run outside Köln");
      }
      return { rows: [] };
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
        expect.objectContaining({ geoKey: "address:marienplatz-1", level: "address" }),
        expect.objectContaining({ geoKey: "grid:80331:1", level: "grid100" }),
        expect.objectContaining({ geoKey: "stadtbezirk:1", level: "stadtbezirk" }),
        expect.objectContaining({ geoKey: "lor:plr:01100101", level: "lor" }),
        expect.objectContaining({ geoKey: "ortsteil:osm:1", level: "ortsteil" }),
      ]),
    );
    expect(resolved.regions.find((item) => item.level === "quartier")).toBeUndefined();
  });

  it("uses geo_addr_id when geo.geo_ref_address has no geo_key column", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("information_schema.columns")) {
        return { rows: [{ column_name: "geo_addr_id" }, { column_name: "geo_ags" }, { column_name: "geom" }] };
      }
      if (text.includes("geo_ref_plz")) {
        return { rows: [{ plz: "12247", geo_ags: "11000000", geo_ags5: "11000" }] };
      }
      if (text.includes("geo_ref_address")) {
        expect(text).toContain("geo_addr_id");
        expect(text).not.toMatch(/a\.geo_key/);
        return { rows: [{ geo_key: "address:510721", geo_ags: "11000000" }] };
      }
      return { rows: [] };
    });
    const resolved = await service.resolve([
      berlinStore("7", 13.35, 52.43),
      berlinStore("8", 13.36, 52.44),
      berlinStore("9", 13.34, 52.42),
    ]);
    expect(resolved.regions).toEqual(
      expect.arrayContaining([expect.objectContaining({ geoKey: "address:510721", level: "address" })]),
    );
  });

  it("skips address without per-store geo_key error logs and still resolves Raster/Ortsteil", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("information_schema.columns")) {
        return { rows: [{ column_name: "geom" }, { column_name: "geo_ags" }] };
      }
      if (text.includes("geo_ref_plz")) {
        return { rows: [{ plz: "12247", geo_ags: "11000000", geo_ags5: "11000" }] };
      }
      if (text.includes("geo_ref_address")) {
        throw Object.assign(new Error("column a.geo_key does not exist"), { code: "42703" });
      }
      if (text.includes("geo_ref_ortsteil")) {
        return { rows: [{ geo_key: "ortsteil:osm:55737", geo_ags: "11000000" }] };
      }
      return { rows: [] };
    });
    const resolved = await service.resolve([
      berlinStore("7", 13.35, 52.43),
      berlinStore("8", 13.36, 52.44),
      berlinStore("9", 13.34, 52.42),
    ]);
    expect(resolved.regions.find((item) => item.level === "address")).toBeUndefined();
    expect(resolved.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ geoKey: "ortsteil:osm:55737", level: "ortsteil" }),
        expect.objectContaining({ geoKey: "12247", level: "plz" }),
      ]),
    );
    const spam = log.mock.calls.filter((call) => String(call[0]).includes("catalog read missed"));
    expect(spam).toHaveLength(0);
    expect(log.mock.calls.some((call) => String(call[0]).includes("no key column"))).toBe(true);
    expect(queryReadingFeatures.mock.calls.filter((call) => String(call[0]).includes("FROM geo.geo_ref_address"))).toHaveLength(
      0,
    );
    log.mockRestore();
  });

  it("treats a missing geo_key column as a single skip, not three catalog errors", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("information_schema.columns")) {
        return { rows: [] };
      }
      if (text.includes("geo_ref_plz")) {
        return { rows: [{ plz: "12247", geo_ags: "11000000", geo_ags5: "11000" }] };
      }
      if (text.includes("FROM geo.geo_ref_address")) {
        throw Object.assign(new Error("column a.geo_key does not exist"), { code: "42703" });
      }
      if (text.includes("geo_ref_ortsteil")) {
        return { rows: [{ geo_key: "ortsteil:osm:55737", geo_ags: "11000000" }] };
      }
      return { rows: [] };
    });
    const resolved = await service.resolve([
      berlinStore("7", 13.35, 52.43),
      berlinStore("8", 13.36, 52.44),
      berlinStore("9", 13.34, 52.42),
    ]);
    expect(resolved.regions.find((item) => item.level === "address")).toBeUndefined();
    expect(resolved.regions).toEqual(
      expect.arrayContaining([expect.objectContaining({ geoKey: "ortsteil:osm:55737", level: "ortsteil" })]),
    );
    const addressQueries = queryReadingFeatures.mock.calls.filter((call) =>
      String(call[0]).includes("FROM geo.geo_ref_address"),
    );
    expect(addressQueries).toHaveLength(1);
    expect(log.mock.calls.filter((call) => String(call[0]).includes("skip address level"))).toHaveLength(1);
    expect(log.mock.calls.filter((call) => String(call[0]).includes("catalog read missed"))).toHaveLength(0);
    log.mockRestore();
  });

  it("skips missing geo_ref_address and still resolves coarser Ebenen", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("geo_ref_plz")) {
        return { rows: [{ plz: "80331", geo_ags: "09162000", geo_ags5: "09162" }] };
      }
      if (text.includes("geo_ref_address")) {
        throw Object.assign(new Error('relation "geo.geo_ref_address" does not exist'), { code: "42P01" });
      }
      return { rows: [] };
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
        expect.objectContaining({ geoKey: "80331", level: "plz" }),
        expect.objectContaining({ geoKey: "09162000", level: "gemeinde" }),
      ]),
    );
    expect(resolved.regions.find((item) => item.level === "address")).toBeUndefined();
  });

  it("resolves Köln Quartier koeln:sq for a Köln store and skips parent_fallback", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("geo_ref_plz")) {
        return { rows: [{ plz: "50667", geo_ags: "05315000", geo_ags5: "05315" }] };
      }
      if (text.includes("koeln_statistischer_datenkatalog")) {
        expect(text).toContain("koeln:sq:%");
        expect(text).toContain("parent_fallback");
        expect(text).not.toMatch(/embedding/i);
        return { rows: [{ geo_key: "koeln:sq:123", geo_ags: "05315000" }] };
      }
      return { rows: [] };
    });
    const resolved = await service.resolve([
      {
        id: "9",
        label: null,
        street: "Domkloster 4",
        postalCode: "50667",
        city: "Köln",
        lon: 6.96,
        lat: 50.94,
        points: [],
        changes: [],
      },
    ]);
    expect(resolved.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ geoKey: "koeln:sq:123", level: "quartier" }),
        expect.objectContaining({ geoKey: "50667", level: "plz" }),
        expect.objectContaining({ geoKey: "05315", level: "kreis" }),
      ]),
    );
  });
});

function berlinStore(id: string, lon: number, lat: number) {
  return {
    id,
    label: null,
    street: "Berliner Straße 1",
    postalCode: "12247",
    city: "Berlin",
    lon,
    lat,
    points: [],
    changes: [],
  };
}
