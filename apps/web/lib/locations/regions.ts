import type { SearchHit, TargetRegion } from "../api/types.ts";
import { catalogPlaceName, visibleSavedRegions } from "../format.ts";
import { catalogIdForSave } from "./model.ts";

/** User-visible copy for the Zielregionen list. */
export const REGION_LIST_COPY = {
  heading: "Zielregionen",
  empty: "Noch keine Zielregionen.",
  searchPlaceholder: "Zielregion suchen",
  noHits: "Keine passende Zielregion.",
  added: "Hinzugefügt",
  add: "Hinzufügen",
  remove: "Entfernen",
  missingArea: "Zielregion ist gesetzt. Die Fläche kann noch nicht gezeichnet werden.",
  verlauf: "Verlauf",
} as const;

export interface PlaceRef {
  id?: string | null;
  geoKey?: string | null;
  label?: string | null;
  updatedAt?: string | null;
}

/**
 * Stable list identity. Prefer the stored catalog key so add/remove and the
 * outline stay attached to the same row. The key is never shown.
 */
export function regionListKey(item: PlaceRef): string {
  const geoKey = trimText(item.geoKey);
  if (geoKey) return geoKey;
  const label = trimText(item.label) ?? "";
  const updatedAt = trimText(item.updatedAt) ?? "";
  return `label:${label}:${updatedAt}`;
}

export function catalogKeyVariants(value: string | null | undefined): string[] {
  const trimmed = trimText(value);
  if (!trimmed) return [];
  const variants = [trimmed];
  const bare = bareCatalogKey(trimmed);
  if (bare && bare !== trimmed) variants.push(bare);
  const prefixed = /^(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):(.+)$/i.exec(trimmed);
  if (!prefixed && /^[0-9]{2,8}$/.test(trimmed)) {
    variants.push(`ags:${trimmed}`);
  }
  if (!prefixed && /^[0-9]{5}([0-9]{3})?$/.test(trimmed)) {
    variants.push(`plz5:${trimmed}`);
  }
  return variants;
}

export function placeKeySet(item: PlaceRef & { id?: string | null }): Set<string> {
  const keys = new Set<string>();
  for (const raw of [item.geoKey, item.id]) {
    for (const variant of catalogKeyVariants(raw)) keys.add(variant);
  }
  return keys;
}

export function samePlace(left: PlaceRef & { id?: string | null }, right: PlaceRef & { id?: string | null }): boolean {
  const other = placeKeySet(right);
  for (const key of placeKeySet(left)) {
    if (other.has(key)) return true;
  }
  return false;
}

export function isHitInList(hit: SearchHit, items: readonly TargetRegion[]): boolean {
  const hitRef = { id: hit.id, geoKey: catalogIdForSave(hit) ?? hit.geoKey };
  return items.some((item) => samePlace(item, hitRef));
}

/** Newest add first. A second add of the same key does not insert another row. */
export function addRegionToFront(items: readonly TargetRegion[], added: TargetRegion): TargetRegion[] {
  if (catalogPlaceName(added) === null) return visibleSavedRegions(items);
  return visibleSavedRegions([added, ...items.filter((item) => !samePlace(item, added))]);
}

export function removeRegion(items: readonly TargetRegion[], key: string): TargetRegion[] {
  return items.filter((item) => regionListKey(item) !== key && !catalogKeyVariants(item.geoKey).includes(key));
}

/**
 * Empty list: mark the added row. A list that already had a mark keeps it.
 */
export function nextMarkedKeyAfterAdd(
  items: readonly TargetRegion[],
  added: TargetRegion,
  markedKey: string | null,
): string {
  if (items.length === 0 || !markedKey) return regionListKey(added);
  if (items.some((item) => regionListKey(item) === markedKey)) return markedKey;
  return regionListKey(added);
}

/**
 * Marked row removed: mark the row below, otherwise the row above.
 * An unmarked removal leaves the current mark in place.
 */
export function nextMarkedKeyAfterRemove(
  items: readonly TargetRegion[],
  removedKey: string,
  markedKey: string | null,
): string | null {
  const index = items.findIndex(
    (item) => regionListKey(item) === removedKey || catalogKeyVariants(item.geoKey).includes(removedKey),
  );
  if (index < 0) return markedKey;

  const remaining = items.filter((_, current) => current !== index);
  if (remaining.length === 0) return null;

  const removedWasMarked =
    markedKey != null &&
    (markedKey === removedKey ||
      regionListKey(items[index] as TargetRegion) === markedKey ||
      catalogKeyVariants(items[index]?.geoKey).includes(markedKey));

  if (!removedWasMarked && markedKey && remaining.some((item) => regionListKey(item) === markedKey)) {
    return markedKey;
  }
  if (!removedWasMarked) {
    return ensureMarkedKey(remaining, markedKey);
  }

  const below = items[index + 1];
  if (below) return regionListKey(below);
  const above = items[index - 1];
  return above ? regionListKey(above) : null;
}

/** Exactly one row is marked whenever the list is not empty. */
export function ensureMarkedKey(items: readonly TargetRegion[], markedKey: string | null): string | null {
  if (items.length === 0) return null;
  const match =
    markedKey == null
      ? undefined
      : items.find((item) => regionListKey(item) === markedKey || catalogKeyVariants(item.geoKey).includes(markedKey));
  return regionListKey(match ?? (items[0] as TargetRegion));
}

/** The marked Zielregion row, or null when the list is empty. */
export function markedRegion(items: readonly TargetRegion[], markedKey: string | null): TargetRegion | null {
  const key = ensureMarkedKey(items, markedKey);
  if (!key) return null;
  return items.find((item) => regionListKey(item) === key || catalogKeyVariants(item.geoKey).includes(key)) ?? null;
}

function trimText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function bareCatalogKey(value: string): string {
  const prefixed = /^(?:ags|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil):(.+)$/i.exec(value);
  return prefixed?.[1] ?? value;
}
