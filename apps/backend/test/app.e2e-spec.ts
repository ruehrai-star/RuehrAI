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
});
