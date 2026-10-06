/**
 * Same Zielregion key as the backend (`resolveTargetRegionKey` / `targetRegionKeyOf`):
 * `geoKey` → `ags:{ags}` → `label:{normalized label}`.
 * Used to match `items[].targetRegionGeoKey` when the marked region has no geoKey.
 */

import { catalogKeyVariants, samePlace, type PlaceRef } from "../locations/regions.ts";

export type TargetRegionKeySource = "geoKey" | "ags" | "label";

export interface TargetRegionKeyInput {
  geoKey?: string | null;
  ags?: string | null | unknown;
  label?: string | null;
}

export interface ResolvedTargetRegionKey {
  key: string;
  source: TargetRegionKeySource;
}

/** Trim, collapse whitespace, lowercase — used in `label:{…}` fallback keys. */
export function normalizeTargetRegionLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}

/**
 * Contract key for a Zielregion: `geoKey` → `ags:{ags}` → `label:{normalized label}`.
 * Always returns a key so a missing geoKey does not empty the filter.
 */
export function resolveTargetRegionKey(region: TargetRegionKeyInput): ResolvedTargetRegionKey {
  const geoKey = region.geoKey?.trim();
  if (geoKey) return { key: geoKey, source: "geoKey" };
  const ags = typeof region.ags === "string" ? region.ags.trim() : "";
  if (ags) return { key: `ags:${ags}`, source: "ags" };
  return { key: `label:${normalizeTargetRegionLabel(region.label ?? "")}`, source: "label" };
}

export function targetRegionKeyOf(region: TargetRegionKeyInput): string {
  return resolveTargetRegionKey(region).key;
}

export function itemTargetRegionKey(item: { targetRegionGeoKey?: string | null }): string | null {
  if (typeof item.targetRegionGeoKey !== "string") return null;
  const trimmed = item.targetRegionGeoKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function itemMatchesMarkedRegion(
  item: { targetRegionGeoKey?: string | null },
  marked: TargetRegionKeyInput | null | undefined,
): boolean {
  const itemKey = itemTargetRegionKey(item);
  if (!itemKey || !marked) return false;
  return itemKey === targetRegionKeyOf(marked);
}

/**
 * Last `:` segment of a catalog key (`ortsteil:osm:162894` → `162894`).
 * STAGE `targetRegions[].geoKey` may store that OSM id without the prefix.
 */
export function catalogIdTail(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  const tail = parts[parts.length - 1]?.trim() ?? "";
  return tail.length > 0 ? tail : null;
}

/**
 * Whether `geoKey` (run snapshot, set `targetRegions[].geoKey`) is the marked
 * Zielregion. Uses `samePlace` / catalog variants / `targetRegionKeyOf`, plus
 * a suffix match for `ortsteil:osm:162894` vs `162894`. Does not treat a
 * parent AGS as the same place as a finer catalog key.
 */
export function geoKeyCoversMarkedRegion(
  geoKey: string | null | undefined,
  marked: TargetRegionKeyInput | null | undefined,
): boolean {
  if (!marked) return false;
  const raw = typeof geoKey === "string" ? geoKey.trim() : "";
  if (!raw) return false;
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .some((token) => tokenCoversMarkedRegion(token, marked));
}

function tokenCoversMarkedRegion(token: string, marked: TargetRegionKeyInput): boolean {
  const markedKey = targetRegionKeyOf(marked);
  if (!markedKey) return false;
  if (token === markedKey) return true;
  if (samePlace({ geoKey: token }, { geoKey: marked.geoKey ?? markedKey })) return true;

  const left = new Set(catalogKeyVariants(token));
  for (const variant of catalogKeyVariants(markedKey)) {
    if (left.has(variant)) return true;
  }

  const leftTail = catalogIdTail(token);
  const rightTail = catalogIdTail(markedKey);
  if (!leftTail || leftTail !== rightTail) return false;
  // `ags:11000000` is not Tempelhof even if some other key shares a numeric tail.
  const leftAgs = /^ags:/i.test(token);
  const rightAgs = /^ags:/i.test(markedKey);
  return leftAgs === rightAgs;
}

export function placeCoversMarkedRegion(
  place: (PlaceRef & TargetRegionKeyInput) | null | undefined,
  marked: (PlaceRef & TargetRegionKeyInput) | null | undefined,
): boolean {
  if (!place || !marked) return false;
  if (samePlace(place, marked)) return true;
  if (geoKeyCoversMarkedRegion(place.geoKey, marked)) return true;
  return targetRegionKeyOf(place) === targetRegionKeyOf(marked);
}

/** Stored set lists the marked Zielregion in `targetRegions[].geoKey`. */
export function recommendationSetCoversMarkedRegion(
  set: { targetRegions?: Array<{ geoKey: string }> | null } | null | undefined,
  marked: TargetRegionKeyInput | null | undefined,
): boolean {
  if (!set || !marked) return false;
  const listed = set.targetRegions;
  if (!Array.isArray(listed) || listed.length === 0) return false;
  return listed.some((region) => geoKeyCoversMarkedRegion(region.geoKey, marked));
}

/** Every item is missing `targetRegionGeoKey` or it is `""` — stored pre-0.19.2 set. */
export function isLegacyTargetRegionSet(items: readonly { targetRegionGeoKey?: string | null }[]): boolean {
  if (items.length === 0) return false;
  return items.every((item) => itemTargetRegionKey(item) == null);
}
