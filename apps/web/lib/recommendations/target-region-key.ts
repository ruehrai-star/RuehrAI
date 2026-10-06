/**
 * Same Zielregion key as the backend (`resolveTargetRegionKey` / `targetRegionKeyOf`):
 * `geoKey` → `ags:{ags}` → `label:{normalized label}`.
 * Used to match `items[].targetRegionGeoKey` when the marked region has no geoKey.
 */

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

/** Every item is missing `targetRegionGeoKey` or it is `""` — stored pre-0.19.2 set. */
export function isLegacyTargetRegionSet(items: readonly { targetRegionGeoKey?: string | null }[]): boolean {
  if (items.length === 0) return false;
  return items.every((item) => itemTargetRegionKey(item) == null);
}
