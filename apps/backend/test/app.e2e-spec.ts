import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";

describe("API smoke", () => {
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

  it("GET /health is public", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("GET /auth/me without a bearer token is 401", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("GET /auth/me with a bad token is 401", async () => {
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("authorization", "Bearer not-a-jwt")
      .expect(401);
  });

  it("GET /search without a bearer token is 401", async () => {
    await request(app.getHttpServer()).get("/search").expect(401);
  });

  it("GET /layers/:id without a bearer token is 401", async () => {
    await request(app.getHttpServer()).get("/layers/demo-gemeinden").expect(401);
  });

  it("POST /auth/login rejects an empty body", async () => {
    await request(app.getHttpServer()).post("/auth/login").send({}).expect(400);
  });

  it("customer routes without a bearer token are 401", async () => {
    const server = app.getHttpServer();
    await request(server).post("/auth/logout").expect(401);
    await request(server).get("/target-region").expect(401);
    await request(server).post("/target-region").send({ label: "München" }).expect(401);
    await request(server).put("/target-region").send({ label: "München" }).expect(404);
    await request(server).delete("/target-region/09162000").expect(401);
    await request(server).get("/stores").expect(401);
    await request(server).post("/stores").send({ street: "A 1", postalCode: "80331", city: "München" }).expect(401);
    await request(server).get("/stores/1/revenue").expect(401);
    await request(server).get("/analysis/input").expect(401);
    await request(server).post("/analysis/runs").expect(401);
    await request(server).get("/analysis/runs/1").expect(401);
    await request(server).get("/analysis/pattern").expect(401);
    await request(server).post("/recommendations").expect(401);
    await request(server).get("/recommendations").expect(401);
  });
});
