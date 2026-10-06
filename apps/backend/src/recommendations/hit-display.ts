import { AnalysisRegion } from "../analysis/types";
import { emptyToNull } from "../customer/values";
import { AreaCandidate, AreaKind, areaKindRank, isAreaKind } from "./area-candidates";

/** Catalog ids such as `plz5:12247` or `ortsteil:osm:5712247`. Never visible copy. */
const CATALOG_KEY =
  /^(?:ags|ags5|plz5|plz8|bezirk|stadtbezirk|stadtteil|ortsteil|lor:plr|lor|koeln:sq|quartier|hamburg_stadtteil|address|grid100)(?::\S+)+$/i;

export function isHiddenCatalogKey(value: string | null | undefined): boolean {
  if (!value) return false;
  return CATALOG_KEY.test(value.trim());
}

/** Display name only. Empty and catalog keys become null (liegt nicht vor). */
export function visibleAreaName(value: string | null | undefined): string | null {
  const trimmed = emptyToNull(value);
  if (!trimmed || isHiddenCatalogKey(trimmed)) return null;
  return trimmed;
}

/**
 * Parent area display name (Ortsteil → Bezirk). Prefers the finest coarser
 * candidate in the same municipality group, then the Zielregion label when
 * that region is coarser than the hit. Never a key.
 */
export function hitParentLabel(
  hit: AreaCandidate,
  pool: AreaCandidate[],
  regions: AnalysisRegion[],
  byGroup?: Map<string, AreaCandidate[]>,
): string | null {
  const fromPool = nearestCoarserName(hit, pool, byGroup);
  if (fromPool) return fromPool;
  const region = matchingParentRegion(hit, regions);
  if (!region) return null;
  const regionKind = kindOfRegion(region);
  const regionName = visibleAreaName(region.label);
  if (regionName && regionKind && areaKindRank(regionKind) > areaKindRank(hit.kind)) {
    return regionName;
  }
  return visibleAreaName(region.parentLabel);
}

export function areaGroupKey(item: { geoKey?: string | null; ags?: string | null; plz?: string | null }): string {
  const ags = item.ags?.trim() ?? "";
  if (ags.length >= 5) return `ags:${ags.slice(0, 5)}`;
  const plz = item.plz?.trim() ?? "";
  if (plz) return `plz:${plz}`;
  return `key:${item.geoKey?.trim() ?? ""}`;
}

function nearestCoarserName(
  hit: AreaCandidate,
  pool: AreaCandidate[],
  byGroup?: Map<string, AreaCandidate[]>,
): string | null {
  const group = byGroup?.get(areaGroupKey(hit)) ?? pool.filter((candidate) => areaGroupKey(candidate) === areaGroupKey(hit));
  let bestRank = Infinity;
  let bestName: string | null = null;
  for (const candidate of group) {
    if (candidate.geoKey === hit.geoKey) continue;
    const rank = areaKindRank(candidate.kind);
    if (rank <= areaKindRank(hit.kind)) continue;
    const name = visibleAreaName(candidate.name) ?? visibleAreaName(candidate.title);
    if (!name) continue;
    if (rank < bestRank) {
      bestRank = rank;
      bestName = name;
    }
  }
  return bestName;
}

function matchingParentRegion(hit: AreaCandidate, regions: AnalysisRegion[]): AnalysisRegion | undefined {
  const group = areaGroupKey(hit);
  return (
    regions.find((region) => areaGroupKey(region) === group) ??
    regions.find((region) => {
      const geoKey = region.geoKey?.trim();
      return Boolean(geoKey && (geoKey === hit.geoKey || geoKey === hit.ags || region.ags === hit.ags));
    })
  );
}

function kindOfRegion(region: AnalysisRegion): AreaKind | null {
  if (isAreaKind(region.level)) return region.level;
  if (region.grain === "plz5" || region.grain === "plz8") return "plz";
  if (region.grain === "ags") return "gemeinde";
  return null;
}
