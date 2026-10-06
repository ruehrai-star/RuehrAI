import { Client } from "pg";
import { buildHitOverlapSql, hitOverlapQuery, highestSqlPlaceholder } from "./area-candidates";
import { selectOverlaps, HitOverlapRow } from "./hit-overlaps";

const POSTGIS_URL = process.env.POSTGIS_URL?.trim();
const describePg = POSTGIS_URL ? describe : describe.skip;
jest.setTimeout(60_000);

const REGION = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

function box(west: number, south: number, east: number, north: number): string {
  return `ST_SetSRID(ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}), 4326)`;
}

describePg("hit overlaps on PostGIS", () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectPostgis(POSTGIS_URL!);
    await client.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await client.query("CREATE SCHEMA IF NOT EXISTS geo");
    await client.query("CREATE SCHEMA IF NOT EXISTS features");
    await client.query(`
      DROP TABLE IF EXISTS geo.geo_ref_plz;
      DROP TABLE IF EXISTS geo.geo_ref_lor;
      DROP TABLE IF EXISTS geo.geo_ref_ortsteil;
      DROP TABLE IF EXISTS geo.geo_ref_address;
      DROP TABLE IF EXISTS geo.geo_ref_bezirk;
      DROP TABLE IF EXISTS features.location_feature_docs;
      CREATE TABLE geo.geo_ref_plz (geo_plz5 text, geom geometry);
      CREATE TABLE geo.geo_ref_lor (
        geo_lor_id text, name text, geo_ags text, lor_level text, valid_to date, geom geometry
      );
      CREATE TABLE geo.geo_ref_ortsteil (
        geo_ortsteil_id text, kind text, name text, geom geometry
      );
      CREATE TABLE geo.geo_ref_address (geo_key text, geo_addr_id text, geom_3035 geometry);
      CREATE TABLE geo.geo_ref_bezirk (geo_bezirk_id text, name text, geom geometry);
      CREATE TABLE features.location_feature_docs (
        geo_key text, grain text, lon float8, lat float8, ref_period date
      );
      INSERT INTO geo.geo_ref_bezirk (geo_bezirk_id, name, geom) VALUES
        ('innenstadt', 'Innenstadt', ${box(0, 0, 1, 1)}),
        ('nippes', 'Nippes', ${box(1, 0, 2, 1)});
      INSERT INTO geo.geo_ref_plz (geo_plz5, geom) VALUES
        ('50667', ${box(0.2, 0.2, 1.8, 0.8)});
      INSERT INTO geo.geo_ref_address (geo_key, geo_addr_id, geom_3035) VALUES
        ('address:1', '1', ST_Transform(ST_SetSRID(ST_MakePoint(0.5, 0.5), 4326), 3035));
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
  });

  it("gives a point share 1 and clips a sticking-out PLZ to the Zielregion", async () => {
    const query = hitOverlapQuery(
      [
        { geoKey: "address:1", kind: "address" },
        { geoKey: "50667", kind: "plz" },
      ],
      JSON.stringify(REGION),
    );
    expect(query.params).toHaveLength(highestSqlPlaceholder(query.sql));
    expect(query.sql).toBe(buildHitOverlapSql());
    const result = await client.query<HitOverlapRow>(query.sql, query.params);
    const byHit = new Map<string, ReturnType<typeof selectOverlaps>>();
    const grouped = new Map<string, HitOverlapRow[]>();
    for (const row of result.rows) {
      const key = row.hit_geo_key?.trim();
      if (!key) continue;
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    for (const [key, rows] of grouped) byHit.set(key, selectOverlaps(rows));

    const point = byHit.get("address:1") ?? [];
    expect(point).toHaveLength(1);
    expect(point[0]?.label).toBe("Innenstadt");
    expect(point[0]?.share).toBe(1);

    const plz = byHit.get("50667") ?? [];
    expect(plz.map((part) => part.label)).toEqual(["Innenstadt"]);
    expect(plz.find((part) => part.label === "Nippes")).toBeUndefined();
    expect(plz.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 2);
  });
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
