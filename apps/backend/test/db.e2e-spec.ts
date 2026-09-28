import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";

const runDb = process.env.RUN_DB_TESTS === "1";

(runDb ? describe : describe.skip)("Postgres-backed routes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
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
      byName.body.hits as { id: string; grain: string; lon: number; lat: number }[]
    ).find((hit) => hit.id === "ags:09162000");
    expect(munchen).toMatchObject({ grain: "ags" });
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
});
