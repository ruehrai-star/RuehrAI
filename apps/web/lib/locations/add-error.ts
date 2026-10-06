import { ApiError } from "../api/types.ts";
import { TARGET_REGION_WITHOUT_GEOMETRY_CODE, errorText } from "../user-message.ts";
import { readContractBounds, readRegionGeometry } from "../map/karte.ts";
import { REGION_LIST_COPY } from "./regions.ts";

export { TARGET_REGION_WITHOUT_GEOMETRY_CODE };

/**
 * Map POST /target-region failures to German UI copy.
 * Backend `message` (often English) must never reach the DOM.
 *
 * Inventory (main, #79, #84 OpenAPI 0.19.6):
 * - 400 no outline: `code` `TARGET_REGION_WITHOUT_GEOMETRY` (confirmed #84).
 * - 400 no catalog id: `TARGET_REGION_PLACE_REQUIRED` English, no `code`.
 * - 400 ValidationPipe: class-validator English, no `code`.
 * - 401 Unauthorized.
 * - Duplicate catalog key: HTTP 200 with the stored item, not 4xx.
 * - List cap 200: none on POST /target-region; 200 is POST /analysis/runs.
 */
export function addTargetRegionUserMessage(error: unknown): string {
  if (isMissingMapAreaFailure(error)) return REGION_LIST_COPY.noMapArea;
  if (isPlaceRequiredFailure(error)) return REGION_LIST_COPY.placeRequired;
  return errorText(error, REGION_LIST_COPY.addFailed);
}

/** Client already knows the catalog has no drawable outline. */
export function missingMapAreaClientError(): { readonly noMapArea: true } {
  return { noMapArea: true };
}

export function isMissingMapAreaFailure(error: unknown): boolean {
  if (error && typeof error === "object" && "noMapArea" in error && (error as { noMapArea?: unknown }).noMapArea === true) {
    return true;
  }
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 400) return false;
  return matchesPublishedMissingMapAreaCode(error.code);
}

export function isPlaceRequiredFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 400 && error.status !== 422) return false;
  if (error.code) return false;
  return messageLooksLikePlaceRequired(error.message);
}

function matchesPublishedMissingMapAreaCode(code?: string | null): boolean {
  return (code ?? "").trim() === TARGET_REGION_WITHOUT_GEOMETRY_CODE;
}

function messageLooksLikePlaceRequired(message: string): boolean {
  // Assumption (no ErrorResponse.code on main / #79 / #84): Nest 400
  // `TARGET_REGION_PLACE_REQUIRED` is identified by these English fragments.
  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (text.includes("free-text label")) return true;
  if (text.includes("geokey, ags, or plz")) return true;
  return false;
}

/**
 * Client-side: only when the hit already carries geometry/bounds and neither
 * is a drawable area. Search hits without those fields stay unknown (POST).
 */
export function sourceLacksMapArea(source: object): boolean {
  if (!Object.prototype.hasOwnProperty.call(source, "geometry") && !Object.prototype.hasOwnProperty.call(source, "bounds")) {
    return false;
  }
  const record = source as { geometry?: unknown; bounds?: unknown };
  return readRegionGeometry(record.geometry) === null && readContractBounds(record.bounds) === null;
}
