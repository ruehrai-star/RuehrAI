import { PoolConfig } from "pg";

/**
 * Defaults when the pool env vars are unset.
 * Longer connect timeout and TCP keepalive only soften a dropped socket.
 * They do not grant Postgres.app trust or change `pg_hba`.
 */
export const PG_POOL_DEFAULTS = {
  max: 10,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
} as const;

export function readPgPoolOptions(
  read: (name: string) => string | undefined,
): Pick<
  PoolConfig,
  | "max"
  | "idleTimeoutMillis"
  | "connectionTimeoutMillis"
  | "keepAlive"
  | "keepAliveInitialDelayMillis"
> {
  return {
    max: positiveInt(read("PG_POOL_MAX"), PG_POOL_DEFAULTS.max),
    idleTimeoutMillis: nonNegativeInt(
      read("PG_POOL_IDLE_TIMEOUT_MS"),
      PG_POOL_DEFAULTS.idleTimeoutMillis,
    ),
    connectionTimeoutMillis: positiveInt(
      read("PG_POOL_CONNECTION_TIMEOUT_MS"),
      PG_POOL_DEFAULTS.connectionTimeoutMillis,
    ),
    keepAlive: readBool(read("PG_POOL_KEEP_ALIVE"), PG_POOL_DEFAULTS.keepAlive),
    keepAliveInitialDelayMillis: nonNegativeInt(
      read("PG_POOL_KEEP_ALIVE_INITIAL_DELAY_MS"),
      PG_POOL_DEFAULTS.keepAliveInitialDelayMillis,
    ),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = parseIntLoose(raw);
  if (value === undefined || value < 1) return fallback;
  return value;
}

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const value = parseIntLoose(raw);
  if (value === undefined || value < 0) return fallback;
  return value;
}

function parseIntLoose(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) return undefined;
  return value;
}

function readBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return fallback;
}
