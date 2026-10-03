import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { DatabaseService } from "../src/database/database.service";
import { GeoCatalogService } from "../src/geo/geo-catalog.service";
import { SearchService } from "../src/search/search.service";

const muenchenOutline = {
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [11.36, 48.06],
        [11.72, 48.06],
        [11.6, 48.25],
        [11.36, 48.06],
      ],
    ],
  ],
};

const runDb = process.env.RUN_DB_TESTS === "1";

async function dropFeaturesFixture(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await admin.query("DROP SCHEMA IF EXISTS features CASCADE");
    await admin.query("DROP ROLE IF EXISTS backend_app");
    await admin.query("DROP ROLE IF EXISTS backend_ro_features");
  } finally {
    await admin.end();
  }
}

(runDb ? describe : describe.skip)("Postgres-backed routes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await dropFeaturesFixture();
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    expect(response.body.tokenType).toBe("Bearer");
    return response.body.accessToken as string;
  }

  async function register(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "dev-password" })
      .expect(201);
    return response.body.accessToken as string;
  }

  it("logs in the seeded dev user and reads /auth/me", async () => {
    const token = await login("dev@ruehrai.local", "dev-password");
    const me = await request(app.getHttpServer())
      .get("/auth/me")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: "dev@ruehrai.local" });
    expect(typeof me.body.id).toBe("string");
  });

  it("rejects a wrong password", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "dev@ruehrai.local", password: "wrong-password" })
      .expect(401);
  });

  it("searches by label, ags, plz, and address", async () => {
    const token = await login("dev@ruehrai.local", "dev-password");
    const auth = { authorization: `Bearer ${token}` };

    const all = await request(app.getHttpServer()).get("/search").set(auth).expect(200);
    expect(all.body.hits.length).toBeGreaterThanOrEqual(7);

    const byName = await request(app.getHttpServer())
      .get("/search")
      .query({ q: "München" })
      .set(auth)
      .expect(200);
    const munchen = (
      byName.body.hits as {
        id: string;
        grain: string;
        geoKey: string;
        lon: number;
        lat: number;
      }[]
    ).find((hit) => hit.id === "ags:09162000");
    expect(munchen).toMatchObject({ grain: "ags", geoKey: "09162000" });
    expect(munchen?.lon).toBeCloseTo(11.5755);
    expect(munchen?.lat).toBeCloseTo(48.1374);

    const byAgs = await request(app.getHttpServer())
      .get("/search")
      .query({ ags: "11000000" })
      .set(auth)
      .expect(200);
    expect(byAgs.body.hits.map((hit: { id: string }) => hit.id)).toContain("ags:11000000");

    const byPlz = await request(app.getHttpServer())
      .get("/search")
      .query({ type: "plz", q: "10115" })
      .set(auth)
      .expect(200);
    expect(byPlz.body.hits.map((hit: { id: string }) => hit.id)).toContain("plz5:10115");

    const byAddress = await request(app.getHttpServer())
      .get("/search")
      .query({ type: "address", q: "Marienplatz" })
      .set(auth)
      .expect(200);
    expect(byAddress.body.hits.map((hit: { id: string }) => hit.id)).toContain(
      "address:demo-marienplatz-1",
    );
  });

  it("searches Brain geo catalog levels and stores the MultiPolygon on PUT", async () => {
    const adminUrl = process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("DATABASE_URL is required");
    const admin = new Pool({ connectionString: adminUrl, max: 1 });
    const token = await login("dev@ruehrai.local", "dev-password");
    const auth = { authorization: `Bearer ${token}` };
    const server = app.getHttpServer();

    try {
      await admin.query("CREATE EXTENSION IF NOT EXISTS postgis");
    } catch {
      await admin.end();
      return;
    }

    const ring = (points: number[][]) => [points];
    const multi = (points: number[][]) => ({
      type: "MultiPolygon",
      coordinates: [ring([...points, points[0]!])],
    });
    const plzGeom = multi([
      [11.57, 48.13],
      [11.59, 48.13],
      [11.58, 48.15],
    ]);
    const mitteGeom = multi([
      [13.36, 52.51],
      [13.42, 52.51],
      [13.39, 52.54],
    ]);
    const altonaGeom = multi([
      [9.9, 53.54],
      [10.0, 53.54],
      [9.95, 53.57],
    ]);
    const schwabingGeom = multi([
      [11.57, 48.16],
      [11.6, 48.16],
      [11.58, 48.18],
    ]);
    const neustadtDdGeom = multi([
      [13.73, 51.05],
      [13.76, 51.05],
      [13.74, 51.07],
    ]);
    const neustadtHbGeom = multi([
      [8.78, 53.07],
      [8.81, 53.07],
      [8.79, 53.09],
    ]);
    const berlinPlzGeom = multi([
      [13.34, 52.43],
      [13.36, 52.43],
      [13.35, 52.45],
    ]);
    const hamburgPlzGeom = multi([
      [9.91, 53.55],
      [9.93, 53.55],
      [9.92, 53.56],
    ]);
    const lankwitzGeom = multi([
      [13.33, 52.42],
      [13.35, 52.42],
      [13.34, 52.44],
    ]);

    try {
      await admin.query("DROP SCHEMA IF EXISTS geo CASCADE");
      await admin.query("CREATE SCHEMA geo");
      await admin.query(`
        CREATE TABLE geo.geo_ref_admin (
          geo_ags text PRIMARY KEY,
          name text NOT NULL
        )
      `);
      await admin.query(`
        CREATE TABLE geo.geo_ref_plz (
          geo_plz5 text PRIMARY KEY,
          geo_ags text,
          geom geometry(MultiPolygon, 4326)
        )
      `);
      await admin.query(`
        CREATE TABLE geo.geo_ref_bezirk (
          geo_bezirk_id text PRIMARY KEY,
          name text NOT NULL,
          geo_ags text,
          geom geometry(MultiPolygon, 4326)
        )
      `);
      await admin.query(`
        CREATE TABLE geo.geo_ref_ortsteil (
          geo_ortsteil_id text PRIMARY KEY,
          name text NOT NULL,
          kind text NOT NULL,
          geo_ags text,
          geom geometry(MultiPolygon, 4326)
        )
      `);
      await admin.query(
        `INSERT INTO geo.geo_ref_admin (geo_ags, name) VALUES
           ('09162000', 'München'),
           ('11000000', 'Berlin'),
           ('02000000', 'Hamburg'),
           ('14612000', 'Dresden'),
           ('04011000', 'Bremen')`,
      );
      await admin.query(
        `INSERT INTO geo.geo_ref_plz (geo_plz5, geo_ags, geom) VALUES
           ('80331', '09162000', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           ('12247', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
           ('22765', '02000000', ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
           ('00000', '09162000', ST_GeomFromText('MULTIPOLYGON EMPTY', 4326))`,
        [JSON.stringify(plzGeom), JSON.stringify(berlinPlzGeom), JSON.stringify(hamburgPlzGeom)],
      );
      await admin.query(
        `INSERT INTO geo.geo_ref_bezirk (geo_bezirk_id, name, geo_ags, geom) VALUES
           ('11000001', 'Mitte', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           ('02000002', 'Altona', '02000000', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))`,
        [JSON.stringify(mitteGeom), JSON.stringify(altonaGeom)],
      );
      await admin.query(
        `INSERT INTO geo.geo_ref_ortsteil (geo_ortsteil_id, name, kind, geo_ags, geom) VALUES
           ('s-schwabing', 'Schwabing', 'stadtteil', '09162000', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           ('o-neustadt-dd', 'Neustadt', 'ortsteil', '14612000', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
           ('o-neustadt-hb', 'Neustadt', 'ortsteil', '04011000', ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
           ('osm:5712247', 'Lankwitz', 'ortsteil', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
           ('osm:12247773', '', 'ortsteil', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
           ('osm:12247949', 'Marienfelde', 'ortsteil', '11000000', ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
           ('g-fake', 'Nicht zeigen', 'gemeinde', '09162000', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))`,
        [
          JSON.stringify(schwabingGeom),
          JSON.stringify(neustadtDdGeom),
          JSON.stringify(neustadtHbGeom),
          JSON.stringify(lankwitzGeom),
        ],
      );
      await admin.query("GRANT USAGE ON SCHEMA geo TO PUBLIC");
      await admin.query("GRANT SELECT ON ALL TABLES IN SCHEMA geo TO PUBLIC");

      const plz = await request(server).get("/search").query({ q: "80331" }).set(auth).expect(200);
      expect(plz.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "plz5:80331",
            label: "80331",
            grain: "plz5",
            geoKey: "80331",
            level: "plz",
            parentLabel: "München",
            geoAgs: "09162000",
          }),
        ]),
      );
      expect(plz.body.hits.some((hit: { id: string }) => hit.id.includes("00000"))).toBe(false);

      const berlin = await request(server).get("/search").query({ q: "Mitte" }).set(auth).expect(200);
      expect(berlin.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "ags:11000001",
            grain: "ags",
            geoKey: "11000001",
            level: "bezirk",
            parentLabel: "Berlin",
            geoAgs: "11000000",
          }),
        ]),
      );

      const hamburg = await request(server).get("/search").query({ q: "Altona" }).set(auth).expect(200);
      expect(hamburg.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "stadtbezirk:02000002",
            grain: "other",
            level: "stadtbezirk",
            parentLabel: "Hamburg",
            geoAgs: "02000000",
          }),
        ]),
      );

      const stadtteil = await request(server).get("/search").query({ q: "Schwabing" }).set(auth).expect(200);
      expect(stadtteil.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "stadtteil:s-schwabing",
            level: "stadtteil",
            parentLabel: "München",
            geoAgs: "09162000",
          }),
        ]),
      );
      expect(stadtteil.body.hits.some((hit: { level?: string }) => hit.level === "gemeinde")).toBe(false);

      const neustadt = await request(server).get("/search").query({ q: "Neustadt" }).set(auth).expect(200);
      const named = (neustadt.body.hits as { label: string; parentLabel?: string; geoAgs?: string }[]).filter(
        (hit) => hit.label === "Neustadt",
      );
      expect(named).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ parentLabel: "Dresden", geoAgs: "14612000", level: "ortsteil" }),
          expect.objectContaining({ parentLabel: "Bremen", geoAgs: "04011000", level: "ortsteil" }),
        ]),
      );

      const byDigits = await request(server).get("/search").query({ q: "12247" }).set(auth).expect(200);
      const digitIds = (byDigits.body.hits as { id: string; label: string; level?: string }[]).map(
        (hit) => hit.id,
      );
      expect(byDigits.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "plz5:12247",
            label: "12247",
            level: "plz",
            parentLabel: "Berlin",
          }),
        ]),
      );
      expect(digitIds).not.toEqual(
        expect.arrayContaining([
          "ortsteil:osm:5712247",
          "ortsteil:osm:12247773",
          "ortsteil:osm:12247949",
        ]),
      );
      expect(byDigits.body.hits.every((hit: { label: string }) => hit.label.trim().length > 0)).toBe(
        true,
      );

      const byKey = await request(server)
        .get("/search")
        .query({ q: "plz5:12247" })
        .set(auth)
        .expect(200);
      expect(byKey.body.hits).toEqual([]);
      const byOsmKey = await request(server)
        .get("/search")
        .query({ q: "ortsteil:osm:5712247" })
        .set(auth)
        .expect(200);
      expect(byOsmKey.body.hits).toEqual([]);

      const byMunich = await request(server).get("/search").query({ q: "München" }).set(auth).expect(200);
      expect(byMunich.body.hits.some((hit: { level?: string; grain: string }) => hit.level === "plz" || hit.grain === "plz5")).toBe(
        false,
      );
      expect(byMunich.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "stadtteil:s-schwabing", level: "stadtteil" }),
        ]),
      );

      const byHamburg = await request(server).get("/search").query({ q: "Hamburg" }).set(auth).expect(200);
      expect(byHamburg.body.hits.some((hit: { level?: string }) => hit.level === "plz")).toBe(false);
      expect(byHamburg.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "stadtbezirk:02000002", level: "stadtbezirk" }),
        ]),
      );

      const reloaded = await request(server)
        .get("/search")
        .query({ geoKey: "ortsteil:osm:5712247" })
        .set(auth)
        .expect(200);
      expect(reloaded.body.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "ortsteil:osm:5712247",
            label: "Lankwitz",
            level: "ortsteil",
            parentLabel: "Berlin",
          }),
        ]),
      );

      const user = await register(`geo-catalog-${Date.now()}@ruehrai.local`);
      const owner = { authorization: `Bearer ${user}` };
      const savedPlz = await request(server)
        .put("/target-region")
        .set(owner)
        .send({ label: "80331", grain: "plz5", geoKey: "80331", plz: "80331" })
        .expect(200);
      expect(savedPlz.body.geometry).toMatchObject({ type: "MultiPolygon" });
      expect(savedPlz.body.geometry.coordinates[0][0].length).toBeGreaterThan(4);

      const savedBezirk = await request(server)
        .put("/target-region")
        .set(owner)
        .send({ label: "Mitte", grain: "ags", geoKey: "11000001", ags: "11000001" })
        .expect(200);
      expect(savedBezirk.body.geometry).toEqual(mitteGeom);
      expect(savedBezirk.body.ags).toBe("11000001");

      const savedStadtbezirk = await request(server)
        .put("/target-region")
        .set(owner)
        .send({ label: "Altona", grain: "other", geoKey: "stadtbezirk:02000002" })
        .expect(200);
      expect(savedStadtbezirk.body.geometry).toEqual(altonaGeom);

      const savedStadtteil = await request(server)
        .put("/target-region")
        .set(owner)
        .send({ label: "Schwabing", grain: "other", geoKey: "stadtteil:s-schwabing" })
        .expect(200);
      expect(savedStadtteil.body.geometry).toEqual(schwabingGeom);

      const savedOrtsteil = await request(server)
        .put("/target-region")
        .set(owner)
        .send({ label: "Neustadt", grain: "other", geoKey: "ortsteil:o-neustadt-dd" })
        .expect(200);
      expect(savedOrtsteil.body.geometry).toEqual(neustadtDdGeom);

      const savedOsm = await request(server)
        .put("/target-region")
        .set(owner)
        .send({ label: "Lankwitz", grain: "other", geoKey: "ortsteil:osm:5712247" })
        .expect(200);
      expect(savedOsm.body.geometry).toEqual(lankwitzGeom);
      expect(savedOsm.body.geometry.type).toBe("MultiPolygon");
    } finally {
      await admin.query("DROP SCHEMA IF EXISTS geo CASCADE").catch(() => undefined);
      await admin.end();
    }
  });

  it("returns a GeoJSON feature collection and 404 for an unknown layer", async () => {
    const token = await login("dev@ruehrai.local", "dev-password");
    const auth = { authorization: `Bearer ${token}` };

    const response = await request(app.getHttpServer())
      .get("/layers/demo-gemeinden")
      .set(auth)
      .expect(200);
    expect(response.body.type).toBe("FeatureCollection");
    expect(response.body.features).toEqual([]);

    await request(app.getHttpServer()).get("/layers/missing-layer").set(auth).expect(404);
  });

  it("registers a new user and rejects a duplicate email", async () => {
    const email = `itest-${Date.now()}@ruehrai.local`;
    const created = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "dev-password" })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get("/auth/me")
      .set("authorization", `Bearer ${created.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(email);

    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "dev-password" })
      .expect(409);
  });

  it("revokes the access token on logout", async () => {
    const email = `logout-${Date.now()}@ruehrai.local`;
    const created = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "dev-password" })
      .expect(201);
    const token = created.body.accessToken as string;
    const auth = { authorization: `Bearer ${token}` };

    await request(app.getHttpServer()).get("/auth/me").set(auth).expect(200);
    await request(app.getHttpServer()).post("/auth/logout").set(auth).expect(204);
    await request(app.getHttpServer()).get("/auth/me").set(auth).expect(401);
    await request(app.getHttpServer()).post("/auth/logout").set(auth).expect(401);

    const again = await login(email, "dev-password");
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("authorization", `Bearer ${again}`)
      .expect(200);
  });

  it("persists a catalog pin when a stored address has no coordinates", async () => {
    const token = await register(`pin-${Date.now()}@ruehrai.local`);
    const auth = { authorization: `Bearer ${token}` };
    const me = await request(app.getHttpServer()).get("/auth/me").set(auth).expect(200);
    const db = app.get(DatabaseService);
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO app.store_locations (user_id, street, postal_code, city, lon, lat)
       VALUES ($1::bigint, 'Leonorenstr. 1', '12247', 'Berlin', NULL, NULL)
       RETURNING id::text AS id`,
      [me.body.id],
    );
    const storeId = inserted.rows[0]?.id;
    expect(storeId).toEqual(expect.any(String));

    const listed = await request(app.getHttpServer()).get("/stores").set(auth).expect(200);
    const store = (listed.body.stores as { id: string; lon: number; lat: number }[]).find(
      (row) => row.id === storeId,
    );
    expect(store?.lon).toBeCloseTo(13.3457);
    expect(store?.lat).toBeCloseTo(52.4403);

    const saved = await db.query<{ lon: number; lat: number }>(
      `SELECT lon, lat FROM app.store_locations WHERE id = $1::bigint`,
      [storeId],
    );
    expect(Number(saved.rows[0]?.lon)).toBeCloseTo(13.3457);
    expect(Number(saved.rows[0]?.lat)).toBeCloseTo(52.4403);
  });

  it("keeps target region, stores, and revenue private to the owner", async () => {
    const stamp = Date.now();
    const ownerToken = await register(`owner-${stamp}@ruehrai.local`);
    const otherToken = await register(`other-${stamp}@ruehrai.local`);
    const owner = { authorization: `Bearer ${ownerToken}` };
    const other = { authorization: `Bearer ${otherToken}` };
    const server = app.getHttpServer();

    await request(server).get("/target-region").set(owner).expect(404);
    const region = await request(server)
      .put("/target-region")
      .set(owner)
      .send({
        label: "München",
        grain: "ags",
        geoKey: "09162000",
        ags: "09162000",
        lon: 11.5755,
        lat: 48.1374,
        geometry: muenchenOutline,
      })
      .expect(200);
    expect(region.body).toMatchObject({
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
      bounds: { west: 11.36, south: 48.06, east: 11.72, north: 48.25 },
    });
    expect(region.body.geometry).toEqual(muenchenOutline);
    expect(region.body.lon).toBeCloseTo(11.5755);
    expect(region.body.lat).toBeCloseTo(48.1374);
    await request(server).get("/target-region").set(other).expect(404);

    const created = await request(server)
      .post("/stores")
      .set(owner)
      .send({
        label: "Filiale Marienplatz",
        street: "Marienplatz 1",
        postalCode: "80331",
        city: "München",
      })
      .expect(201);
    const storeId = created.body.id as string;
    expect(created.body).toMatchObject({
      street: "Marienplatz 1",
      postalCode: "80331",
      city: "München",
      countryCode: "DE",
      label: "Filiale Marienplatz",
    });
    expect(created.body.lon).toBeCloseTo(11.576);
    expect(created.body.lat).toBeCloseTo(48.137);

    const listed = await request(server).get("/stores").set(owner).expect(200);
    expect(listed.body.stores.map((store: { id: string }) => store.id)).toContain(storeId);
    await request(server).get("/stores").set(other).expect(200).expect({ stores: [] });
    await request(server).get(`/stores/${storeId}`).set(other).expect(404);
    await request(server).put(`/stores/${storeId}/revenue`).set(other).send({
      points: [{ year: 2025, month: 1, revenueEur: 1 }],
    }).expect(404);

    const saved = await request(server)
      .put(`/stores/${storeId}/revenue`)
      .set(owner)
      .send({
        points: [
          { year: 2025, month: 1, revenueEur: 18450.5 },
          { year: 2025, month: 2, revenueEur: null },
        ],
      })
      .expect(200);
    expect(saved.body.points).toEqual([
      expect.objectContaining({ year: 2025, month: 1, revenueEur: 18450.5 }),
      expect.objectContaining({ year: 2025, month: 2, revenueEur: null }),
    ]);

    const replaced = await request(server)
      .put(`/stores/${storeId}`)
      .set(owner)
      .send({ street: "Sendlinger Str. 2", postalCode: "80331", city: "München" })
      .expect(200);
    expect(replaced.body.label).toBeNull();
    expect(replaced.body.street).toBe("Sendlinger Str. 2");

    await request(server)
      .delete(`/stores/${storeId}/revenue/2025/2`)
      .set(owner)
      .expect(204);
    const afterDelete = await request(server)
      .get(`/stores/${storeId}/revenue`)
      .set(owner)
      .expect(200);
    expect(afterDelete.body.points).toEqual([
      expect.objectContaining({ year: 2025, month: 1, revenueEur: 18450.5 }),
    ]);

    const tooMany = Array.from({ length: 36 }, (_, index) => ({
      year: 1990 + Math.floor(index / 12),
      month: (index % 12) + 1,
      revenueEur: index,
    }));
    await request(server)
      .put(`/stores/${storeId}/revenue`)
      .set(owner)
      .send({ points: tooMany })
      .expect(400);
    const stillOne = await request(server)
      .get(`/stores/${storeId}/revenue`)
      .set(owner)
      .expect(200);
    expect(stillOne.body.points).toHaveLength(1);

    await request(server).delete(`/stores/${storeId}`).set(other).expect(404);
    await request(server).delete(`/stores/${storeId}`).set(owner).expect(204);
    await request(server).get(`/stores/${storeId}`).set(owner).expect(404);
    await request(server).delete("/target-region").set(owner).expect(204);
    await request(server).get("/target-region").set(owner).expect(404);
  });

  it("reads features.v_location_search, including via SET ROLE, and ignores the seed", async () => {
    const adminUrl = process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("DATABASE_URL is required");
    const admin = new Pool({ connectionString: adminUrl, max: 1 });
    const appDbUser = "backend_app";
    const appDbPassword = "backend-app-test";
    let featureDb: DatabaseService | undefined;

    try {
      await dropFeaturesFixture();
      await admin.query("CREATE ROLE backend_ro_features NOLOGIN");
      await admin.query(
        `CREATE ROLE ${appDbUser} LOGIN PASSWORD '${appDbPassword}' NOSUPERUSER NOINHERIT`,
      );
      await admin.query("GRANT backend_ro_features TO backend_app");
      await admin.query("CREATE SCHEMA features");
      await admin.query("REVOKE ALL ON SCHEMA features FROM PUBLIC");
      await admin.query(`
        CREATE TABLE features.location_feature_docs (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          geo_key text NOT NULL,
          grain text NOT NULL,
          ref_period text,
          name text,
          title text,
          lon double precision,
          lat double precision
        )
      `);
      await admin.query(`
        CREATE VIEW features.v_location_search AS
        SELECT id, geo_key, grain, ref_period, name, title, lon, lat
        FROM features.location_feature_docs
      `);
      await admin.query(
        `INSERT INTO features.location_feature_docs (geo_key, grain, ref_period, name, title)
         VALUES ('04011000', 'ags', '2022-05', 'Alpha Ort', 'Alpha Ort')`,
      );
      await admin.query("GRANT USAGE ON SCHEMA features TO backend_ro_features");
      await admin.query(
        "GRANT SELECT ON features.v_location_search TO backend_ro_features",
      );

      const token = await login("dev@ruehrai.local", "dev-password");
      const auth = { authorization: `Bearer ${token}` };
      const fromApi = await request(app.getHttpServer())
        .get("/search")
        .query({ q: "Alpha", grain: "ags" })
        .set(auth)
        .expect(200);
      expect(fromApi.body.hits).toEqual([
        {
          id: "1",
          label: "Alpha Ort",
          grain: "ags",
          geoKey: "04011000",
          lon: null,
          lat: null,
        },
      ]);

      const seedHidden = await request(app.getHttpServer())
        .get("/search")
        .query({ q: "München" })
        .set(auth)
        .expect(200);
      expect(seedHidden.body.hits).toEqual([]);

      const restrictedUrl = new URL(adminUrl);
      restrictedUrl.username = appDbUser;
      restrictedUrl.password = appDbPassword;
      featureDb = new DatabaseService({
        get: (key: string) => (key === "DATABASE_URL" ? restrictedUrl.toString() : undefined),
      } as ConfigService);
      const restricted = new SearchService(featureDb, new GeoCatalogService(featureDb));
      await expect(restricted.search({ geoKey: "04011000" })).resolves.toEqual({
        hits: [
          {
            id: "1",
            label: "Alpha Ort",
            grain: "ags",
            geoKey: "04011000",
            lon: null,
            lat: null,
          },
        ],
      });
      await expect(restricted.search({ q: "München" })).resolves.toEqual({ hits: [] });
    } finally {
      await featureDb?.onModuleDestroy().catch(() => undefined);
      await admin.query("DROP SCHEMA IF EXISTS features CASCADE");
      await admin.query("DROP ROLE IF EXISTS backend_app");
      await admin.query("DROP ROLE IF EXISTS backend_ro_features");
      await admin.end();
    }
  });

  it("runs Musteranalyse for the signed-in user and keeps Brain facts inside the region", async () => {
    const adminUrl = process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("DATABASE_URL is required");
    const admin = new Pool({ connectionString: adminUrl, max: 1 });
    const email = `analysis-${Date.now()}@ruehrai.local`;

    try {
      await admin.query("DROP SCHEMA IF EXISTS features CASCADE");
      await admin.query("CREATE SCHEMA features");
      await admin.query(`
        CREATE TABLE features.location_feature_docs (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          geo_key text NOT NULL,
          grain text NOT NULL,
          ref_period text,
          name text,
          title text NOT NULL,
          content text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          source_theme text
        )
      `);
      await admin.query(`
        CREATE VIEW features.v_location_search AS
        SELECT id, geo_key, grain, ref_period, name, title, content, metadata, source_theme
        FROM features.location_feature_docs
      `);
      await admin.query(
        `INSERT INTO features.location_feature_docs
           (geo_key, grain, ref_period, name, title, content, metadata, source_theme)
         VALUES
           ('09162000', 'ags', '2022-05', 'München', 'Gemeinde München',
            'Bevölkerung der Gemeinde München.',
            '{"einwohner": 1500000, "gemeinde_name": "München"}'::jsonb, 'zensus'),
           ('11000000', 'ags', '2022-05', 'Berlin', 'Gemeinde Berlin',
            'Bevölkerung von Berlin.', '{"einwohner": 3700000}'::jsonb, 'zensus'),
           ('80331', 'plz5', '2022-05', '80331', 'PLZ 80331',
            'Haushalte in der PLZ.', '{"haushalte": 9000}'::jsonb, 'zensus')`,
      );

      const token = await register(email);
      const auth = { authorization: `Bearer ${token}` };
      const server = app.getHttpServer();
      const missing = await request(server).get("/analysis/input").set(auth).expect(404);
      expect(missing.body.message).toContain("Zielregion");

      await request(server)
        .put("/target-region")
        .set(auth)
        .send({
          label: "München",
          grain: "ags",
          geoKey: "09162000",
          ags: "09162000",
          geometry: muenchenOutline,
        })
        .expect(200);
      const created = await request(server)
        .post("/stores")
        .set(auth)
        .send({ street: "Marienplatz 1", postalCode: "80331", city: "München" })
        .expect(201);
      const storeId = created.body.id as string;
      await request(server)
        .put(`/stores/${storeId}/revenue`)
        .set(auth)
        .send({ points: [{ year: 2025, month: 1, revenueEur: 100 }] })
        .expect(200);
      const tooThin = await request(server).post("/analysis/runs").set(auth).expect(400);
      expect(tooThin.body.message).toContain("Monatsumsätze");

      await request(server)
        .put(`/stores/${storeId}/revenue`)
        .set(auth)
        .send({ points: [{ year: 2025, month: 2, revenueEur: 140 }] })
        .expect(200);

      const run = await request(server).post("/analysis/runs").set(auth).expect(201);
      expect(run.body.status).toBe("completed");
      expect(run.body.input.revenueDirection).toBe("up");
      expect(run.body.brain.mode).toBe("sql");
      expect(run.body.pattern.source).toBe("heuristic");
      const geoKeys = (run.body.brain.facts as Array<{ geoKey: string }>).map((fact) => fact.geoKey);
      expect(geoKeys).toContain("09162000");
      expect(geoKeys).toContain("80331");
      expect(geoKeys).not.toContain("11000000");
      expect(run.body.pattern.criteria).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "einwohner", direction: "unknown" })]),
      );

      const pattern = await request(server).get("/analysis/pattern").set(auth).expect(200);
      expect(pattern.body.runId).toBe(run.body.id);
      const again = await request(server)
        .get(`/analysis/runs/${run.body.id}`)
        .set(auth)
        .expect(200);
      expect(again.body.pattern.source).toBe("heuristic");

      const other = await register(`analysis-other-${Date.now()}@ruehrai.local`);
      await request(server)
        .get(`/analysis/runs/${run.body.id}`)
        .set({ authorization: `Bearer ${other}` })
        .expect(404);
      await request(server)
        .get("/analysis/pattern")
        .set({ authorization: `Bearer ${other}` })
        .expect(404);
    } finally {
      await admin.query("DROP SCHEMA IF EXISTS features CASCADE");
      await admin.end();
    }
  });

  it("ranks Top-3 recommendations for the signed-in user and explains a thin region", async () => {
    const adminUrl = process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("DATABASE_URL is required");
    const admin = new Pool({ connectionString: adminUrl, max: 1 });
    const stamp = Date.now();
    const months = sixMonths();
    const early = months[0]!;
    const late = months[5]!;

    try {
      await admin.query("DROP SCHEMA IF EXISTS features CASCADE");
      await admin.query("CREATE SCHEMA features");
      await admin.query(`
        CREATE TABLE features.location_feature_docs (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          geo_key text NOT NULL,
          grain text NOT NULL,
          ref_period text,
          name text,
          title text NOT NULL,
          content text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          source_theme text,
          lon double precision,
          lat double precision
        )
      `);
      await admin.query(`
        CREATE VIEW features.v_location_search AS
        SELECT id, geo_key, grain, ref_period, name, title, content, metadata, source_theme, lon, lat
        FROM features.location_feature_docs
      `);

      const series: Array<[string, string, string, string, string, number, number, number, number, number | null, number | null]> = [
        ["09162000", "ags", early, "München", "München", 100, 5, 0, 0, 11.57, 48.13],
        ["09162000", "ags", late, "München", "München", 150, 9, 0, 0, 11.57, 48.13],
        ["80331", "plz5", early, "80331", "PLZ 80331", 100, 5, 0, 0, null, null],
        ["80331", "plz5", late, "80331", "PLZ 80331", 140, 8, 0, 0, null, null],
        ["80801", "plz5", early, "Schwabing", "Schwabing", 10, 5, 1, 0, 11.58, 48.16],
        ["80801", "plz5", late, "Schwabing", "Schwabing", 20, 9, 1, 0, 11.58, 48.16],
        ["81369", "plz5", early, "Sendling", "Sendling", 10, 4, 1, 0, 11.54, 48.12],
        ["81369", "plz5", late, "Sendling", "Sendling", 30, 8, 1, 0, 11.54, 48.12],
        ["81541", "plz5", "2020-01", "Giesing", "Giesing", 1, 1, 1, 0, 11.59, 48.11],
        ["81541", "plz5", early, "Giesing", "Giesing", 10, 9, 1, 0, 11.59, 48.11],
        ["81541", "plz5", late, "Giesing", "Giesing", 20, 5, 1, 0, 11.59, 48.11],
        ["80686", "plz5", early, "Laim", "Laim", 20, 8, 1, 0, 11.5, 48.14],
        ["80686", "plz5", late, "Laim", "Laim", 10, 4, 1, 0, 11.5, 48.14],
        ["11000000", "ags", early, "Berlin", "Berlin", 1, 1, 0, 0, 13.4, 52.52],
        ["11000000", "ags", late, "Berlin", "Berlin", 100, 50, 0, 0, 13.4, 52.52],
      ];
      for (const row of series) {
        const [geoKey, grain, refPeriod, name, title, einwohner, haushalte, inRegion, , lon, lat] =
          row;
        const metadata =
          inRegion === 1
            ? { einwohner, haushalte, geo_ags: "09162000" }
            : { einwohner, haushalte };
        await admin.query(
          `INSERT INTO features.location_feature_docs
             (geo_key, grain, ref_period, name, title, content, metadata, source_theme, lon, lat)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'zensus', $8, $9)`,
          [
            geoKey,
            grain,
            refPeriod,
            name,
            title,
            `${title} Kennzahlen.`,
            JSON.stringify(metadata),
            lon,
            lat,
          ],
        );
      }

      const token = await register(`reco-${stamp}@ruehrai.local`);
      const auth = { authorization: `Bearer ${token}` };
      const server = app.getHttpServer();

      const missingPattern = await request(server).post("/recommendations").set(auth).send({}).expect(404);
      expect(missingPattern.body.message).toContain("Muster");
      const missingList = await request(server).get("/recommendations").set(auth).expect(404);
      expect(missingList.body.message).toContain("Empfehlungen");

      await request(server)
        .put("/target-region")
        .set(auth)
        .send({
          label: "München",
          grain: "ags",
          geoKey: "09162000",
          ags: "09162000",
          geometry: muenchenOutline,
        })
        .expect(200);
      const created = await request(server)
        .post("/stores")
        .set(auth)
        .send({ street: "Marienplatz 1", postalCode: "80331", city: "München" })
        .expect(201);
      await request(server)
        .put(`/stores/${created.body.id}/revenue`)
        .set(auth)
        .send({
          points: [
            { year: 2025, month: 1, revenueEur: 100 },
            { year: 2025, month: 2, revenueEur: 140 },
          ],
        })
        .expect(200);

      const run = await request(server).post("/analysis/runs").set(auth).expect(201);
      const criteria = run.body.pattern.criteria as Array<{ key: string; direction: string }>;
      expect(criteria).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "einwohner", direction: "up" }),
          expect.objectContaining({ key: "haushalte", direction: "up" }),
        ]),
      );

      await request(server).post("/recommendations").set(auth).send({ runId: "abc" }).expect(400);

      const createdSet = await request(server)
        .post("/recommendations")
        .set(auth)
        .send({ runId: run.body.id })
        .expect(201);
      expect(createdSet.body.count).toBe(3);
      expect(createdSet.body.reason).toBeNull();
      expect(createdSet.body.window).toEqual({ from: early, to: late });
      expect(createdSet.body.runId).toBe(run.body.id);
      expect(createdSet.body.pattern.source).toBe("heuristic");
      const titles = (createdSet.body.items as Array<{ title: string; rank: number; source: string; rationale: string; score: number; location: { geoKey: string; lon: number } }>).map(
        (item) => item.title,
      );
      expect(titles).toEqual(["Schwabing", "Sendling", "Giesing"]);
      expect(createdSet.body.items.map((item: { rank: number }) => item.rank)).toEqual([1, 2, 3]);
      expect(createdSet.body.items.map((item: { id: string }) => item.id)).not.toEqual(
        expect.arrayContaining(["plz5:80686", "ags:11000000", "ags:09162000"]),
      );
      expect(createdSet.body.items[0]).toMatchObject({
        source: "heuristic",
        score: 1,
        location: { geoKey: "80801", grain: "plz5" },
      });
      expect(createdSet.body.items[0].location.lon).toBeCloseTo(11.58);
      expect(createdSet.body.items[0].rationale).toContain("Schwabing");
      expect(createdSet.body.items[0].rationale).toContain("Heuristik");
      expect(createdSet.body.items[2].score).toBe(0.5);
      expect(createdSet.body.items[2].criteriaEvidence.map((entry: { key: string }) => entry.key)).toEqual([
        "einwohner",
      ]);

      const latest = await request(server).get("/recommendations").set(auth).expect(200);
      expect(latest.body.id).toBe(createdSet.body.id);
      expect(latest.body.items.map((item: { title: string }) => item.title)).toEqual(titles);

      const other = await register(`reco-other-${stamp}@ruehrai.local`);
      await request(server)
        .get("/recommendations")
        .set({ authorization: `Bearer ${other}` })
        .expect(404);
      await request(server)
        .post("/recommendations")
        .set({ authorization: `Bearer ${other}` })
        .send({})
        .expect(404);

      await admin.query("DELETE FROM features.location_feature_docs WHERE grain = 'plz5'");
      const thin = await request(server).post("/recommendations").set(auth).send({}).expect(201);
      expect(thin.body.count).toBe(1);
      expect(thin.body.items[0].title).toBe("München");
      expect(thin.body.reason).toContain("nur 1 Standort");
      expect(thin.body.items[0].source).toBe("heuristic");
    } finally {
      await admin.query("DROP SCHEMA IF EXISTS features CASCADE");
      await admin.end();
    }
  });
});

function sixMonths(): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}
