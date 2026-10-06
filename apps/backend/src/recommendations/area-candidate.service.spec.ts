import { Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AnalysisRegion } from "../analysis/types";
import { AreaCandidateService } from "./area-candidate.service";
import { buildAddressCandidateSql, buildGrid100CandidateSql, buildTeilCatalogSql } from "./area-candidates";

function emptyOptionalSql(text: string): boolean {
  return (
    text.includes("FROM geo.geo_ref_address") ||
    text.includes("FROM geo.geo_ref_lor") ||
    text.includes("source_theme = 'koeln_statistischer_datenkatalog'") ||
    text.includes("berlin_lor_ewr_bevoelkerung") ||
    text.includes("grain = 'address'") ||
    text.includes("grain = 'grid100'") ||
    text.includes("hamburg_stadtteil_regionalstatistik")
  );
}

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

  it("returns catalog kinds minus the region anchor", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
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
    expect(loaded.items.map((item) => item.geoKey)).toEqual(["80801", "ortsteil:osm:1"]);
    expect(loaded.items.map((item) => item.id)).not.toContain("ags:09162000");
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]) === buildAddressCandidateSql())).toBe(true);
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]) === buildGrid100CandidateSql())).toBe(true);
    expect(queryReadingFeatures.mock.calls.some((call) => String(call[0]) === buildTeilCatalogSql("prefer"))).toBe(
      true,
    );
  });

  it("drops a LOR sliver with targetOverlapShare 0.007 and keeps ≥10% plus unknown-share hits", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
      return {
        rows: [
          {
            geo_key: "lor:plr:07501031",
            grain: "other",
            kind: "lor",
            name: "Eisenacher Straße",
            ags: "11000000",
            plz: null,
            lon: 13.38,
            lat: 52.45,
            target_overlap_share: 0.007,
          },
          {
            geo_key: "lor:plr:07400720",
            grain: "other",
            kind: "lor",
            name: "Germaniagarten",
            ags: "11000000",
            plz: null,
            lon: 13.37,
            lat: 52.46,
            target_overlap_share: 1,
          },
          {
            geo_key: "lor:plr:07400721",
            grain: "other",
            kind: "lor",
            name: "Paradestraße",
            ags: "11000000",
            plz: null,
            lon: 13.38,
            lat: 52.46,
            target_overlap_share: 0.12,
          },
          {
            geo_key: "address:1",
            grain: "address",
            kind: "address",
            name: "Tempelhofer Damm 1",
            ags: "11000000",
            plz: "12101",
            lon: 13.38,
            lat: 52.47,
          },
        ],
      };
    });

    const loaded = await service.load([
      region({
        label: "Tempelhof",
        grain: "other",
        geoKey: "ortsteil:osm:162894",
        ags: "11000000",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [13.35, 52.45],
              [13.42, 52.45],
              [13.42, 52.49],
              [13.35, 52.49],
              [13.35, 52.45],
            ],
          ],
        },
      }),
    ]);
    expect(loaded.items.map((item) => item.name)).toEqual([
      "Germaniagarten",
      "Paradestraße",
      "Tempelhofer Damm 1",
    ]);
    expect(loaded.items.map((item) => item.geoKey)).not.toContain("lor:plr:07501031");
  });

  it("skips empty address grain and keeps grid100 as finest when cells exist", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
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
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
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
    expect(loaded.items.map((item) => item.kind)).toEqual(["grid100", "ortsteil"]);
  });

  it("lists LOR Planungsraum as finest over Ortsteil and does not require embeddings", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("geo.geo_ref_lor") && !text.includes("geo_ref_zielregion_teil")) {
        expect(text).not.toMatch(/embedding/i);
        return {
          rows: [
            {
              geo_key: "lor:plr:01100101",
              grain: "other",
              kind: "lor",
              name: "PLR 01100101",
              ags: "11000000",
              plz: null,
              lon: null,
              lat: null,
            },
          ],
        };
      }
      if (text.includes("lor:plr:%") && !text.includes("geo_ref_zielregion_teil")) {
        expect(text).not.toMatch(/embedding/i);
        return {
          rows: [
            {
              geo_key: "lor:plr:01100101",
              grain: "other",
              kind: "lor",
              name: "PLR 01100101",
              ags: "11000000",
              plz: null,
              lon: null,
              lat: null,
            },
          ],
        };
      }
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
      if (text.includes("berlin_lor_ewr_bevoelkerung") && text.includes("NOT LIKE 'lor:plr:%'")) {
        throw new Error("2006 LOR must not be queried when PLR exists");
      }
      return {
        rows: [
          {
            geo_key: "ortsteil:osm:1",
            grain: "other",
            kind: "ortsteil",
            name: "Lankwitz",
            ags: "11000000",
            plz: null,
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
    expect(loaded.items.map((item) => item.kind)).toEqual(["lor", "ortsteil"]);
    expect(loaded.items.map((item) => item.geoKey)).toEqual(["lor:plr:01100101", "ortsteil:osm:1"]);
  });

  it("skips missing geo_ref_address and continues at the next Ebene", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("geo.geo_ref_address")) {
        throw Object.assign(new Error('relation "geo.geo_ref_address" does not exist'), { code: "42P01" });
      }
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
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

  it("falls back to intersect SQL when zielregion_teil is missing", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
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

  it("accepts child_grain lor_plr and lists Tempelhof and Lichterfelde PLR Teilflächen", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("geo_ref_zielregion_teil")) {
        expect(text).toMatch(/'lor_plr'/);
        expect(text).toMatch(/'lor'/);
        expect(text).not.toMatch(/embedding/i);
        return {
          rows: [
            {
              geo_key: "lor:plr:07400720",
              grain: "other",
              kind: "lor",
              name: "Gontermannstraße",
              ags: "11000000",
              plz: null,
              lon: 13.38,
              lat: 52.47,
            },
            {
              geo_key: "lor:plr:07400721",
              grain: "other",
              kind: "lor",
              name: "Paradestraße",
              ags: "11000000",
              plz: null,
              lon: 13.39,
              lat: 52.48,
            },
            {
              geo_key: "lor:plr:06200420",
              grain: "other",
              kind: "lor",
              name: "Lichterfelde Süd",
              ags: "11000000",
              plz: null,
              lon: 13.32,
              lat: 52.41,
            },
            {
              geo_key: "lor:plr:06200421",
              grain: "other",
              kind: "lor",
              name: "Königsberger Straße",
              ags: "11000000",
              plz: null,
              lon: 13.31,
              lat: 52.42,
            },
          ],
        };
      }
      if (emptyOptionalSql(text)) return { rows: [] };
      return { rows: [] };
    });

    const loaded = await service.load([
      region({
        label: "Tempelhof",
        grain: "other",
        geoKey: "ortsteil:osm:162894",
        ags: "11000000",
        geometry: null,
      }),
      region({
        label: "Lichterfelde",
        grain: "other",
        geoKey: "ortsteil:osm:55737",
        ags: "11000000",
        geometry: null,
      }),
    ]);
    const plr = loaded.items.filter((item) => item.kind === "lor");
    expect(plr.map((item) => item.geoKey)).toEqual(
      expect.arrayContaining([
        "lor:plr:07400720",
        "lor:plr:07400721",
        "lor:plr:06200420",
        "lor:plr:06200421",
      ]),
    );
    expect(plr.every((item) => item.kind === "lor")).toBe(true);
    expect(
      queryReadingFeatures.mock.calls.some(
        (call) => String(call[0]).includes("geo_ref_zielregion_teil") && String(call[0]).includes("lor_plr"),
      ),
    ).toBe(true);
  });

  it("parses clipped GeoJSON outlines and explains when geometry is missing", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
      return {
        rows: [
          {
            geo_key: "80801",
            grain: "plz5",
            kind: "plz",
            name: "80801",
            ags: "09162000",
            plz: "80801",
            lon: 11.58,
            lat: 48.16,
            geometry_geojson: JSON.stringify({
              type: "Polygon",
              coordinates: [
                [
                  [11.5, 48.1],
                  [11.6, 48.1],
                  [11.6, 48.2],
                  [11.5, 48.2],
                  [11.5, 48.1],
                ],
              ],
            }),
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
    const plz = loaded.items.find((item) => item.geoKey === "80801");
    const ortsteil = loaded.items.find((item) => item.geoKey === "ortsteil:osm:1");
    expect(plz?.geometry?.type).toBe("Polygon");
    expect(plz?.geometryUnavailableReason).toBeNull();
    expect(ortsteil?.geometry).toBeNull();
    expect(ortsteil?.geometryUnavailableReason).toMatch(/gezeichnet/);
  });

  it("swallows a missing geo catalog", async () => {
    queryReadingFeatures.mockRejectedValue(
      Object.assign(new Error('relation "geo.geo_ref_ortsteil" does not exist'), { code: "42P01" }),
    );
    await expect(service.load([region()])).resolves.toEqual({ items: [], truncated: false });
  });

  it("does not scan addresses or 100-m grid for a Bezirk Zielregion", async () => {
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      expect(text).not.toContain("geo.geo_ref_address");
      expect(text).not.toContain("grain = 'grid100'");
      if (text.includes("geo_ref_zielregion_teil")) {
        return {
          rows: [
            {
              geo_key: "ortsteil:osm:1",
              grain: "other",
              kind: "ortsteil",
              name: "Altstadt-Süd",
              ags: "05315000",
              plz: null,
              lon: 6.96,
              lat: 50.93,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const loaded = await service.load([
      region({
        label: "Innenstadt",
        grain: "other",
        geoKey: "bezirk:osm:2613798",
        level: "bezirk",
        ags: "05315000",
      }),
    ]);
    expect(loaded.items.map((item) => item.geoKey)).toEqual(["ortsteil:osm:1"]);
  });

  it("keeps an overlapping Fläche once per Zielregion with unique ids and per-region geometry", async () => {
    const leftGeom = {
      type: "Polygon" as const,
      coordinates: [
        [
          [13.3, 52.4],
          [13.35, 52.4],
          [13.35, 52.45],
          [13.3, 52.45],
          [13.3, 52.4],
        ],
      ],
    };
    const rightGeom = {
      type: "Polygon" as const,
      coordinates: [
        [
          [13.35, 52.4],
          [13.4, 52.4],
          [13.4, 52.45],
          [13.35, 52.45],
          [13.35, 52.4],
        ],
      ],
    };
    queryReadingFeatures.mockImplementation(async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
      const asText = JSON.stringify(params ?? []);
      const isLeft = asText.includes("ortsteil:osm:licht");
      const isRight = asText.includes("ortsteil:osm:steg");
      if (!isLeft && !isRight) return { rows: [] };
      return {
        rows: [
          {
            geo_key: "12207",
            grain: "plz5",
            kind: "plz",
            name: "12207",
            ags: null,
            plz: "12207",
            lon: 13.35,
            lat: 52.42,
            geometry_geojson: JSON.stringify(isLeft ? leftGeom : rightGeom),
          },
        ],
      };
    });

    const loaded = await service.load([
      region({
        label: "Lichterfelde",
        grain: "other",
        geoKey: "ortsteil:osm:licht",
        ags: null,
        plz: null,
        geometry: leftGeom,
      }),
      region({
        label: "Steglitz",
        grain: "other",
        geoKey: "ortsteil:osm:steg",
        ags: null,
        plz: null,
        geometry: rightGeom,
      }),
    ]);
    const hits = loaded.items.filter((item) => item.geoKey === "12207");
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((item) => item.id)).size).toBe(2);
    expect(hits.map((item) => item.targetRegionGeoKey).sort()).toEqual(["ortsteil:osm:licht", "ortsteil:osm:steg"]);
    expect(hits[0]?.id).toContain("@");
    expect(hits[0]?.geometry).not.toEqual(hits[1]?.geometry);
  });

  it("stamps ags:{ags} when geoKey is missing and warns", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (emptyOptionalSql(text) && !text.includes("geo.geo_ref_zielregion_teil")) return { rows: [] };
      return {
        rows: [
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
        ],
      };
    });
    const loaded = await service.load([region({ geoKey: null, ags: "09162000", label: "München" })]);
    expect(loaded.items.some((item) => item.targetRegionGeoKey === "ags:09162000")).toBe(true);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("ags:09162000"))).toBe(true);
    warn.mockRestore();
  });
});
