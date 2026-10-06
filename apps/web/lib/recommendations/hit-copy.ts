import type { AreaKind, Recommendation, RecommendationOverlap } from "../api/types.ts";
import { catalogBadge, grainLabel, isCatalogKey } from "../format.ts";

/**
 * Lage-Satz (UX v6 / OpenAPI 0.19.5) uses `overlaps[0].isTargetRegion`.
 * Older sets without that flag hide the sentence.
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
const NUMBERED_QUARTIER = /^Quartier \d+$/;
const KOELN_SQ = /koeln:sq:/i;
const PLANUNGSRAUM_OHNE_NAMEN = "Planungsraum ohne Namen";
const QUARTIER_OHNE_NAMEN = "Quartier ohne Namen";

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

export type DisplayNameSource = {
  name?: string | null;
  kind?: AreaKind | string | null;
  geoKey?: string | null;
  grain?: string | null;
  id?: string | null;
};

/**
 * Same mapping for Treffer names and overlap labels. Planungsraum in Berlin,
 * Quartier in Köln, raster always „100-m-Rasterzelle“. Unnamed shows only the
 * kind („Planungsraum ohne Namen“, „Quartier ohne Namen“). Never a number or
 * catalog key. Backend `Planungsraum [8-digit]` / `Quartier [Nummer]` match
 * `^Planungsraum \d{8}$` / `^Quartier \d+$`.
 */
export function mapDisplayName(source: DisplayNameSource): string {
  const blob = displayBlob(source);
  const kind = source.kind ?? null;
  const grain = source.grain ?? null;
  if (isRasterContext(kind, grain, blob)) return RASTER_NAME;
  const raw = visiblePlaceText(source.name);
  if (isRasterFallbackName(raw)) return RASTER_NAME;
  if (NUMBERED_PLANUNGSRAUM.test(raw)) return PLANUNGSRAUM_OHNE_NAMEN;
  if (NUMBERED_QUARTIER.test(raw)) return QUARTIER_OHNE_NAMEN;
  const plzCode = plzCodeFromLabel(raw);
  if (plzCode && isPlzContext(kind, grain, blob)) return `PLZ ${plzCode}`;
  if (raw && !nameHasForbiddenId(raw) && !isBareNumber(raw)) return raw;
  return unnamedFromContext(kind, grain, blob);
}

/**
 * Visible Treffer name from `name`. Never a geoKey or internal ID, including
 * inside the name. Raster is always „100-m-Rasterzelle“. Backend fallbacks
 * that still contain a forbidden ID are mapped here.
 */
export function hitName(item: Recommendation): string {
  const raw = visiblePlaceText(item.name) || visiblePlaceText(item.location.name) || visiblePlaceText(item.title);
  return mapDisplayName({
    name: raw,
    kind: item.kind,
    geoKey: locationKey(item),
    grain: item.grain ?? item.location.grain,
    id: item.id,
  });
}

export function overlapLageSentence(overlaps: Recommendation["overlaps"] | undefined): string | null {
  const entries = lageOverlapEntries(overlaps);
  if (!entries) return null;
  const first = entries[0];
  if (!first) return null;
  if (entries.length === 1 || wholePercent(first.share) === 100) return `Liegt in ${first.label}.`;
  const named = entries.slice(0, 3).map((entry) => ({ label: entry.label, pct: wholePercent(entry.share) }));
  if (named.length === 2) {
    return `Liegt zu ${named[0]?.pct} % in ${named[0]?.label} und zu ${named[1]?.pct} % in ${named[1]?.label}.`;
  }
  if (named.length === 3 && entries.length === 3) {
    return `Liegt zu ${named[0]?.pct} % in ${named[0]?.label}, zu ${named[1]?.pct} % in ${named[1]?.label} und zu ${named[2]?.pct} % in ${named[2]?.label}.`;
  }
  return `Liegt zu ${named[0]?.pct} % in ${named[0]?.label}, zu ${named[1]?.pct} % in ${named[1]?.label}, zu ${named[2]?.pct} % in ${named[2]?.label} und weiteren.`;
}

/** Map popup: same places as the Lage-Satz, never percentages. */
export function overlapLageMapHint(overlaps: Recommendation["overlaps"] | undefined): string | null {
  const entries = lageOverlapEntries(overlaps);
  if (!entries) return null;
  const first = entries[0];
  if (!first) return null;
  if (entries.length === 1 || wholePercent(first.share) === 100) return `Liegt in ${first.label}.`;
  const names = entries.slice(0, 3).map((entry) => entry.label);
  if (names.length === 2) return `Liegt in ${names[0]} und ${names[1]}.`;
  if (names.length === 3 && entries.length === 3) return `Liegt in ${names[0]}, ${names[1]} und ${names[2]}.`;
  return `Liegt in ${names[0]}, ${names[1]}, ${names[2]} und weiteren.`;
}

/** Full overlap list for Details: `[Name]: [x] %`. Empty when there is no sentence. */
export function overlapDetailLines(overlaps: Recommendation["overlaps"] | undefined): string[] {
  const entries = lageOverlapEntries(overlaps);
  if (!entries) return [];
  return entries.map((entry) => `${entry.label}: ${wholePercent(entry.share)} %`);
}

/** Map hover/tap hint: Rang, Name, Badge, Lage without percentages. */
export function hitMapHint(item: Recommendation): string {
  const name = hitName(item);
  const badge = hitBadge(item);
  const lage = overlapLageMapHint(item.overlaps);
  return [`Rang ${item.rank}`, name, badge, lage].filter((part): part is string => Boolean(part)).join(", ");
}

export function visibleOverlaps(overlaps: readonly RecommendationOverlap[] | undefined | null): { label: string; share: number }[] {
  return lageOverlapEntries(overlaps) ?? [];
}

/**
 * UX v6: first entry must be the Zielregion (`isTargetRegion: true`).
 * Keep backend order (Zielregion, then Ortsteile). Never show geoKey.
 */
function lageOverlapEntries(
  overlaps: readonly RecommendationOverlap[] | undefined | null,
): { label: string; share: number }[] | null {
  if (!Array.isArray(overlaps) || overlaps.length === 0) return null;
  const first = overlaps[0];
  if (!first || first.isTargetRegion !== true) return null;
  const firstLabel = overlapDisplayLabel(first);
  if (!firstLabel || typeof first.share !== "number" || !Number.isFinite(first.share)) return null;
  const entries: { label: string; share: number }[] = [];
  for (const part of overlaps) {
    if (typeof part.share !== "number" || !Number.isFinite(part.share)) continue;
    const label = overlapDisplayLabel(part);
    if (!label) continue;
    entries.push({ label, share: part.share });
  }
  if (entries.length === 0 || entries[0]?.label !== firstLabel) return null;
  return entries;
}

function overlapDisplayLabel(part: RecommendationOverlap): string {
  return mapDisplayName({
    name: typeof part.label === "string" ? part.label : "",
    kind: part.kind,
    geoKey: part.geoKey,
  });
}

export function wholePercent(share: number): number {
  return Math.round(share * 100);
}

function unnamedFromContext(kind: string | null, grain: string | null, blob: string): string {
  if (isRasterContext(kind, grain, blob)) return RASTER_NAME;
  if (kind === "address" || grain === "address") return "Adresse ohne Hausnummer";
  // Berlin LOR: never the eight-digit PLR number, even from lor:plr:*.
  if (isLorContext(kind, blob)) return PLANUNGSRAUM_OHNE_NAMEN;
  // Köln Quartier: never a number from koeln:sq:*.
  if (isKoelnQuartierContext(kind, blob)) return QUARTIER_OHNE_NAMEN;
  if (kind === "ortsteil") return "Ortsteil ohne Namen";
  if (kind === "stadtteil") return "Stadtteil ohne Namen";
  if (kind === "plz" || grain === "plz5" || grain === "plz8") return "PLZ ohne Namen";
  if (kind === "bezirk") return "Bezirk ohne Namen";
  if (kind === "stadtbezirk") return "Stadtbezirk ohne Namen";
  if (kind === "gemeinde") return "Gemeinde ohne Namen";
  return "";
}

function isRasterHit(item: Recommendation, blob: string): boolean {
  return isRasterContext(item.kind, item.grain ?? item.location.grain, blob);
}

function isRasterContext(kind: string | null | undefined, grain: string | null | undefined, blob: string): boolean {
  return kind === "grid100" || grain === "grid100" || /grid100/i.test(blob);
}

function isLorHit(item: Recommendation, blob: string): boolean {
  return isLorContext(item.kind, blob);
}

function isLorContext(kind: string | null | undefined, blob: string): boolean {
  return /lor:plr:/i.test(blob) || kind === "lor" || /lor:/i.test(blob);
}

function isKoelnQuartierHit(item: Recommendation, blob: string): boolean {
  return isKoelnQuartierContext(item.kind, blob);
}

function isKoelnQuartierContext(kind: string | null | undefined, blob: string): boolean {
  return KOELN_SQ.test(blob) || kind === "quartier";
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

function displayBlob(source: Pick<DisplayNameSource, "id" | "geoKey" | "grain">): string {
  return [source.id, source.geoKey, source.grain].filter((part): part is string => Boolean(part)).join(" ");
}

function isBareNumber(value: string): boolean {
  return /^\d+$/.test(value);
}

function isPlzContext(kind: string | null | undefined, grain: string | null | undefined, blob: string): boolean {
  return kind === "plz" || grain === "plz5" || grain === "plz8" || /plz5:|plz8:/i.test(blob);
}

/** Digits-only PLZ label (or already-prefixed „PLZ 12207“) — never „PLZ ohne Namen“. */
function plzCodeFromLabel(value: string): string | null {
  if (/^\d+$/.test(value)) return value;
  const prefixed = value.match(/^PLZ\s+(\d+)$/i);
  return prefixed?.[1] ?? null;
}

function visiblePlaceText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || isCatalogKey(trimmed)) return "";
  return trimmed;
}
