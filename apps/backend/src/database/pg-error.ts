function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

const TRANSIENT_NODE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

/** Postgres shutdown / cannot-connect-now. Not a bad request. */
const TRANSIENT_PG_CODES = new Set(["57P01", "57P02", "57P03"]);

function causeOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("cause" in error)) return undefined;
  return (error as { cause: unknown }).cause;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error !== "object" || error === null || !("message" in error)) return "";
  const message = (error as { message: unknown }).message;
  return typeof message === "string" ? message : "";
}

/**
 * Pool connect timeout, a dropped socket, or Postgres refusing the session.
 * Unique violations and validation failures are not transient.
 */
export function isTransientConnectionError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 4 && !seen.has(current); depth += 1) {
    seen.add(current);
    const code = pgErrorCode(current);
    if (
      code &&
      (TRANSIENT_NODE_CODES.has(code) || TRANSIENT_PG_CODES.has(code) || code.startsWith("08"))
    ) {
      return true;
    }
    const message = errorMessage(current).toLowerCase();
    if (
      message.includes("connection terminated") ||
      message.includes("connection timeout") ||
      message.includes("timeout exceeded when trying to connect") ||
      message.includes("timeout expired")
    ) {
      return true;
    }
    current = causeOf(current);
  }
  return false;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23505";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23503";
}

/**
 * True when SET ROLE failed for a privilege or catalog reason.
 * Postgres reports a missing role as 22023 (`invalid_parameter_value`) or 42704,
 * and a role the user cannot assume as 42501. Connection failures stay false
 * so a blip is not cached as "role unavailable".
 * Only use this for the SET ROLE probe, not for later SELECTs.
 */
export function isFeaturesRoleUnusable(error: unknown): boolean {
  const code = pgErrorCode(error);
  if (!code || !/^[0-9A-Z]{5}$/.test(code)) return false;
  if (code.startsWith("08") || code.startsWith("57")) return false;
  return true;
}

/** Schema or view is not installed. */
export function isMissingFeaturesRelation(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === "42P01" || code === "3F000";
}

/**
 * Brain `geo` catalog cannot be read: missing schema/table, no PostGIS
 * (`ST_*` undefined), or `backend_ro_features` has no SELECT.
 */
export function isGeoCatalogUnavailable(error: unknown): boolean {
  const code = pgErrorCode(error);
  return (
    code === "42P01" ||
    code === "3F000" ||
    code === "42883" ||
    code === "42501"
  );
}

/** Connected user or backend_ro_features may not read this relation. */
export function isFeaturesAccessDenied(error: unknown): boolean {
  return pgErrorCode(error) === "42501";
}

/** Undefined column (42703). */
export function isUndefinedColumn(error: unknown): boolean {
  return pgErrorCode(error) === "42703";
}

/**
 * `geo.geo_ref_quartier` is missing, unreadable, or has unexpected columns.
 * Callers keep geometry null / omit quartier joins instead of 500.
 */
export function isGeoRefQuartierUnavailable(error: unknown): boolean {
  if (
    !isMissingFeaturesRelation(error) &&
    !isGeoCatalogUnavailable(error) &&
    !isFeaturesAccessDenied(error) &&
    !isUndefinedColumn(error)
  ) {
    return false;
  }
  return /geo_ref_quartier|geo_quartier/i.test(errorMessage(error));
}

/**
 * pgvector query cannot run: missing operator/column, dimension mismatch,
 * or the embedding column is not a vector. Used only around the optional
 * vector SELECT so the SQL filter path can still answer.
 */
export function isVectorQueryFailure(error: unknown): boolean {
  const code = pgErrorCode(error);
  return (
    code === "22000" ||
    code === "42703" ||
    code === "42804" ||
    code === "42883" ||
    code === "42P01" ||
    code === "42501"
  );
}
