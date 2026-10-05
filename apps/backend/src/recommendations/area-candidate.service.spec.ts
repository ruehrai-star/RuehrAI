import { DatabaseService } from "../database/database.service";
import { AnalysisRegion } from "../analysis/types";
import { AreaCandidateService } from "./area-candidate.service";
import { buildAddressCandidateSql, buildGrid100CandidateSql, buildTeilCatalogSql } from "./area-candidates";

function region(overrides: Partial<AnalysisRegion> = {}): AnalysisRegion {
  return {
    label: "München",
    grain: "ags",
    geoKey: "09162000",
    ags: "09162000",
    plz: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [11.4, 48.0],
          [11.7, 48.0],
          [11.7, 48.3],
          [11.4, 48.3],
          [11.4, 48.0],
        ],
      ],
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AreaCandidateService", () => {
  const queryReadingFeatures = jest.fn();
  const service = new AreaCandidateService({ queryReadingFeatures } as unknown as DatabaseService);

  beforeEach(() => {
    queryReadingFeatures.mockReset();
  });

  it("returns only the finest hits and drops the region anchor", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("grain = 'address'")) return { rows: [] };
      if (text.includes("grain = 'grid100'")) return { rows: [] };
      return {
        rows: [
          {
            geo_key: "09162000",
            grain: "ags",
            kind: "gemeinde",
            name: "München",
            ags: "09162000",
            plz: null,
            lon: 11.5,
            lat: 48.1,
          },
          {
            geo_key: "80801",
            grain: "plz5",
            kind: "plz",
            name: "80801",
            ags: "09162000",
            plz: "80801",
            lon: 11.58,
            lat: 48.16,
          },
          {
            geo_key: "ortsteil:osm:1",
            grain: "other",
            kind: "ortsteil",
            name: "Schwabing",
            ags: "09162000",
            plz: null,
            lon: 11.58,
            lat: 48.16,
          },
        ],
      };
    });

    const loaded = await service.load([region()]);
    expect(loaded.items.map((item) => item.geoKey)).toEqual(["ortsteil:osm:1"]);
    expect(loaded.items.map((item) => item.id)).not.toContain("ags:09162000");
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]) === buildAddressCandidateSql())).toBe(true);
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]) === buildGrid100CandidateSql())).toBe(true);
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]) === buildTeilCatalogSql("prefer"))).toBe(
      true,
    );
  });

  it("skips empty address grain and keeps grid100 as finest when cells exist", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("grain = 'address'")) return { rows: [] };
      if (text.includes("grain = 'grid100'")) {
        return {
          rows: [
            {
              geo_key: "cell-1",
              grain: "grid100",
              kind: "grid100",
              name: "cell-1",
              ags: "09162000",
              plz: null,
              lon: 11.5,
              lat: 48.1,
            },
          ],
        };
      }
      return {
        rows: [
          {
            geo_key: "ortsteil:osm:1",
            grain: "other",
            kind: "ortsteil",
            name: "Schwabing",
            ags: "09162000",
            plz: null,
            lon: 11.58,
            lat: 48.16,
          },
        ],
      };
    });

    const loaded = await service.load([region()]);
    expect(loaded.items.map((item) => item.kind)).toEqual(["grid100"]);
  });

  it("lists LOR as finest when Ortsteile are absent and does not require embeddings", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("grain = 'address'") || text.includes("grain = 'grid100'")) return { rows: [] };
      if (text.includes("hamburg_stadtteil_regionalstatistik")) return { rows: [] };
      if (text.includes("berlin_lor_ewr_bevoelkerung")) {
        expect(text).not.toMatch(/embedding/i);
        return {
          rows: [
            {
              geo_key: "lor:110010101",
              grain: "other",
              kind: "lor",
              name: "LOR 101",
              ags: "11000000",
              plz: null,
              lon: null,
              lat: null,
            },
          ],
        };
      }
      return {
        rows: [
          {
            geo_key: "12247",
            grain: "plz5",
            kind: "plz",
            name: "12247",
            ags: "11000000",
            plz: "12247",
            lon: 13.3,
            lat: 52.4,
          },
        ],
      };
    });

    const loaded = await service.load([
      region({
        label: "Berlin",
        geoKey: "11000000",
        ags: "11000000",
        geometry: null,
      }),
    ]);
    expect(loaded.items.map((item) => item.kind)).toEqual(["lor"]);
    expect(loaded.items.map((item) => item.geoKey)).toEqual(["lor:110010101"]);
  });

  it("falls back to intersect SQL when zielregion_teil is missing", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("grain = 'address'") || text.includes("grain = 'grid100'")) return { rows: [] };
      if (text.includes("geo_ref_zielregion_teil")) {
        throw Object.assign(new Error('relation "geo.geo_ref_zielregion_teil" does not exist'), { code: "42P01" });
      }
      return {
        rows: [
          {
            geo_key: "ortsteil:osm:1",
            grain: "other",
            kind: "ortsteil",
            name: "Schwabing",
            ags: "09162000",
            plz: null,
            lon: 11.58,
            lat: 48.16,
          },
        ],
      };
    });

    const loaded = await service.load([region()]);
    expect(loaded.items.map((item) => item.geoKey)).toEqual(["ortsteil:osm:1"]);
  });

  it("returns an empty list only when geo_ref has no sub-area", async () => {
    queryReadingFeatures.mockResolvedValue({ rows: [] });
    await expect(service.load([region()])).resolves.toEqual({ items: [], truncated: false });
  });

  it("swallows a missing geo catalog", async () => {
    queryReadingFeatures.mockRejectedValue(
      Object.assign(new Error('relation "geo.geo_ref_ortsteil" does not exist'), { code: "42P01" }),
    );
    await expect(service.load([region()])).resolves.toEqual({ items: [], truncated: false });
  });
});
