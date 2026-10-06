import type { AreaKind, Recommendation, RecommendationOverlap } from "../api/types.ts";
import { catalogBadge, grainLabel, isCatalogKey } from "../format.ts";

/**
 * Lage-Satz from `overlaps` may only be shown once shares are computed on the
 * hit area clipped to the Zielregion (same geometry as `items[].geometry`).
 *
 * #69 (OpenAPI 0.19.1, PO-Gate commit `438d963`) already clips:
 * `buildHitOverlapSql` uses `clipToRegionSql` / `$3`, and the contract says
 * `share` = intersection / clipped hit area. Default on.
 *
 * Flip to `false` only if a later #69 revision goes back to the full (unclipped)
 * hit geometry.
 */
export const SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT = true;

const RASTER_NAME = "100-m-Rasterzelle";
const RASTER_BADGE = "100-m-Raster";
const PLANUNGSRAUM = "Planungsraum";
const QUARTIER = "Quartier";

const RASTER_ID_NAME = /^(?:100-m-)?Rasterzelle\s+\S/i;
const FORBIDDEN_ID = /osm:|\bid:|address:|geo_addr|unbekannt|inspire/i;
const INSPIRE_CELL = /\b\d+m[NS]\d+[EW]\d+/i;
const NUMBERED_PLANUNGSRAUM = /^Planungsraum \d{8}$/;
const KOELN_SQ = /koeln:sq:/i;
const PLANUNGSRAUM_OHNE_NAMEN = "Planungsraum ohne Namen";

/**
 * Treffer Ebene-Badge (UX v4, Confluence 31227905). Badge and name use the
 * same word. Berlin LOR (`lor:plr:*`, `kind: lor`) is Planungsraum; Köln
 * (`koeln:sq:*`, `kind: quartier`) is Quartier; raster is 100-m-Raster.
 * This replaces the earlier rule that the LOR badge always showed Quartier.
 */
export function hitBadge(item: Recommendation): string {
  const grain = item.grain ?? item.location.grain;
  const keys = [item.id, locationKey(item), grain].filter((part): part is string => Boolean(part));
  const blob = keys.join(" ");
  if (isRasterHit(item, blob)) return RASTER_BADGE;
  if (isLorHit(item, blob)) return PLANUNGSRAUM;
  if (isKoelnQuartierHit(item, blob)) return QUARTIER;
  if (item.kind) return areaKindBadge(item.kind);
  if (grain === "address") return "Adresse";
  if (grain === "plz5" || grain === "plz8") return "PLZ";
  return catalogBadge({ ...item.location, grain }) || (grain ? grainLabel(grain, locationKey(item)) : "");
}

export function areaKindBadge(kind: AreaKind): string {
  switch (kind) {
    case "address":
      return "Adresse";
    case "grid100":
      return RASTER_BADGE;
    case "lor":
      return PLANUNGSRAUM;
    case "quartier":
      return QUARTIER;
    case "ortsteil":
    case "stadtteil":
      return "Ortsteil";
    case "plz":
      return "PLZ";
    case "bezirk":
    case "stadtbezirk":
      return "Bezirk";
    case "gemeinde":
      return "Gemeinde";
    default:
      return "";
  }
}

/**
 * Visible Treffer name from `name`. Never a geoKey or internal ID, including
 * inside the name. Raster is always „100-m-Rasterzelle“. Backend fallbacks
 * that still contain a forbidden ID are mapped here.
 */
export function hitName(item: Recommendation): string {
  if (isRasterHit(item, hitBlob(item))) return RASTER_NAME;
  const raw = visiblePlaceText(item.name) || visiblePlaceText(item.location.name) || visiblePlaceText(item.title);
  if (isRasterFallbackName(raw)) return RASTER_NAME;
  if (NUMBERED_PLANUNGSRAUM.test(raw)) return PLANUNGSRAUM_OHNE_NAMEN;
  if (!raw || nameHasForbiddenId(raw)) return unnamedKind(item);
  return raw;
}

export function overlapLageSentence(overlaps: Recommendation["overlaps"] | undefined): string | null {
  if (!SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT) return null;
  const entries = visibleOverlaps(overlaps);
  if (entries.length === 0) return null;
  const first = entries[0];
  if (!first) return null;
  if (entries.length === 1 || first.share >= 1) return `Liegt in ${first.label}.`;
  const percents = entries.map((entry) => ({ label: entry.label, pct: wholePercent(entry.share) }));
  if (percents.length === 2) {
    return `Liegt zu ${percents[0]?.pct} % in ${percents[0]?.label} und zu ${percents[1]?.pct} % in ${percents[1]?.label}.`;
  }
  if (percents.length === 3) {
    return `Liegt zu ${percents[0]?.pct} % in ${percents[0]?.label}, zu ${percents[1]?.pct} % in ${percents[1]?.label} und zu ${percents[2]?.pct} % in ${percents[2]?.label}.`;
  }
  return `Liegt zu ${percents[0]?.pct} % in ${percents[0]?.label}, zu ${percents[1]?.pct} % in ${percents[1]?.label}, zu ${percents[2]?.pct} % in ${percents[2]?.label} und weiteren.`;
}

/** Full overlap list for Details: `[Name]: [x] %`. Empty when there is no sentence. */
export function overlapDetailLines(overlaps: Recommendation["overlaps"] | undefined): string[] {
  if (!SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT) return [];
  return visibleOverlaps(overlaps).map((entry) => `${entry.label}: ${wholePercent(entry.share)} %`);
}

/** Map hover/tap hint: Rang, Name, Badge, same Lage-Satz. No extra percent labels. */
export function hitMapHint(item: Recommendation): string {
  const name = hitName(item);
  const badge = hitBadge(item);
  const lage = overlapLageSentence(item.overlaps);
  return [`Rang ${item.rank}`, name, badge, lage].filter((part): part is string => Boolean(part)).join(", ");
}

export function visibleOverlaps(overlaps: readonly RecommendationOverlap[] | undefined | null): { label: string; share: number }[] {
  if (!Array.isArray(overlaps) || overlaps.length === 0) return [];
  return overlaps
    .map((part) => {
      const label = typeof part.label === "string" ? part.label.trim() : "";
      if (!label || isCatalogKey(label)) return null;
      if (typeof part.share !== "number" || !Number.isFinite(part.share)) return null;
      return { label, share: part.share };
    })
    .filter((row): row is { label: string; share: number } => row != null)
    .sort((left, right) => right.share - left.share);
}

export function wholePercent(share: number): number {
  return Math.round(share * 100);
}

function unnamedKind(item: Recommendation): string {
  const blob = hitBlob(item);
  if (isRasterHit(item, blob)) return RASTER_NAME;
  if (item.kind === "address" || item.grain === "address" || item.location.grain === "address") {
    return "Adresse ohne Hausnummer";
  }
  // Berlin LOR: never the eight-digit PLR number, even from lor:plr:*.
  if (isLorHit(item, blob)) return PLANUNGSRAUM_OHNE_NAMEN;
  if (isKoelnQuartierHit(item, blob) || item.kind === "quartier") return "Quartier ohne Namen";
  if (item.kind === "ortsteil") return "Ortsteil ohne Namen";
  if (item.kind === "stadtteil") return "Stadtteil ohne Namen";
  if (item.kind === "plz" || item.grain === "plz5" || item.grain === "plz8" || item.location.grain === "plz5" || item.location.grain === "plz8") {
    return "PLZ ohne Namen";
  }
  if (item.kind === "bezirk") return "Bezirk ohne Namen";
  if (item.kind === "stadtbezirk") return "Stadtbezirk ohne Namen";
  if (item.kind === "gemeinde") return "Gemeinde ohne Namen";
  return "";
}

function isRasterHit(item: Recommendation, blob: string): boolean {
  return item.kind === "grid100" || item.grain === "grid100" || item.location.grain === "grid100" || /grid100/i.test(blob);
}

function isLorHit(item: Recommendation, blob: string): boolean {
  return /lor:plr:/i.test(blob) || item.kind === "lor" || /lor:/i.test(blob);
}

function isKoelnQuartierHit(item: Recommendation, blob: string): boolean {
  return KOELN_SQ.test(blob) || item.kind === "quartier";
}

function isRasterFallbackName(value: string): boolean {
  return RASTER_ID_NAME.test(value) || INSPIRE_CELL.test(value);
}

function nameHasForbiddenId(value: string): boolean {
  if (isCatalogKey(value) || FORBIDDEN_ID.test(value) || INSPIRE_CELL.test(value)) return true;
  if (RASTER_ID_NAME.test(value)) return true;
  return false;
}

function locationKey(item: Recommendation): string | null {
  const geoKey = item.location.geoKey;
  return typeof geoKey === "string" && geoKey.length > 0 ? geoKey : null;
}

function hitBlob(item: Recommendation): string {
  return [item.id, locationKey(item), item.grain ?? item.location.grain].filter((part): part is string => Boolean(part)).join(" ");
}

function visiblePlaceText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || isCatalogKey(trimmed)) return "";
  return trimmed;
}
