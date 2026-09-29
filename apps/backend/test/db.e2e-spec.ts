import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { DatabaseService } from "../src/database/database.service";
import { SearchService } from "../src/search/search.service";

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

  it("returns a GeoJSON feature collection and 404 for an unknown layer", async () => {
    const token = await login("dev@ruehrai.local", "dev-password");
    const auth = { authorization: `Bearer ${token}` };

    const response = await request(app.getHttpServer())
      .get("/layers/demo-gemeinden")
      .set(auth)
      .expect(200);
    expect(response.body.type).toBe("FeatureCollection");
    expect(response.body.features.length).toBe(3);
    const geometries = (response.body.features as { geometry: { type: string } }[]).map(
      (feature) => feature.geometry.type,
    );
    expect(geometries).toEqual(expect.arrayContaining(["Point", "Polygon"]));

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
      })
      .expect(200);
    expect(region.body).toMatchObject({
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
    });
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
      const restricted = new SearchService(featureDb);
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
        .send({ label: "München", grain: "ags", geoKey: "09162000", ags: "09162000" })
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
});
