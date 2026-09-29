import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

describe("JwtAuthGuard", () => {
  const getAllAndOverride = jest.fn();
  const verifyAsync = jest.fn();
  const isRevoked = jest.fn();
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const jwt = { verifyAsync } as unknown as JwtService;
  const auth = { isRevoked } as unknown as AuthService;
  const guard = new JwtAuthGuard(reflector, jwt, auth);

  beforeEach(() => {
    getAllAndOverride.mockReset();
    verifyAsync.mockReset();
    isRevoked.mockReset();
  });

  function context(authorization?: string): {
    ctx: ExecutionContext;
    request: { headers: { authorization?: string }; user?: unknown };
  } {
    const request: { headers: { authorization?: string }; user?: unknown } = {
      headers: {},
    };
    if (authorization !== undefined) request.headers.authorization = authorization;
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  it("skips verification on public routes", async () => {
    getAllAndOverride.mockReturnValue(true);
    const { ctx } = context();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer token", async () => {
    getAllAndOverride.mockReturnValue(false);
    const { ctx } = context();
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a revoked jti and lets database errors through", async () => {
    getAllAndOverride.mockReturnValue(false);
    verifyAsync.mockResolvedValue({
      sub: "1",
      email: "dev@ruehrai.local",
      jti: "11111111-1111-4111-8111-111111111111",
      exp: 1_800_000_000,
    });
    isRevoked.mockResolvedValue(true);
    const { ctx } = context("Bearer token");
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);

    isRevoked.mockRejectedValue(new Error("db down"));
    await expect(guard.canActivate(ctx)).rejects.toThrow("db down");
  });

  it("attaches jti and exp for a live token", async () => {
    getAllAndOverride.mockReturnValue(false);
    verifyAsync.mockResolvedValue({
      sub: "7",
      email: "a@ruehrai.local",
      jti: "11111111-1111-4111-8111-111111111111",
      exp: 1_800_000_000,
    });
    isRevoked.mockResolvedValue(false);
    const { ctx, request } = context("Bearer token");
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: "7",
      email: "a@ruehrai.local",
      jti: "11111111-1111-4111-8111-111111111111",
      exp: 1_800_000_000,
    });
  });
});
