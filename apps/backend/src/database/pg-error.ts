function readCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** SQLSTATE on the error, or on `cause` when a driver wraps the pg error. */
function pgErrorCode(error: unknown): string | undefined {
  return readCode(error) ?? readCode(causeOf(error));
}

function causeOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("cause" in error)) return undefined;
  return (error as { cause: unknown }).cause;
}

function pgRecord(error: unknown): Record<string, unknown> | undefined {
  const direct = readCode(error);
  if (direct && typeof error === "object" && error !== null) {
    return error as Record<string, unknown>;
  }
  const cause = causeOf(error);
  if (readCode(cause) && typeof cause === "object" && cause !== null) {
    return cause as Record<string, unknown>;
  }
  return undefined;
}

/** SQLSTATE and constraint identifiers. Omits `detail`, which can contain the row. */
export function pgErrorSummary(error: unknown): string {
  const record = pgRecord(error);
  if (!record) return "no sqlstate";
  const parts = ["code", "constraint", "table", "schema", "routine"]
    .filter((key) => typeof record[key] === "string")
    .map((key) => `${key}=${record[key] as string}`);
  return parts.length > 0 ? parts.join(" ") : "no sqlstate";
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23505";
}

export function isCheckViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23514";
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
