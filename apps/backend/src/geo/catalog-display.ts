import { emptyToNull } from "../customer/values";
import { CatalogLevel } from "./geo-catalog";

export interface CatalogDisplayQuery {
  geoKey?: string;
  ags?: string;
  plz?: string;
}

export interface CatalogDisplayHit {
  label?: string | null;
  level?: CatalogLevel | null;
  parentLabel?: string | null;
}

export interface CatalogDisplayPlace {
  geoKey: string | null;
  ags: string | null;
  plz: string | null;
  level?: CatalogLevel | string | null;
  parentLabel?: string | null;
}

/**
 * Exact catalog lookup used by POST /target-region. Prefer the stored geo
 * key so a municipality AGS does not pick a child PLZ or Ortsteil.
 */
export function catalogPlaceQuery(input: {
  geoKey: string | null;
  ags: string | null;
  plz: string | null;
}): CatalogDisplayQuery | null {
  if (input.geoKey) return { geoKey: input.geoKey };
  if (input.ags) return { ags: input.ags };
  if (input.plz) return { plz: input.plz };
  return null;
}

/**
 * Fill missing `level` / `parentLabel` from the same catalog search POST uses.
 * Never invents a label. A municipality with no catalog parent stays empty.
 */
export async function fillMissingCatalogDisplay<T extends CatalogDisplayPlace>(
  region: T,
  search: (query: CatalogDisplayQuery) => Promise<CatalogDisplayHit[]>,
): Promise<T> {
  if (region.level != null && region.parentLabel != null) return region;
  const query = catalogPlaceQuery(region);
  if (!query) return region;
  const hit = (await search(query))[0];
  return {
    ...region,
    level: region.level ?? hit?.level ?? null,
    parentLabel: region.parentLabel ?? emptyToNull(hit?.parentLabel),
  };
}
