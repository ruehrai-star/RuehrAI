import { canonicalizePlaceKey, regionalstatistikBerlinBezirkAgs } from "../geo/bezirk-ags";
import { isCatalogLevel } from "../geo/geo-catalog";
import { AnalysisInput, AnalysisPatternRegion, AnalysisRegion, analysisRegions } from "./types";
import { YearlySeries } from "./yearly-series";

/**
 * Equivalent catalog keys for matching a Zielregion on a run snapshot.
 * Includes the Berlin Bezirk alias rewrite used on target-region add/remove.
 */
export function matchingGeoKeys(geoKey: string): string[] {
  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    keys.add(value);
    const canonical = canonicalizePlaceKey(value);
    if (canonical) keys.add(canonical);
  };

  add(geoKey.trim());
  for (const key of [...keys]) {
    if (key.startsWith("ags:")) add(key.slice(4));
    else if (/^[0-9]{2,8}$/.test(key)) add(`ags:${key}`);
  }
  for (const key of [...keys]) {
    const bare = key.startsWith("ags:") ? key.slice(4) : key;
    const regional = regionalstatistikBerlinBezirkAgs(bare);
    if (regional) {
      add(regional);
      add(`ags:${regional}`);
    }
  }
  return [...keys];
}

export function placeKeysMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return false;
  const other = new Set(matchingGeoKeys(right));
  return matchingGeoKeys(left).some((key) => other.has(key));
}

export function findSnapshotRegion(
  input: AnalysisInput | undefined,
  geoKey?: string,
): AnalysisRegion | undefined {
  if (!input) return undefined;
  const regions = analysisRegions(input);
  if (!geoKey) return input.region ?? regions[0];
  return (
    regions.find((region) => placeKeysMatch(region.geoKey, geoKey)) ??
    (input.region && placeKeysMatch(input.region.geoKey, geoKey) ? input.region : undefined)
  );
}

export function filterYearlySeries(
  series: YearlySeries[] | undefined,
  geoKey: string,
): YearlySeries[] {
  return (series ?? []).filter((row) => placeKeysMatch(row.requestedGeoKey, geoKey));
}

export function toPatternRegion(region: AnalysisRegion): AnalysisPatternRegion {
  return {
    label: region.label,
    geoKey: region.geoKey,
    level: isCatalogLevel(region.level) ? region.level : null,
    parentLabel: region.parentLabel ?? null,
    grain: region.grain,
  };
}
