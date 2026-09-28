import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { TOKEN_TTL_SECONDS } from "./auth.constants";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const query = jest.fn();
  let service: AuthService;
  let jwt: JwtService;

  beforeEach(async () => {
    query.mockReset();
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-jwt-secret-not-for-production",
          signOptions: { expiresIn: TOKEN_TTL_SECONDS },
        }),
      ],
      providers: [AuthService, { provide: DatabaseService, useValue: { query } }],
    }).compile();
    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  it("returns a bearer token for a matching user", async () => {
    query.mockResolvedValue({
      rows: [{ id: "1", email: "dev@ruehrai.local" }],
    });

    const token = await service.login({
      email: " Dev@RuehrAI.local ",
      password: "dev-password",
    });

    expect(token.tokenType).toBe("Bearer");
    expect(token.expiresIn).toBe(TOKEN_TTL_SECONDS);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      "dev@ruehrai.local",
      "dev-password",
    ]);
    await expect(jwt.verifyAsync(token.accessToken)).resolves.toMatchObject({
      sub: "1",
      email: "dev@ruehrai.local",
    });
  });

  it("rejects an unknown user", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(
      service.login({
        email: "missing@ruehrai.local",
        password: "dev-password",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("maps a unique violation on register to a conflict", async () => {
    query.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "23505" }));
    await expect(
      service.register({
        email: "dev@ruehrai.local",
        password: "dev-password",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("loads the current user by id", async () => {
    query.mockResolvedValue({
      rows: [{ id: "1", email: "dev@ruehrai.local" }],
    });
    await expect(service.me("1")).resolves.toEqual({
      id: "1",
      email: "dev@ruehrai.local",
    });
  });
});
