import { PG_POOL_DEFAULTS, readPgPoolOptions } from "./pool-options";

describe("readPgPoolOptions", () => {
  it("uses STAGE defaults when the variables are unset", () => {
    expect(readPgPoolOptions(() => undefined)).toEqual({
      max: PG_POOL_DEFAULTS.max,
      idleTimeoutMillis: PG_POOL_DEFAULTS.idleTimeoutMillis,
      connectionTimeoutMillis: PG_POOL_DEFAULTS.connectionTimeoutMillis,
      keepAlive: true,
      keepAliveInitialDelayMillis: PG_POOL_DEFAULTS.keepAliveInitialDelayMillis,
    });
    expect(PG_POOL_DEFAULTS.connectionTimeoutMillis).toBeGreaterThanOrEqual(10_000);
    expect(PG_POOL_DEFAULTS.keepAlive).toBe(true);
  });

  it("reads pool limits from the environment", () => {
    const values: Record<string, string> = {
      PG_POOL_MAX: "4",
      PG_POOL_IDLE_TIMEOUT_MS: "15000",
      PG_POOL_CONNECTION_TIMEOUT_MS: "8000",
      PG_POOL_KEEP_ALIVE: "false",
      PG_POOL_KEEP_ALIVE_INITIAL_DELAY_MS: "5000",
    };
    expect(readPgPoolOptions((name) => values[name])).toEqual({
      max: 4,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 8_000,
      keepAlive: false,
      keepAliveInitialDelayMillis: 5_000,
    });
  });

  it("ignores blank or invalid numbers", () => {
    const values: Record<string, string> = {
      PG_POOL_MAX: "0",
      PG_POOL_CONNECTION_TIMEOUT_MS: "soon",
      PG_POOL_KEEP_ALIVE: "maybe",
    };
    expect(readPgPoolOptions((name) => values[name])).toMatchObject({
      max: PG_POOL_DEFAULTS.max,
      connectionTimeoutMillis: PG_POOL_DEFAULTS.connectionTimeoutMillis,
      keepAlive: PG_POOL_DEFAULTS.keepAlive,
    });
  });
});
