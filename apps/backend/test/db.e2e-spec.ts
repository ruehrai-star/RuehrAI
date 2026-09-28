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
});
