import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger, BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { TOKEN_TTL_SECONDS } from "./auth.constants";
import { AuthService } from "./auth.service";
import { hashPassword, verifyPassword } from "./password-hash";

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
    const passwordHash = await hashPassword("dev-password");
    query.mockResolvedValue({
      rows: [{ id: "1", email: "dev@ruehrai.local", password_hash: passwordHash }],
    });

    const token = await service.login({
      email: " Dev@RuehrAI.local ",
      password: "dev-password",
    });

    expect(token.tokenType).toBe("Bearer");
    expect(token.expiresIn).toBe(TOKEN_TTL_SECONDS);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["dev@ruehrai.local"]);
    expect(query.mock.calls[0][0]).not.toMatch(/crypt|gen_salt/i);
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

  it("rejects a wrong password without asking Postgres to hash it", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "1",
          email: "dev@ruehrai.local",
          password_hash: await hashPassword("dev-password"),
        },
      ],
    });
    await expect(
      service.login({ email: "dev@ruehrai.local", password: "other-password" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("treats a stored hash that is not bcrypt as a failed login", async () => {
    query.mockResolvedValue({
      rows: [{ id: "1", email: "dev@ruehrai.local", password_hash: "not-a-bcrypt-hash" }],
    });
    await expect(
      service.login({ email: "dev@ruehrai.local", password: "dev-password" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("logs a login query failure and does not turn it into 401", async () => {
    const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("relation missing"), { code: "42P01", table: "users" });
    query.mockRejectedValue(failure);
    await expect(
      service.login({ email: "dev@ruehrai.local", password: "dev-password" }),
    ).rejects.toBe(failure);
    expect(errorLog.mock.calls.map((call) => String(call[0])).join("\n")).toContain("code=42P01");
    errorLog.mockRestore();
  });

  it("registers a user and stores a bcrypt hash", async () => {
    query.mockResolvedValue({
      rows: [{ id: "7", email: "new@ruehrai.local" }],
    });
    const token = await service.register({
      email: " New@RuehrAI.local ",
      password: "dev-password",
    });
    expect(token.tokenType).toBe("Bearer");
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/crypt|gen_salt/i);
    expect(sql).toContain("INSERT INTO app.users");
    expect(params[0]).toBe("new@ruehrai.local");
    expect(params[1]).toMatch(/^\$2[ab]\$10\$/);
    expect(await verifyPassword("dev-password", params[1] as string)).toBe(true);
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

  it("maps a wrapped unique violation to a conflict", async () => {
    query.mockRejectedValue(
      Object.assign(new Error("wrapped"), { cause: { code: "23505", constraint: "users_email_unique" } }),
    );
    await expect(
      service.register({ email: "dev@ruehrai.local", password: "dev-password" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("maps a check violation on register to 400", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    query.mockRejectedValue(
      Object.assign(new Error("check"), { code: "23514", constraint: "users_email_lowercase" }),
    );
    await expect(
      service.register({ email: "dev@ruehrai.local", password: "dev-password" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("users_email_lowercase"));
    warn.mockRestore();
  });

  it("logs an unexpected register failure and rethrows it", async () => {
    const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("permission denied for sequence users_id_seq"), {
      code: "42501",
      schema: "app",
    });
    query.mockRejectedValue(failure);
    await expect(
      service.register({ email: "dev@ruehrai.local", password: "dev-password" }),
    ).rejects.toBe(failure);
    expect(errorLog.mock.calls.map((call) => String(call[0])).join("\n")).toContain("code=42501");
    expect(errorLog.mock.calls.join(" ")).not.toContain("dev-password");
    errorLog.mockRestore();
  });

  it("rejects a password longer than 72 bytes before insert", async () => {
    await expect(
      service.register({ email: "dev@ruehrai.local", password: "ä".repeat(40) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps the migration seed hash valid for dev-password", async () => {
    const sql = readFileSync(join(__dirname, "../../db/migrations/001_init.sql"), "utf8");
    const match = sql.match(/'dev@ruehrai\.local',\s*'(\$2[ab]\$[^']+)'/);
    expect(match).not.toBeNull();
    await expect(verifyPassword("dev-password", match?.[1] ?? "")).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", match?.[1] ?? "")).resolves.toBe(false);
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
