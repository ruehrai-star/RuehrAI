import { AnalysisRegion } from "../analysis/types";
import {
  AREA_CANDIDATE_LIMIT,
  addressCandidateQuery,
  adminGeom4326,
  areaCandidateParams,
  areaCandidateQuery,
  buildAddressCandidateSql,
  buildAreaCandidateSql,
  buildGeoAddressCandidateSql,
  buildGrid100CandidateSql,
  buildHamburgStadtteilFallbackSql,
  buildKoelnQuartierCandidateSql,
  buildLorFeatureCandidateSql,
  buildLorPlrCatalogSql,
  buildLorPlrFeatureCandidateSql,
  buildTeilCatalogSql,
  geoAddressCandidateQuery,
  grid100CandidateQuery,
  hamburgStadtteilFallbackQuery,
  highestSqlPlaceholder,
  hitOverlapQuery,
  isRegionAnchor,
  koelnQuartierCandidateQuery,
  lorFeatureCandidateQuery,
  lorPlrCatalogQuery,
  lorPlrFeatureCandidateQuery,
  municipalityAgsForRegion,
  municipalityNameQuery,
  overlapEligibleKind,
  parentMemberships,
  selectCatalogHits,
  selectFinestHits,
  skipAddressAndGridForRegion,
  clipToRegionSql,
  clippedHitGeoJsonSql,
  overlapJoinSql,
  overlapShareSql,
  teilCatalogQuery,
  resolveTargetRegionKey,
  targetRegionKeyOf,
  normalizeTargetRegionLabel,
} from "./area-candidates";

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

describe("area candidate SQL", () => {
  it("reads parent→child from geo_ref_zielregion_teil and uses admin 4326, never embeddings", () => {
    const sql = buildTeilCatalogSql();
    expect(sql).toContain("geo.geo_ref_zielregion_teil");
    expect(sql).toContain("geo.geo_ref_ortsteil");
    expect(sql).toContain("geo.geo_ref_bezirk");
    expect(sql).toContain("geo.geo_ref_plz");
    expect(sql).toContain("geo.geo_ref_admin");
    expect(sql).toContain("geom_4326");
    expect(sql).toContain("geom_display");
    expect(sql).toContain(`LIMIT ${AREA_CANDIDATE_LIMIT}`);
    expect(sql).toContain("ST_Intersection");
    expect(sql).toContain("ST_AsGeoJSON");
    expect(sql).toContain("geometry_geojson");
    expect(sql).toMatch(/SELECT geo_key, grain, kind, name, ags, plz, lon, lat, geometry_geojson/);
    expect(sql).not.toContain("<=>");
    expect(sql).not.toMatch(/embedding/i);
    expect(adminGeom4326("a", "prefer")).toContain("geom_4326");
    expect(adminGeom4326("a", "legacy")).toContain("3035");
  });

  it("probes address and grid100 feature docs without embeddings", () => {
    const address = buildAddressCandidateSql();
    const grid = buildGrid100CandidateSql();
    expect(address).toContain("grain = 'address'");
    expect(grid).toContain("grain = 'grid100'");
    expect(grid).toContain("breitband_gitter");
    expect(address).not.toContain("<=>");
    expect(grid).not.toContain("<=>");
  });

  it("loads Berlin LOR PLR, Köln quartier, Hamburg fallback, and official addresses without embeddings", () => {
    const lor = buildLorFeatureCandidateSql();
    const plrCatalog = buildLorPlrCatalogSql();
    const plrFeature = buildLorPlrFeatureCandidateSql();
    const quartier = buildKoelnQuartierCandidateSql();
    const geoAddress = buildGeoAddressCandidateSql();
    const hamburg = buildHamburgStadtteilFallbackSql();
    const teil = buildTeilCatalogSql();
    expect(lor).toContain("berlin_lor_ewr_bevoelkerung");
    expect(lor).toContain("NOT LIKE 'lor:plr:%'");
    expect(lor).not.toContain("<=>");
    expect(lor).not.toMatch(/embedding/i);
    expect(plrCatalog).toContain("geo.geo_ref_lor");
    expect(plrCatalog).toContain("lor_level");
    expect(plrCatalog).toContain("valid_to");
    expect(plrCatalog).not.toContain("lor_version");
    expect(plrCatalog).toContain("geo_lor_id");
    expect(plrCatalog).not.toContain("l.geo_key");
    expect(plrCatalog).not.toContain("lor_version");
    expect(plrCatalog).toContain("WHEN l.geo_lor_id::text LIKE 'lor:%'");
    expect(plrCatalog).toContain("NULLIF(btrim(l.name), '') AS name");
    expect(plrCatalog).toContain("ST_Intersection");
    expect(plrCatalog).toContain("geometry_geojson");
    expect(plrFeature).toContain("lor:plr:%");
    expect(plrFeature).not.toMatch(/embedding/i);
    expect(quartier).toContain("koeln:sq:%");
    expect(quartier).toContain("parent_fallback");
    expect(quartier).toContain("$3");
    expect(quartier).toContain("ST_Intersects");
    expect(geoAddress).toContain("geo.geo_ref_address");
    expect(geoAddress).toContain("geo_addr_id");
    expect(geoAddress).toContain("geom_3035");
    expect(geoAddress).toContain("a.strasse");
    expect(geoAddress).toContain("a.hnr");
    expect(geoAddress).not.toContain("a.name");
    expect(geoAddress).not.toMatch(/embedding/i);
    expect(hamburg).toContain("hamburg_stadtteil_regionalstatistik");
    expect(teil).toMatch(/child_grain\)\) IN \('lor', 'lor_plr'\)/);
    expect(teil).toContain("geo.geo_ref_lor");
    expect(teil).toContain("NULLIF(btrim(l.name), '') AS name");
    expect(teil).toContain("koeln_statistischer_datenkatalog");
    expect(teil).not.toContain("name = child_id");
    expect(teil).toContain("koeln_quartier");
    expect(teil).toContain("WHEN 'lor' THEN 2");
    expect(teil).toContain("WHEN 'quartier' THEN 2");
    expect(teil).toContain("WHEN 'ortsteil' THEN 3");
  });

  it("keeps an intersect fallback that still avoids treating admin geom as WGS84", () => {
    const sql = buildAreaCandidateSql();
    expect(sql).toContain("ST_Intersects");
    expect(sql).toContain("ST_GeomFromGeoJSON");
    expect(sql).toContain("geom_4326");
    expect(sql).toContain("geo_key IS DISTINCT FROM $4");
    expect(sql).toContain("ST_Intersection");
    expect(sql).toMatch(/SELECT geo_key, grain, kind, name, ags, plz, lon, lat, geometry_geojson/);
    expect(sql).toContain("FROM geo.geo_ref_admin a, region_geom g");
  });

  it("sends geometry and Kreis parent memberships for Gemeinden", () => {
    const city = areaCandidateParams(region());
    expect(city[0]).toContain("Polygon");
    expect(city[1]).toBe("09162000");
    expect(city[5]).toBe(false);

    const membership = parentMemberships(region());
    expect(membership.grains).toContain("gemeinde");
    expect(membership.ids).toContain("09162000");

    const kreis = parentMemberships(
      region({
        label: "Köln",
        grain: "ags5",
        geoKey: "05315",
        ags: "05315",
        geometry: null,
      }),
    );
    expect(kreis.grains).toContain("kreis");
    expect(kreis.ids).toContain("05315");

    const plr = parentMemberships(
      region({
        label: "Gontermannstraße",
        grain: "other",
        geoKey: "lor:plr:07400720",
        ags: "11000000",
        geometry: null,
      }),
    );
    expect(plr.grains).toEqual(expect.arrayContaining(["lor", "lor_plr", "gemeinde"]));
    expect(plr.ids).toContain("lor:plr:07400720");
  });

  it("derives Köln AGS from the region parentLabel when ags is missing", () => {
    expect(
      municipalityAgsForRegion(
        region({
          label: "Innenstadt",
          grain: "other",
          geoKey: "bezirk:osm:1",
          ags: null,
          level: "bezirk",
          parentLabel: "Köln",
          geometry: null,
        }),
      ),
    ).toBe("05315000");
    expect(municipalityAgsForRegion(region({ label: "Hamburg", parentLabel: null, geoKey: "02000000", ags: "02000000" }))).toBe("02000000");
  });
});

describe("selectFinestHits", () => {
  const regions = [region()];

  it("keeps Ortsteile and drops parent PLZ, Bezirk, and Gemeinde", () => {
    const hits = selectFinestHits(
      [
        {
          id: "ags:09162000",
          geoKey: "09162000",
          grain: "ags",
          kind: "gemeinde",
          title: "München",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
        {
          id: "plz5:80801",
          geoKey: "80801",
          grain: "plz5",
          kind: "plz",
          title: "80801",
          name: "80801",
          ags: "09162000",
          plz: "80801",
          lon: null,
          lat: null,
        },
        {
          id: "other:ortsteil:osm:1",
          geoKey: "ortsteil:osm:1",
          grain: "other",
          kind: "ortsteil",
          title: "Schwabing",
          name: "Schwabing",
          ags: "09162000",
          plz: null,
          lon: 11.58,
          lat: 48.16,
        },
        {
          id: "other:stadtbezirk:4",
          geoKey: "stadtbezirk:4",
          grain: "other",
          kind: "stadtbezirk",
          title: "Schwabing-West",
          name: "Schwabing-West",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
      ],
      regions,
    );
    expect(hits.map((item) => item.geoKey)).toEqual(["ortsteil:osm:1"]);
  });

  it("promotes to PLZ only when no finer hit exists", () => {
    const hits = selectFinestHits(
      [
        {
          id: "plz5:80801",
          geoKey: "80801",
          grain: "plz5",
          kind: "plz",
          title: "80801",
          name: "80801",
          ags: "09162000",
          plz: "80801",
          lon: null,
          lat: null,
        },
        {
          id: "ags:09162000",
          geoKey: "09162000",
          grain: "ags",
          kind: "gemeinde",
          title: "München",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
      ],
      regions,
    );
    expect(hits.map((item) => item.kind)).toEqual(["plz"]);
  });

  it("prefers grid100 over Ortsteil when raster cells exist", () => {
    const hits = selectFinestHits(
      [
        {
          id: "grid100:cell-1",
          geoKey: "cell-1",
          grain: "grid100",
          kind: "grid100",
          title: "cell-1",
          name: "cell-1",
          ags: "09162000",
          plz: null,
          lon: 11.5,
          lat: 48.1,
        },
        {
          id: "other:ortsteil:osm:1",
          geoKey: "ortsteil:osm:1",
          grain: "other",
          kind: "ortsteil",
          title: "Schwabing",
          name: "Schwabing",
          ags: "09162000",
          plz: null,
          lon: 11.58,
          lat: 48.16,
        },
      ],
      regions,
    );
    expect(hits.map((item) => item.kind)).toEqual(["grid100"]);
  });

  it("keeps LOR Planungsraum / Quartier over Ortsteil, and Ortsteil over PLZ", () => {
    const lor = {
      id: "other:lor:plr:01100101",
      geoKey: "lor:plr:01100101",
      grain: "other" as const,
      kind: "lor" as const,
      title: "PLR 01100101",
      name: "PLR 01100101",
      ags: "11000000",
      plz: null,
      lon: null,
      lat: null,
    };
    const quartier = {
      id: "other:koeln:sq:1",
      geoKey: "koeln:sq:1",
      grain: "other" as const,
      kind: "quartier" as const,
      title: "Belgisches Viertel",
      name: "Belgisches Viertel",
      ags: "05315000",
      plz: null,
      lon: null,
      lat: null,
    };
    const plz = {
      id: "plz5:12247",
      geoKey: "12247",
      grain: "plz5" as const,
      kind: "plz" as const,
      title: "12247",
      name: "12247",
      ags: "11000000",
      plz: "12247",
      lon: null,
      lat: null,
    };
    const ortsteil = {
      id: "other:ortsteil:osm:1",
      geoKey: "ortsteil:osm:1",
      grain: "other" as const,
      kind: "ortsteil" as const,
      title: "Lankwitz",
      name: "Lankwitz",
      ags: "11000000",
      plz: null,
      lon: 13.3,
      lat: 52.4,
    };
    const lor2006 = {
      id: "other:lor:110010101",
      geoKey: "lor:110010101",
      grain: "other" as const,
      kind: "lor" as const,
      title: "LOR 2006",
      name: "LOR 2006",
      ags: "11000000",
      plz: null,
      lon: null,
      lat: null,
    };
    expect(selectFinestHits([lor, plz], [region({ geoKey: "11000000", ags: "11000000" })]).map((item) => item.kind)).toEqual(
      ["lor"],
    );
    expect(
      selectFinestHits([lor, ortsteil, plz], [region({ geoKey: "11000000", ags: "11000000" })]).map((item) => item.kind),
    ).toEqual(["lor"]);
    expect(
      selectFinestHits([quartier, ortsteil], [region({ geoKey: "05315000", ags: "05315000" })]).map((item) => item.kind),
    ).toEqual(["quartier"]);
    expect(
      selectFinestHits([lor, lor2006, ortsteil], [region({ geoKey: "11000000", ags: "11000000" })]).map(
        (item) => item.geoKey,
      ),
    ).toEqual(["lor:plr:01100101"]);
  });

  it("never treats the Zielregion geoKey as a hit", () => {
    expect(
      isRegionAnchor(
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
        { geoKey: "09162000", grain: "ags", ags: "09162000", plz: null },
      ),
    ).toBe(true);
    const hits = selectFinestHits(
      [
        {
          id: "ags:09162000",
          geoKey: "09162000",
          grain: "ags",
          kind: "gemeinde",
          title: "München",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
      ],
      regions,
    );
    expect(hits).toEqual([]);
  });
});

describe("selectCatalogHits", () => {
  it("keeps every kind except the Zielregion anchor and 2006 LOR when PLR exists", () => {
    const hits = selectCatalogHits(
      [
        {
          id: "ags:09162000",
          geoKey: "09162000",
          grain: "ags",
          kind: "gemeinde",
          title: "München",
          name: "München",
          ags: "09162000",
          plz: null,
          lon: null,
          lat: null,
        },
        {
          id: "plz5:80801",
          geoKey: "80801",
          grain: "plz5",
          kind: "plz",
          title: "80801",
          name: "80801",
          ags: "09162000",
          plz: "80801",
          lon: null,
          lat: null,
        },
        {
          id: "other:ortsteil:osm:1",
          geoKey: "ortsteil:osm:1",
          grain: "other",
          kind: "ortsteil",
          title: "Schwabing",
          name: "Schwabing",
          ags: "09162000",
          plz: null,
          lon: 11.58,
          lat: 48.16,
        },
      ],
      [region()],
    );
    expect(hits.map((item) => item.kind)).toEqual(["plz", "ortsteil"]);
  });

  it("skips address and grid scans for Bezirk and Gemeinde Zielregionen", () => {
    expect(skipAddressAndGridForRegion(region({ level: "bezirk", grain: "other", geoKey: "bezirk:osm:1" }))).toBe(true);
    expect(skipAddressAndGridForRegion(region({ level: "gemeinde", grain: "ags" }))).toBe(false);
    expect(
      skipAddressAndGridForRegion(
        region({ level: "ortsteil", grain: "other", geoKey: "ortsteil:osm:1" }),
      ),
    ).toBe(false);
  });
});


describe("clippedHitGeoJsonSql", () => {
  it("emits ST_Intersection and ST_AsGeoJSON for map outlines", () => {
    const sql = clippedHitGeoJsonSql("hit.geom");
    expect(sql).toContain("ST_Intersection");
    expect(sql).toContain("ST_AsGeoJSON");
    expect(sql).toContain("g.geom");
  });
});

describe("candidate query arity (SQL $n vs params from loadRegion)", () => {
  const muenchen = region();
  const tempelhof = region({
    label: "Tempelhof",
    grain: "other",
    geoKey: "ortsteil:osm:162894",
    ags: "11000000",
    geometry: null,
  });

  it.each([
    ["geoAddressCandidateQuery", geoAddressCandidateQuery],
    ["addressCandidateQuery", addressCandidateQuery],
    ["grid100CandidateQuery", grid100CandidateQuery],
    ["lorPlrCatalogQuery", lorPlrCatalogQuery],
    ["lorPlrFeatureCandidateQuery", lorPlrFeatureCandidateQuery],
    ["lorFeatureCandidateQuery", lorFeatureCandidateQuery],
    ["koelnQuartierCandidateQuery", koelnQuartierCandidateQuery],
    ["hamburgStadtteilFallbackQuery", hamburgStadtteilFallbackQuery],
    ["teilCatalogQuery", teilCatalogQuery],
    ["areaCandidateQuery", areaCandidateQuery],
  ] as const)("%s params match the highest $n for München and Tempelhof", (_name, factory) => {
    for (const place of [muenchen, tempelhof]) {
      const query = factory(place);
      expect(query.params).toHaveLength(highestSqlPlaceholder(query.sql));
      expect(highestSqlPlaceholder(query.sql)).toBeGreaterThan(0);
    }
  });

  it("does not pass the catalog geometry $4 into LOR feature-doc SQL", () => {
    expect(highestSqlPlaceholder(lorPlrCatalogQuery(tempelhof).sql)).toBe(4);
    expect(lorPlrCatalogQuery(tempelhof).params).toHaveLength(4);
    expect(highestSqlPlaceholder(lorPlrFeatureCandidateQuery(tempelhof).sql)).toBe(3);
    expect(lorPlrFeatureCandidateQuery(tempelhof).params).toHaveLength(3);
    expect(highestSqlPlaceholder(lorFeatureCandidateQuery(tempelhof).sql)).toBe(3);
    expect(lorFeatureCandidateQuery(tempelhof).params).toHaveLength(3);
  });

  it("passes geometry $3 into Köln Quartier feature SQL", () => {
    expect(highestSqlPlaceholder(koelnQuartierCandidateQuery(muenchen).sql)).toBe(3);
    expect(koelnQuartierCandidateQuery(muenchen).params).toHaveLength(3);
  });

  it("matches municipality-name and overlap SQL $n to params", () => {
    const names = municipalityNameQuery(["09162000", "11000000"]);
    expect(names.params).toHaveLength(highestSqlPlaceholder(names.sql));
    const overlaps = hitOverlapQuery(
      [
        { geoKey: "81541", kind: "plz" },
        { geoKey: "80331", kind: "plz" },
      ],
      JSON.stringify({ type: "Polygon", coordinates: [[[11.4, 48.0], [11.7, 48.0], [11.7, 48.3], [11.4, 48.3], [11.4, 48.0]]] }),
    );
    expect(overlaps.params).toHaveLength(highestSqlPlaceholder(overlaps.sql));
    expect(highestSqlPlaceholder(overlaps.sql)).toBe(3);
    expect(overlaps.sql).toContain("region_geom");
    expect(overlaps.sql).toContain("geo.geo_ref_address");
    expect(overlaps.sql).toContain("grid100");
    expect(overlaps.sql).toContain("ST_Covers");
    expect(overlaps.sql).toContain("ST_Dimension");
    expect(overlapEligibleKind("grid100")).toBe(true);
    expect(overlapEligibleKind("address")).toBe(true);
    expect(clipToRegionSql("hit.geom")).toContain("ST_Intersection");
    expect(clipToRegionSql("hit.geom")).toContain("g.geom");
    expect(overlapShareSql("h.geom", "b.geom")).toContain("ST_Covers");
    expect(overlapShareSql("h.geom", "b.geom")).toContain("ST_Dimension");
    expect(overlapJoinSql("h.geom", "b.geom")).toContain("ST_Covers");
  });
});

describe("targetRegionKeyOf", () => {
  it("uses geoKey when present", () => {
    expect(resolveTargetRegionKey(region({ geoKey: "ortsteil:osm:1", ags: "11000000", label: "Lichterfelde" }))).toEqual({
      key: "ortsteil:osm:1",
      source: "geoKey",
    });
  });

  it("falls back to ags:{ags} and label:{normalized} in that order", () => {
    expect(resolveTargetRegionKey(region({ geoKey: null, ags: "05315000", label: "Innenstadt" }))).toEqual({
      key: "ags:05315000",
      source: "ags",
    });
    expect(resolveTargetRegionKey(region({ geoKey: "  ", ags: null, label: "  Steglitz  West  " }))).toEqual({
      key: "label:steglitz west",
      source: "label",
    });
    expect(normalizeTargetRegionLabel("  Tempelhof  ")).toBe("tempelhof");
    expect(targetRegionKeyOf(region({ geoKey: null, ags: null, label: "Köln Innenstadt" }))).toBe(
      "label:köln innenstadt",
    );
  });
});
