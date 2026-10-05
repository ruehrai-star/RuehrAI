import { DatabaseService } from "../database/database.service";
import { BrainSearchService, buildEmbeddingQuery } from "./brain-search.service";
import { OmlxClient } from "./omlx.client";
import { AnalysisInput } from "./types";

const columns = [
  "id",
  "geo_key",
  "grain",
  "ref_period",
  "name",
  "title",
  "content",
  "metadata",
  "source_theme",
].map((column_name) => ({ column_name }));

function input(): AnalysisInput {
  return {
    region: {
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
      plz: "80331",
      lon: 11.5,
      lat: 48.1,
      bounds: null,
      geometry: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    stores: [
      {
        id: "3",
        label: null,
        street: "Marienplatz 1",
        postalCode: "80331",
        city: "München",
        lon: null,
        lat: null,
        points: [],
        changes: [],
      },
    ],
    revenueDirection: "up",
    capturedAt: "2026-04-01T00:00:00.000Z",
  };
}

describe("BrainSearchService", () => {
  const queryReadingFeatures = jest.fn();
  const embed = jest.fn();
  const vectorGate = jest.fn();
  let service: BrainSearchService;

  beforeEach(() => {
    queryReadingFeatures.mockReset();
    embed.mockReset();
    vectorGate.mockReset();
    vectorGate.mockReturnValue("embeddings_unconfigured");
    service = new BrainSearchService(
      { queryReadingFeatures } as unknown as DatabaseService,
      { embed, vectorGate } as unknown as OmlxClient,
    );
  });

  it("returns no facts when Brain relations are not installed", async () => {
    queryReadingFeatures.mockResolvedValue({ rows: [] });
    await expect(service.search(input())).resolves.toEqual({
      mode: "sql",
      vectorUnavailableReason: "features_unavailable",
      factCount: 0,
      facts: [],
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it("filters the search view by region and reads metadata signals", async () => {
    queryReadingFeatures
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: columns })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "9",
            geo_key: "09162000",
            grain: "ags",
            name: "München",
            ref_period: "2022-05",
            title: "Gemeinde München",
            content: "Einwohner und Haushalte.",
            metadata: { einwohner: 1500000, gemeinde_name: "München" },
            source_theme: "zensus",
            distance: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.search(input());
    expect(result.mode).toBe("sql");
    expect(result.vectorUnavailableReason).toBe("embeddings_unconfigured");
    expect(result.facts).toEqual([
      expect.objectContaining({
        id: "9",
        geoKey: "09162000",
        matchedBy: "region",
        excerpt: "Einwohner und Haushalte.",
        signals: [
          { key: "source_theme", value: "zensus" },
          { key: "einwohner", value: "1500000" },
        ],
      }),
    ]);
    const regionSql = String(queryReadingFeatures.mock.calls[2]?.[0]);
    expect(regionSql).toContain("features.v_location_search");
    expect(regionSql).not.toContain("<=>");
    expect(queryReadingFeatures.mock.calls[2]?.[1]).toEqual([
      "09162000",
      "80331",
      "09162000",
      null,
    ]);
  });

  it("rounds count-like Brain metadata floats and leaves shares fractional", async () => {
    queryReadingFeatures
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: columns })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11",
            geo_key: "11000000",
            grain: "ags",
            name: "Berlin",
            ref_period: "2024|wohnungen",
            title: "Berlin",
            content: "Wohnungen und Einwohner.",
            metadata: {
              wohnungen: 413771.33,
              ewz: 742286.33,
              pkw_elektro_anteil: 4.1,
              gemeinde_name: "Berlin",
            },
            source_theme: "destatis_wohnungen",
            distance: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.search(input());
    expect(result.facts[0]?.signals).toEqual(
      expect.arrayContaining([
        { key: "source_theme", value: "destatis_wohnungen" },
        { key: "wohnungen", value: "413771" },
        { key: "ewz", value: "742286" },
        { key: "pkw_elektro_anteil", value: "4.1" },
      ]),
    );
    expect(result.facts[0]?.signals.find((signal) => signal.key === "wohnungen")?.value).not.toContain(".");
  });

  it("uses a query embedding and cosine order when oMLX answers", async () => {
    vectorGate.mockReturnValue("ready");
    embed.mockResolvedValue({ ok: true, vector: [0.2, 0.4] });
    queryReadingFeatures
      .mockResolvedValueOnce({
        rows: [...columns, { column_name: "embedding" }],
      })
      .mockResolvedValueOnce({ rows: columns })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "4",
            geo_key: "09162000",
            grain: "ags",
            name: "München",
            ref_period: "2022-05",
            title: "Gemeinde München",
            content: null,
            metadata: {},
            source_theme: null,
            distance: 0.125,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.search(input());
    expect(embed).toHaveBeenCalledWith(expect.stringContaining("AGS 09162000"));
    expect(result.mode).toBe("vector");
    expect(result.vectorUnavailableReason).toBeNull();
    expect(result.facts[0]).toMatchObject({ id: "4", distance: 0.125, matchedBy: "region" });
    expect(String(queryReadingFeatures.mock.calls[2]?.[0])).toContain("embedding <=> $5::vector");
    expect(queryReadingFeatures.mock.calls[2]?.[1]?.[4]).toBe("[0.2,0.4]");
  });

  it("keeps the SQL filter when the embeddings call fails", async () => {
    vectorGate.mockReturnValue("ready");
    embed.mockResolvedValue({ ok: false, reason: "embeddings_unreachable" });
    queryReadingFeatures
      .mockResolvedValueOnce({ rows: [...columns, { column_name: "embedding" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.search(input());
    expect(result.mode).toBe("sql");
    expect(result.vectorUnavailableReason).toBe("embeddings_unreachable");
    const sql = String(queryReadingFeatures.mock.calls[2]?.[0]);
    expect(sql).not.toContain("<=>");
  });

  it("falls back when pgvector rejects the query vector", async () => {
    vectorGate.mockReturnValue("ready");
    embed.mockResolvedValue({ ok: true, vector: [0.1, 0.2] });
    queryReadingFeatures
      .mockResolvedValueOnce({ rows: [...columns, { column_name: "embedding" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error("different vector dimensions"), { code: "22000" }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.search(input());
    expect(result.mode).toBe("sql");
    expect(result.vectorUnavailableReason).toBe("vector_query_failed");
  });

  it("builds a German retrieval query from the region and stores", () => {
    expect(buildEmbeddingQuery(input())).toContain("München");
    expect(buildEmbeddingQuery(input())).toContain("80331");
    expect(buildEmbeddingQuery(input())).toContain("Haushalte");
  });
});
