import {
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
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
    const payload = await jwt.verifyAsync<{ sub: string; email: string; jti: string; exp: number }>(
      token.accessToken,
    );
    expect(payload).toMatchObject({
      sub: "1",
      email: "dev@ruehrai.local",
    });
    expect(payload.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(typeof payload.exp).toBe("number");
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
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("retries a pool connection timeout and then returns 503", async () => {
    const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const timeout = new Error("Connection terminated due to connection timeout", {
      cause: new Error("Connection terminated unexpectedly"),
    });
    query.mockRejectedValue(timeout);

    const failed = service.register({
      email: "new@ruehrai.local",
      password: "dev-password",
    });
    await expect(failed).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failed).rejects.toMatchObject({
      message: "Database temporarily unavailable",
      status: 503,
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(errorLog.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "Connection terminated due to connection timeout",
    );
    expect(errorLog.mock.calls.join(" ")).not.toContain("dev-password");
    errorLog.mockRestore();
    warn.mockRestore();
  });

  it("returns 503 from login when the pool keeps timing out", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    query.mockRejectedValue(new Error("timeout exceeded when trying to connect"));
    await expect(
      service.login({ email: "dev@ruehrai.local", password: "dev-password" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(query).toHaveBeenCalledTimes(3);
    jest.restoreAllMocks();
  });

  it("uses the next attempt when the first connection is dropped", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    query
      .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
      .mockResolvedValueOnce({ rows: [{ id: "4", email: "new@ruehrai.local" }] });
    const token = await service.register({
      email: "new@ruehrai.local",
      password: "dev-password",
    });
    expect(token.tokenType).toBe("Bearer");
    expect(query).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
  });

  it("does not retry a missing relation or turn it into 503", async () => {
    const failure = Object.assign(new Error("relation app.users does not exist"), { code: "42P01" });
    query.mockRejectedValue(failure);
    await expect(
      service.register({ email: "new@ruehrai.local", password: "dev-password" }),
    ).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("revokes a token jti and ignores an already stored id", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    await service.logout({
      id: "1",
      email: "dev@ruehrai.local",
      jti: "11111111-1111-4111-8111-111111111111",
      exp: 1_800_000_000,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO app.revoked_tokens"), [
      "11111111-1111-4111-8111-111111111111",
      "1",
      1_800_000_000,
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM app.revoked_tokens"),
    );
  });

  it("rejects logout when the token has no jti", async () => {
    await expect(
      service.logout({ id: "1", email: "dev@ruehrai.local" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("reports a stored jti as revoked", async () => {
    query.mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 });
    await expect(service.isRevoked("11111111-1111-4111-8111-111111111111")).resolves.toBe(
      true,
    );
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(service.isRevoked("11111111-1111-4111-8111-111111111111")).resolves.toBe(
      false,
    );
    await expect(service.isRevoked("not-a-uuid")).resolves.toBe(false);
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
