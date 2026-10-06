import type { AnalysisInput, TargetRegion } from "@ruehrai/api-contracts";
import { catalogParentName, catalogPlaceName, visiblePlaceText } from "../format.ts";
import { samePlace, type PlaceRef } from "../locations/regions.ts";

export type RunRegionSource = PlaceRef & {
  label?: string | null;
  parentLabel?: string | null;
  level?: unknown;
  grain?: unknown;
  ags?: unknown;
};

export interface RunRegionLabelView {
  /** Collapsed line: one name, or `Name (Gemeinde) + N weitere`. */
  summary: string;
  /** Every visible entry, never a catalog key. */
  entries: string[];
  expandable: boolean;
}

/**
 * Fill a missing Gemeinde from another already-loaded row of the same place
 * (`GET /target-region`). Never invents a name and never copies a sibling's
 * parent onto a different geoKey.
 */
export function withCatalogParent(
  region: RunRegionSource | null | undefined,
  catalog?: readonly RunRegionSource[] | null,
): RunRegionSource | null {
  if (!region) return null;
  if (catalogParentName(region)) return region;
  const match = (catalog ?? []).find((item) => samePlace(item, region));
  const parent = catalogParentName(match);
  return parent ? { ...region, parentLabel: parent } : region;
}

/**
 * One Zielregion in a run label: `Name (Gemeinde)` from `parentLabel`,
 * or the name alone when there is no parent. Keys stay hidden.
 */
export function runRegionEntryLabel(
  region: RunRegionSource | null | undefined,
  catalog?: readonly RunRegionSource[] | null,
): string {
  const source = withCatalogParent(region, catalog);
  if (!source) return "";
  const name = catalogPlaceName(source) ?? visibleName(source.label);
  if (!name) return "";
  const parent = catalogParentName(source);
  return parent ? `${name} (${parent})` : name;
}

/** Snapshot list for a run: `input.regions` (newest first), else `[input.region]`. */
export function regionsFromRunInput(
  input: Pick<AnalysisInput, "region"> & { regions?: readonly TargetRegion[] | null },
): RunRegionSource[] {
  const listed = Array.isArray(input.regions) ? input.regions : [];
  const unique: RunRegionSource[] = [];
  for (const region of listed.length > 0 ? listed : [input.region]) {
    if (!region) continue;
    if (unique.some((existing) => samePlace(existing, region))) continue;
    unique.push(region);
  }
  return unique;
}

export function runRegionEntries(
  regions: readonly RunRegionSource[] | null | undefined,
  catalog?: readonly RunRegionSource[] | null,
): string[] {
  const entries: string[] = [];
  for (const region of regions ?? []) {
    const label = runRegionEntryLabel(region, catalog);
    if (!label || entries.includes(label)) continue;
    entries.push(label);
  }
  return entries;
}

/**
 * Run label for the Stand line (`Stand: Lauf vom … für …`) and the
 * Musteranalyse summary. Not the Trefferliste heading — that stays
 * singular for the currently marked Zielregion.
 * One region: the entry. Several: first + remaining count, with `entries` for the list.
 */
export function formatRunRegionLabel(
  regions: readonly RunRegionSource[] | null | undefined,
  catalog?: readonly RunRegionSource[] | null,
): RunRegionLabelView {
  const entries = runRegionEntries(regions, catalog);
  if (entries.length === 0) return { summary: "", entries, expandable: false };
  if (entries.length === 1) return { summary: entries[0] ?? "", entries, expandable: false };
  const rest = entries.length - 1;
  return {
    summary: `${entries[0]} + ${rest} weitere`,
    entries,
    expandable: true,
  };
}

function visibleName(value: string | null | undefined): string {
  return visiblePlaceText(value);
}
