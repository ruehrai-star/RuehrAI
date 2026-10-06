import { emptyToNull } from "../customer/values";
import {
  CatalogLevel,
  applyAdminCatalogDisplay,
  catalogLevelForPlace,
  isGeoCatalogLevel,
  officialAgsKey,
  parentMunicipalityAgs,
} from "./geo-catalog";

export interface CatalogDisplayQuery {
  geoKey?: string;
  ags?: string;
  plz?: string;
}

export interface CatalogDisplayHit {
  label?: string | null;
  level?: CatalogLevel | null;
  parentLabel?: string | null;
  geoAgs?: string | null;
}

export interface CatalogDisplayPlace {
  grain?: string | null;
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
 * A municipality without a catalog level is `gemeinde`. Bezirk / Stadtbezirk /
 * Stadtteil / Ortsteil get the Gemeinde name from catalog, `geo_ref_admin`,
 * or the AGS-prefix fallbacks Berlin / München / Hamburg / Köln.
 */
export async function fillMissingCatalogDisplay<T extends CatalogDisplayPlace>(
  region: T,
  search: (query: CatalogDisplayQuery) => Promise<CatalogDisplayHit[]>,
  lookupAdmin?: (keys: string[]) => Promise<Map<string, string | null>>,
): Promise<T> {
  if (isGeoCatalogLevel(region.level) && region.parentLabel != null) return region;
  const query = catalogPlaceQuery(region);
  const hit = query ? (await search(query))[0] : undefined;
  const fromCatalog = isGeoCatalogLevel(region.level)
    ? region.level
    : isGeoCatalogLevel(hit?.level)
      ? hit.level
      : null;
  let parentLabel = region.parentLabel ?? emptyToNull(hit?.parentLabel);
  let level = fromCatalog ?? catalogLevelForPlace(region);
  const key = officialAgsKey(region.geoKey) ?? officialAgsKey(region.ags);
  const parentKey = parentMunicipalityAgs(key);
  const adminKeys = [key, parentKey].filter((value): value is string => Boolean(value));
  const admin = lookupAdmin && adminKeys.length > 0 ? await lookupAdmin(adminKeys) : new Map();
  const applied = applyAdminCatalogDisplay({ ...region, level, parentLabel }, admin);
  level = fromCatalog ?? applied.level;
  parentLabel = parentLabel ?? applied.parentLabel;
  if (level === "stadtbezirk" && !parentLabel && parentKey) {
    const parentHits = await search({ ags: parentKey });
    parentLabel = emptyToNull(parentHits.find((row) => row.parentLabel)?.parentLabel);
  }
  return {
    ...region,
    level,
    parentLabel,
  };
}
