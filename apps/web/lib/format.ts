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
  gemeinde: "Gemeinde",
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
  const geoKey = source.geoKey || source.id || "";
  // Berlin LOR in search / Zielregion: same visible word as the Treffer badge.
  if (/^lor:/i.test(geoKey) || source.level === "lor") return "Planungsraum";
  if (/^koeln:sq:/i.test(geoKey) || source.level === "quartier" || source.level === "koeln_quartier") {
    return "Quartier";
  }
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
  const cleaned = visiblePlaceText(value);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * UX fallback when the backend sends no readable name.
 * Kind only — never a geoKey, PLR code, or Quartier number.
 */
export function unnamedPlaceLabel(source: {
  kind?: string | null;
  grain?: string | null;
  level?: unknown;
  id?: string | null;
  geoKey?: string | null;
}): string | null {
  const blob = [source.kind, source.grain, source.level, source.id, source.geoKey]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
  if (/lor:plr:/i.test(blob) || source.kind === "lor" || /(?:^|\s)lor(?:\s|$)/i.test(blob)) {
    return "Planungsraum ohne Namen";
  }
  if (/koeln:sq:/i.test(blob) || source.kind === "quartier" || source.level === "quartier") {
    return "Quartier ohne Namen";
  }
  if (source.kind === "grid100" || source.grain === "grid100") return "100-m-Rasterzelle";
  if (source.kind === "address" || source.grain === "address") return "Adresse ohne Hausnummer";
  if (
    source.kind === "ortsteil" ||
    source.kind === "stadtteil" ||
    source.level === "ortsteil" ||
    source.level === "stadtteil"
  ) {
    return "Ortsteil ohne Namen";
  }
  return null;
}

const CATALOG_KEY =
  /^(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|lor:plr|lor|koeln:sq|quartier|hamburg_stadtteil|other|address|grid100)(?::\S+)+$/i;

const INTERNAL_KEY_TOKEN =
  /(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|lor:plr|lor|koeln:sq|quartier|hamburg_stadtteil|other|address|grid100)(?::[^\s,;()]+)+/gi;

const COLON_TRIPLE_ID = /\b[a-z][a-z0-9_]*:[a-z][a-z0-9_]*:\d+\b/gi;

/** Patterns the UI must never render: `kind:ns:id`, `lor:plr:`, `koeln:sq:`, `stadtteil:osm:`. */
export const INTERNAL_KEY_SCAN =
  /(?:\b\w+:\w+:\d+\b|\blor:plr:|\bkoeln:sq:|\bstadtteil:osm:)/i;

/**
 * Internal catalog id such as `plz5:12247` or `ortsteil:osm:5712247`.
 * These keys are stored and sent on save; they are never visible copy.
 */
export function isCatalogKey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return CATALOG_KEY.test(trimmed) || /^(?:[a-z][a-z0-9_]*:[a-z][a-z0-9_]*:\d+)$/i.test(trimmed);
}

/**
 * Drop catalog keys and parenthesized ids from a user-visible string.
 * Does not invent a replacement name.
 */
export function stripInternalKeys(value: string, geoKey?: string | null): string {
  let next = value;
  next = next.replace(/\s*[\(（]\s*(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|lor:plr|lor|koeln:sq|quartier|hamburg_stadtteil|other|address|grid100)(?::[^\s,;()]+)+\s*[\)）]/gi, "");
  next = next.replace(INTERNAL_KEY_TOKEN, "");
  next = next.replace(COLON_TRIPLE_ID, "");
  next = next.replace(/\blor:plr:\S+/gi, "");
  next = next.replace(/\bkoeln:sq:\S+/gi, "");
  next = next.replace(/\bstadtteil:osm:\S+/gi, "");
  const tail = typeof geoKey === "string" ? geoKey.match(/(\d+)\s*$/)?.[1] : undefined;
  if (tail) {
    next = next.replace(new RegExp(`[\\(（]\\s*${tail}\\s*[\\)）]`), "");
  }
  return next.replace(/\s+/g, " ").replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").trim();
}

export function visiblePlaceText(value: string | null | undefined, geoKey?: string | null): string {
  if (typeof value !== "string") return "";
  const cleaned = stripInternalKeys(value, geoKey);
  if (!cleaned || isCatalogKey(cleaned) || INTERNAL_KEY_SCAN.test(cleaned)) return "";
  return cleaned;
}

export function containsInternalKey(value: string | null | undefined): boolean {
  return typeof value === "string" && INTERNAL_KEY_SCAN.test(value);
}

/**
 * Visible place name for a search or Zielregion hit.
 * Uses `label` only when it is a non-empty string and not a catalog key.
 */
export function catalogPlaceName(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const label = (source as { label?: unknown }).label;
  if (typeof label !== "string") return null;
  const geoKey =
    typeof (source as { geoKey?: unknown }).geoKey === "string"
      ? (source as { geoKey: string }).geoKey
      : typeof (source as { id?: unknown }).id === "string"
        ? (source as { id: string }).id
        : null;
  const cleaned = visiblePlaceText(label, geoKey);
  return cleaned.length > 0 ? cleaned : null;
}

/** Hits without a place name stay out of the Trefferliste. */
export function visibleSearchHits<T>(hits: readonly T[]): T[] {
  return hits.filter((hit) => catalogPlaceName(hit) !== null);
}

/** Saved Zielregion rows without a place name stay out of the list. */
export function visibleSavedRegions<T>(items: readonly T[]): T[] {
  return items.filter((item) => catalogPlaceName(item) !== null);
}

/**
 * Visible Zielregion copy: `[label] · [Ebene] · [parentLabel]`.
 * Bezirk, Stadtbezirk, Stadtteil and Ortsteil use `parentLabel` as the
 * Gemeinde. Drop the parent part when it is empty. Catalog keys stay hidden.
 */
export function catalogHitVisibleText(source: unknown): string {
  const name = catalogPlaceName(source);
  if (!name) return "";
  const parent = catalogParentName(source);
  const badge = catalogBadge(asBadgeSource(source));
  return [name, badge || null, parent].filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
}

function asBadgeSource(source: unknown): CatalogBadgeSource {
  if (!source || typeof source !== "object") return {};
  return source as CatalogBadgeSource;
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
