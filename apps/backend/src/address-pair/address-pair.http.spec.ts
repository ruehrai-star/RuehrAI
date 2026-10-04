import { CanActivate, ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { configureApp } from "../configure-app";
import { DatabaseService } from "../database/database.service";
import { GEMEINDE_TOPIC_IDS, KREIS_TOPIC_IDS, LAND_TOPIC_IDS } from "./topics";

class SignedInGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { id: string; email: string } }>();
    request.user = { id: "1", email: "dev@ruehrai.local" };
    return true;
  }
}

describe("POST /address-pair", () => {
  const queryReadingFeatures = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(SignedInGuard)
      .overrideProvider(DatabaseService)
      .useValue({ queryReadingFeatures, query: jest.fn(), onModuleDestroy: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    queryReadingFeatures.mockReset();
    queryReadingFeatures.mockImplementation(async (sql: string) => {
      if (sql.includes("geo_ref_plz")) return { rows: [{ plz: "80331", geo_ags: "09162000", geo_ags5: "09162", geo_land: "09" }] };
      if (sql.includes("geo_ref_admin")) {
        return {
          rows: [
            { geo_ags: "09162000", name: "München" },
            { geo_ags: "09162", name: "München, Landeshauptstadt" },
            { geo_ags: "09", name: "Bayern" },
          ],
        };
      }
      if (sql.includes("location_feature_docs") || sql.includes("v_location_search")) {
        return {
          rows: [
            {
              source_theme: "ba_pendler",
              grain: "ags",
              geo_key: "09162000",
              metadata: { count: 12 },
              ref_period: "2025-06",
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it("rejects a body the web client would not send", async () => {
    const server = app.getHttpServer();
    await request(server).post("/address-pair").send({}).expect(400);
    await request(server)
      .post("/address-pair")
      .send({
        left: { street: " ", postalCode: "80331", city: "München" },
        right: { street: "A 1", postalCode: "80331", city: "München" },
      })
      .expect(400);
    await request(server)
      .post("/address-pair")
      .send({
        left: { street: "A 1", postalCode: "8033", city: "München" },
        right: { street: "B 1", postalCode: "80331", city: "München" },
      })
      .expect(400);
  });

  it("returns the contract the web parser accepts", async () => {
    const response = await request(app.getHttpServer())
      .post("/address-pair")
      .send({
        left: { street: " Marienplatz 1 ", postalCode: "80331", city: " München " },
        right: { street: "Kaufingerstraße 4", postalCode: "80331", city: "München" },
      })
      .expect(200);

    expect(response.body.left.input).toEqual({
      street: "Marienplatz 1",
      postalCode: "80331",
      city: "München",
    });
    expect(response.body.left.resolution).toBe("resolved");
    expect(response.body.left.gemeinde).toEqual({ name: "München" });
    expect(response.body.left.kreis).toEqual({ name: "München, Landeshauptstadt" });
    expect(response.body.left.land).toEqual({ name: "Bayern" });
    expect(response.body.left.topics).toHaveLength(
      GEMEINDE_TOPIC_IDS.length + KREIS_TOPIC_IDS.length + LAND_TOPIC_IDS.length,
    );
    const pendler = response.body.left.topics.find(
      (topic: { id: string; level: string }) => topic.id === "pendler" && topic.level === "gemeinde",
    );
    expect(pendler).toEqual({ id: "pendler", level: "gemeinde", status: "present", value: { count: 12 } });
    const absent = response.body.left.topics.find((topic: { id: string }) => topic.id === "breitband");
    expect(absent).toEqual({ id: "breitband", level: "gemeinde", status: "absent" });
    expect(absent.value).toBeUndefined();
    expect(response.body.shared).toEqual([
      { id: "pendler", level: "gemeinde", left: { count: 12 }, right: { count: 12 } },
    ]);
    expect(response.body.right.topics.find((topic: { id: string; level: string; value?: unknown }) => topic.id === "pendler" && topic.level === "gemeinde").value).toEqual({
      count: 12,
    });
  });
});
