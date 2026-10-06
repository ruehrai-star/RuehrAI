import { ApiError, NetworkError } from "../api/types.ts";
import { readContractBounds, readRegionGeometry } from "../map/karte.ts";
import { REGION_LIST_COPY } from "./regions.ts";

/**
 * Map POST /target-region failures to German UI copy.
 * Backend English (`TARGET_REGION_NO_MAP_AREA`) must never reach the DOM.
 */
export function addTargetRegionUserMessage(error: unknown): string {
  if (isMissingMapAreaFailure(error)) return REGION_LIST_COPY.noMapArea;
  if (error instanceof NetworkError && error.message) return error.message;
  return REGION_LIST_COPY.addFailed;
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
  if (error.status < 400 || error.status >= 500) return false;
  if (matchesPublishedMissingMapAreaCode(readErrorCode(error))) return true;
  return messageLooksLikeMissingMapArea(error.message);
}

/**
 * TODO(backend-code): return true when `code` equals the published
 * ErrorResponse.code for a missing catalog outline on POST /target-region.
 * Do not invent that name here.
 */
function matchesPublishedMissingMapAreaCode(code: string): boolean {
  void code;
  return false;
}

function readErrorCode(error: ApiError): string {
  const extra = error as ApiError & { code?: unknown };
  return typeof extra.code === "string" ? extra.code.trim() : "";
}

function messageLooksLikeMissingMapArea(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (text.includes("no map area")) return true;
  if (text.includes("map area in the catalog")) return true;
  if (text.includes("supply geometry or bounds")) return true;
  if (text.includes("keine fläche")) return true;
  if (text.includes("keine flaeche")) return true;
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
