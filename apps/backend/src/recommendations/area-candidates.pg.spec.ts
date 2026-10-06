import { Client } from "pg";
import { AnalysisRegion } from "../analysis/types";
import {
  areaCandidateQuery,
  buildAreaCandidateSql,
  buildLorPlrCatalogSql,
  buildTeilCatalogSql,
  lorPlrCatalogQuery,
  teilCatalogQuery,
} from "./area-candidates";

const POSTGIS_URL = process.env.POSTGIS_URL?.trim();
const describePg = POSTGIS_URL ? describe : describe.skip;
jest.setTimeout(60_000);

const TEMPELHOF: AnalysisRegion = {
  label: "Tempelhof",
  grain: "other",
  geoKey: "ortsteil:osm:162894",
  level: "ortsteil",
  parentLabel: "Berlin",
  ags: "11000000",
  plz: null,
  lon: 13.38,
  lat: 52.47,
  bounds: null,
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
  updatedAt: "2026-10-06T00:00:00.000Z",
};

const LICHTERFELDE: AnalysisRegion = {
  label: "Lichterfelde",
  grain: "other",
  geoKey: "ortsteil:osm:55737",
  level: "ortsteil",
  parentLabel: "Berlin",
  ags: "11000000",
  plz: null,
  lon: 13.31,
  lat: 52.43,
  bounds: null,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [13.28, 52.41],
        [13.35, 52.41],
        [13.35, 52.45],
        [13.28, 52.45],
        [13.28, 52.41],
      ],
    ],
  },
  updatedAt: "2026-10-06T00:00:00.000Z",
};

function box(west: number, south: number, east: number, north: number): string {
  return JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  });
}

describePg("PostGIS: Treffer cut to the Zielregion", () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectPostgis(POSTGIS_URL!);
    await client.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await client.query("CREATE SCHEMA IF NOT EXISTS geo");
    await client.query("CREATE SCHEMA IF NOT EXISTS features");
    await client.query(`
      DROP TABLE IF EXISTS geo.geo_ref_zielregion_teil;
      DROP TABLE IF EXISTS geo.geo_ref_lor;
      DROP TABLE IF EXISTS geo.geo_ref_ortsteil;
      DROP TABLE IF EXISTS geo.geo_ref_bezirk;
      DROP TABLE IF EXISTS geo.geo_ref_plz;
      DROP TABLE IF EXISTS geo.geo_ref_admin;
      DROP TABLE IF EXISTS features.location_feature_docs;
      CREATE TABLE geo.geo_ref_lor (
        geo_lor_id text PRIMARY KEY,
        name text,
        geo_ags text,
        geo_bezirk_id text,
        lor_level text,
        valid_to date,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_ortsteil (
        geo_ortsteil_id text,
        kind text,
        name text,
        geo_ags text,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_bezirk (
        geo_bezirk_id text,
        name text,
        geo_ags text,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_plz (
        geo_plz5 text,
        geo_ags text,
        geom geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_admin (
        geo_ags text,
        name text,
        geom geometry(Geometry, 3035),
        geom_4326 geometry(Geometry, 4326),
        geom_display geometry(Geometry, 4326)
      );
      CREATE TABLE geo.geo_ref_zielregion_teil (
        parent_grain text,
        parent_id text,
        child_grain text,
        child_id text
      );
      CREATE TABLE features.location_feature_docs (
        geo_key text,
        source_theme text,
        title text,
        metadata jsonb,
        lon float8,
        lat float8,
        ref_period date
      );
    `);
    await client.query(
      `INSERT INTO geo.geo_ref_lor (geo_lor_id, name, geo_ags, geo_bezirk_id, lor_level, valid_to, geom) VALUES
        ('07400720', 'Germaniagarten', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
        ('07400721', 'Paradestraße', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
        ('07400823', 'Wittekindstraße', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
        ('07400826', 'Marienhöhe', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
        ('07400927', 'Rathaus Tempelhof', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)),
        ('07400722', 'Tempelhofer Feld', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)),
        ('07400824', 'Ringbahnstraße', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)),
        ('07400926', 'Alt-Tempelhof', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)),
        ('06200420', 'Lichterfelde-Ost', '11000000', '11000006', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($9), 4326)),
        ('01100310', 'Alexanderplatzviertel', '11000000', '11000001', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)),
        ('02100103', 'Am Berlin Museum', '11000000', '11000002', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)),
        ('02400623', 'Andreasviertel', '11000000', '11000002', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)),
        ('06200311', 'Alt-Lankwitz', '11000000', '11000006', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($11), 4326)),
        ('02200211', 'Chamissokiez', '11000000', '11000002', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($12), 4326)),
        ('07300619', 'Grazer Platz', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($13), 4326)),
        ('07501031', 'Eisenacher Straße', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($14), 4326)),
        ('07501032', 'Grenzweg', '11000000', '11000007', 'planungsraum', NULL, ST_SetSRID(ST_GeomFromGeoJSON($15), 4326))`,
      [
        box(13.355, 52.452, 13.37, 52.462),
        box(13.37, 52.452, 13.385, 52.462),
        box(13.385, 52.452, 13.4, 52.462),
        box(13.4, 52.4496, 13.415, 52.4596),
        box(13.355, 52.462, 13.37, 52.472),
        box(13.37, 52.462, 13.385, 52.472),
        box(13.385, 52.462, 13.4, 52.472),
        box(13.4, 52.462, 13.415, 52.472),
        box(13.29, 52.42, 13.34, 52.44),
        box(13.39, 52.51, 13.42, 52.53),
        box(13.36, 52.4, 13.38, 52.45000002),
        box(13.38, 52.4, 13.4, 52.450025),
        box(13.4, 52.4, 13.415, 52.4500005),
        box(13.355, 52.4, 13.375, 52.45035),
        box(13.36, 52.406, 13.38, 52.456),
      ],
    );
    await client.query(
      `INSERT INTO geo.geo_ref_ortsteil (geo_ortsteil_id, kind, name, geo_ags, geom) VALUES
        ('osm:162894', 'ortsteil', 'Tempelhof', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
        ('osm:tempelhof-mitte', 'ortsteil', 'Tempelhof-Mitte', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
        ('osm:alt-lankwitz', 'ortsteil', 'Alt-Lankwitz', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
        ('osm:lankwitz', 'ortsteil', 'Lankwitz', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))`,
      [box(13.35, 52.45, 13.42, 52.49), box(13.36, 52.46, 13.41, 52.48), box(13.35, 52.4, 13.42, 52.4500001)],
    );
    await client.query(`
      INSERT INTO geo.geo_ref_zielregion_teil (parent_grain, parent_id, child_grain, child_id) VALUES
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400720'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400721'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400823'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400826'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400927'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400722'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400824'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07400926'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07501031'),
        ('ortsteil', 'ortsteil:osm:162894', 'lor_plr', 'lor:plr:07501032'),
        ('ortsteil', 'ortsteil:osm:55737', 'lor_plr', 'lor:plr:06200420')
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
  });

  it("Tempelhof LOR catalog only returns intersecting Planungsräume with geometry", async () => {
    const query = lorPlrCatalogQuery(TEMPELHOF);
    expect(query.sql).toBe(buildLorPlrCatalogSql());
    const result = await client.query<{
      geo_key: string;
      geometry_geojson: string | null;
      name: string | null;
      target_overlap_share: number | string | null;
    }>(query.sql, query.params);
    const inner = [
      "Germaniagarten",
      "Paradestraße",
      "Wittekindstraße",
      "Marienhöhe",
      "Rathaus Tempelhof",
      "Tempelhofer Feld",
      "Ringbahnstraße",
      "Alt-Tempelhof",
    ];
    const edge = ["Alt-Lankwitz", "Chamissokiez", "Grazer Platz", "Eisenacher Straße"];
    const names = result.rows.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(inner));
    expect(names).toContain("Grenzweg");
    expect(result.rows).toHaveLength(9);
    for (const label of edge) expect(names).not.toContain(label);
    expect(result.rows.every((row) => Number(row.target_overlap_share) >= 0.1)).toBe(true);
    const innerShares = result.rows.filter((row) => inner.includes(row.name ?? ""));
    expect(innerShares).toHaveLength(8);
    expect(innerShares.every((row) => Number(row.target_overlap_share) >= 0.9)).toBe(true);
    const grenz = result.rows.find((row) => row.name === "Grenzweg");
    expect(Number(grenz?.target_overlap_share)).toBeGreaterThanOrEqual(0.1);
    expect(Number(grenz?.target_overlap_share)).toBeLessThan(0.5);
    expect(result.rows[0]?.geometry_geojson).toContain("Polygon");
    await assertRowsIntersectRegion(result.rows, TEMPELHOF.geometry!);
  });

  it("Lichterfelde does not return Mitte Planungsräume", async () => {
    const query = lorPlrCatalogQuery(LICHTERFELDE);
    const result = await client.query<{ geo_key: string; geometry_geojson: string | null }>(query.sql, query.params);
    expect(result.rows.map((row) => row.geo_key)).toEqual(["lor:plr:06200420"]);
    expect(result.rows.map((row) => row.geo_key)).not.toEqual(
      expect.arrayContaining(["lor:plr:01100310", "lor:plr:02100103", "lor:plr:02400623"]),
    );
    await assertRowsIntersectRegion(result.rows, LICHTERFELDE.geometry!);
  });

  it("zielregion_teil LOR rows join outlines and clip to the Ortsteil", async () => {
    const query = teilCatalogQuery(LICHTERFELDE);
    expect(query.sql).toBe(buildTeilCatalogSql("prefer"));
    const result = await client.query<{
      geo_key: string;
      kind: string;
      geometry_geojson: string | null;
      name: string | null;
    }>(query.sql, query.params);
    const lor = result.rows.filter((row) => row.kind === "lor");
    expect(lor.map((row) => row.geo_key)).toEqual(["lor:plr:06200420"]);
    expect(lor[0]?.name).toBe("Lichterfelde-Ost");
    expect(lor[0]?.name).not.toMatch(/^lor:/);
    expect(lor[0]?.geometry_geojson).toContain("Polygon");
    await assertRowsIntersectRegion(lor, LICHTERFELDE.geometry!);
  });

  it("teil-catalog Tempelhof LOR drops Eisenacher (~0.7%) at default 0.1 and keeps ≥10%", async () => {
    const query = teilCatalogQuery(TEMPELHOF);
    expect(query.sql).toBe(buildTeilCatalogSql("prefer"));
    const result = await client.query<{
      geo_key: string;
      kind: string;
      name: string | null;
      target_overlap_share: number | string | null;
    }>(query.sql, query.params);
    const lor = result.rows.filter((row) => row.kind === "lor");
    const names = lor.map((row) => row.name);
    expect(names).not.toContain("Eisenacher Straße");
    expect(names).toContain("Grenzweg");
    expect(names).toContain("Germaniagarten");
    const grenz = lor.find((row) => row.name === "Grenzweg");
    expect(Number(grenz?.target_overlap_share)).toBeGreaterThanOrEqual(0.1);
    expect(Number(grenz?.target_overlap_share)).toBeLessThan(0.5);
    const inner = lor.find((row) => row.name === "Germaniagarten");
    expect(Number(inner?.target_overlap_share)).toBeGreaterThanOrEqual(0.9);

    const strict = await client.query<{ name: string | null; kind: string }>(
      buildTeilCatalogSql("prefer", 0.5),
      query.params,
    );
    const strictLor = strict.rows.filter((row) => row.kind === "lor").map((row) => row.name);
    expect(strictLor).not.toContain("Grenzweg");
    expect(strictLor).not.toContain("Eisenacher Straße");
    expect(strictLor).toContain("Germaniagarten");
  });

  it("drops Tempelhof edge fragments such as Alt-Lankwitz and keeps inner Teilflächen", async () => {
    const query = areaCandidateQuery(TEMPELHOF);
    expect(query.sql).toBe(buildAreaCandidateSql());
    const result = await client.query<{ geo_key: string; name: string | null }>(query.sql, query.params);
    const names = result.rows.map((row) => row.name);
    expect(names).toContain("Tempelhof-Mitte");
    expect(names).not.toContain("Alt-Lankwitz");
    expect(names).not.toContain("Lankwitz");
    expect(result.rows.map((row) => row.geo_key)).toContain("ortsteil:osm:tempelhof-mitte");
    expect(result.rows.map((row) => row.geo_key)).not.toContain("ortsteil:osm:alt-lankwitz");
  });

  async function assertRowsIntersectRegion(
    rows: Array<{ geo_key: string; geometry_geojson: string | null }>,
    region: NonNullable<AnalysisRegion["geometry"]>,
  ): Promise<void> {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.geometry_geojson).toBeTruthy();
      const overlap = await client.query<{ overlaps: boolean; intersects: boolean }>(
        `SELECT
           ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)) AS intersects,
           ST_Overlaps(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
             OR ST_Contains(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
             AS overlaps`,
        [row.geometry_geojson, JSON.stringify(region)],
      );
      expect(overlap.rows[0]?.intersects).toBe(true);
      expect(overlap.rows[0]?.overlaps).toBe(true);
    }
  }
});

async function connectPostgis(url: string): Promise<Client> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PostGIS unavailable");
}
