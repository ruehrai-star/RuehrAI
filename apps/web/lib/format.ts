import { isCatalogLevel, type CatalogLevel, type Grain } from "./api/types.ts";

export type { CatalogLevel } from "./api/types.ts";
export { CATALOG_LEVELS, isCatalogLevel } from "./api/types.ts";

const GRAIN_LABELS: Record<Grain, string> = {
  address: "Adresse",
  grid100: "100-m-Gitter",
  plz8: "PLZ8",
  plz5: "PLZ",
  ags: "Gemeinde",
  ags5: "Kreis",
  other: "Sonstiges",
};

const CATALOG_LEVEL_LABELS: Record<CatalogLevel, string> = {
  plz: "PLZ",
  bezirk: "Bezirk",
  stadtbezirk: "Stadtbezirk",
  stadtteil: "Stadtteil",
  ortsteil: "Ortsteil",
};

const SUB_AREA_LEVELS = new Set<CatalogLevel>(["plz", "bezirk", "stadtbezirk", "stadtteil", "ortsteil"]);

export interface CatalogBadgeSource {
  level?: unknown;
  grain?: Grain | null;
  geoKey?: string | null;
  ags?: string | null;
  id?: string | null;
}

/**
 * German badge for a contract grain.
 *
 * Berlin Bezirke stay `ags` in the API. Their canonical 8-digit AGS is
 * `11000001`–`11000012` (search ids `ags:11000001` … `ags:11000012`).
 * Those badges say „Bezirk“. Every other `ags` stays „Gemeinde“, including
 * Berlin `11000000`. Pass `geoKey`, `ags`, or a search id.
 *
 * A present catalog `level` is mapped by `catalogBadge` and must not be
 * overridden by this AGS special case.
 */
export function grainLabel(grain: Grain, geoKey?: string | null): string {
  if (grain === "ags" && isBerlinBezirkAgs(geoKey)) return "Bezirk";
  return GRAIN_LABELS[grain];
}

export function catalogLevelOf(value: unknown): CatalogLevel | null {
  return isCatalogLevel(value) ? value : null;
}

/**
 * Zielregion catalog badge. A present `level` wins, including over the Berlin
 * AGS 11000001–12 „Bezirk“ fallback. Sub-areas never become „Gemeinde“.
 * Municipality hits without `level` keep the grain badge („Gemeinde“ / „Bezirk“).
 */
export function catalogBadge(source: CatalogBadgeSource): string {
  const level = catalogLevelOf(source.level);
  if (level) return CATALOG_LEVEL_LABELS[level];
  if (source.grain) return grainLabel(source.grain, source.ags || source.geoKey || source.id);
  return "";
}

export function isSubAreaLevel(value: unknown): boolean {
  const level = catalogLevelOf(value);
  return level !== null && SUB_AREA_LEVELS.has(level);
}

/**
 * Parent municipality name next to a catalog hit.
 * The contract field is exactly `parentLabel`. Show it only when it is a
 * non-empty string. Do not read any other key.
 */
export function catalogParentName(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as { parentLabel?: unknown }).parentLabel;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isBerlinBezirkAgs(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  let code = value.trim();
  if (code.startsWith("ags:")) code = code.slice(4);
  if (!/^[0-9]{8}$/.test(code)) return false;
  const ags = Number(code);
  return ags >= 11000001 && ags <= 11000012;
}

export function zoomForGrain(grain: Grain): number {
  switch (grain) {
    case "address":
      return 16;
    case "grid100":
      return 15.5;
    case "plz8":
      return 14;
    case "plz5":
      return 13;
    case "ags":
    case "ags5":
      return 11;
    default:
      return 12;
  }
}
