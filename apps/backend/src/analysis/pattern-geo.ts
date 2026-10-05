import { compactMetricKey } from "./count-metrics";
import { matchingGeoKeys } from "./region-match";
import { AnalysisInput, AnalysisRegion, BrainFact, analysisRegions } from "./types";
import {
  SeriesLevel,
  keysForResolvedPlace,
  kreisAgsFrom,
  kreisAgsKey,
  municipalityAgsFrom,
  parentsFromGemeinde,
  requestedGeoKeyOf,
  requestedLevelOf,
} from "./yearly-series";

export type FactGeoTier = "requested" | "gemeinde" | "kreis" | "land";

export interface FactGeoMatch {
  tier: FactGeoTier;
  sourceLevel: SeriesLevel;
  requestedLevel: SeriesLevel | null;
}

interface RegionScope {
  requestedLevel: SeriesLevel | null;
  requested: Set<string>;
  gemeinde: Set<string>;
  kreis: Set<string>;
  land: Set<string>;
}

const TIER_RANK: Record<FactGeoTier, number> = {
  requested: 0,
  gemeinde: 1,
  kreis: 2,
  land: 3,
};

const POPULATION_KEYS = new Set([
  "ewz",
  "einwohner",
  "einwohnerzahl",
  "einw",
  "bev_insgesamt",
  "bevoelkerung",
]);

/** Facts whose geoKey belongs to the Zielregion AGS hierarchy — never sibling cities. */
export function factsMatchingTargetRegion(input: AnalysisInput, facts: BrainFact[]): BrainFact[] {
  const regions = analysisRegions(input);
  return facts.filter((fact) => classifyFactGeo(fact, regions) !== null);
}

export function classifyFactGeo(
  fact: Pick<BrainFact, "geoKey" | "grain">,
  regions: AnalysisRegion[],
): FactGeoMatch | null {
  let best: FactGeoMatch | null = null;
  for (const region of regions) {
    const match = classifyAgainst(fact, region);
    if (!match) continue;
    if (!best || TIER_RANK[match.tier] < TIER_RANK[best.tier]) best = match;
  }
  return best;
}

export function isPopulationMetricKey(key: string): boolean {
  return POPULATION_KEYS.has(compactMetricKey(key));
}

export function isDestatisBevInsgesamt(key: string, sourceTheme: string | null): boolean {
  return compactMetricKey(key) === "bev_insgesamt" && isDestatisTheme(sourceTheme);
}

export function isDestatisAgs5Fact(fact: Pick<BrainFact, "geoKey" | "grain">): boolean {
  if (fact.grain === "ags5") return true;
  return kreisAgsKey(stripPrefixedKey(fact.geoKey)) != null;
}

export function isHigherAdminLevel(match: FactGeoMatch): boolean {
  if (!match.requestedLevel) return false;
  return levelRank(match.sourceLevel) > levelRank(match.requestedLevel);
}

export function higherAdminNoun(match: FactGeoMatch): "Kreis" | "Land" | "Gemeinde" | null {
  if (!isHigherAdminLevel(match)) return null;
  if (match.sourceLevel === "kreis") return "Kreis";
  if (match.sourceLevel === "land") return "Land";
  if (match.sourceLevel === "gemeinde") return "Gemeinde";
  return null;
}

export function tierRank(tier: FactGeoTier): number {
  return TIER_RANK[tier];
}

function classifyAgainst(
  fact: Pick<BrainFact, "geoKey" | "grain">,
  region: AnalysisRegion,
): FactGeoMatch | null {
  const geoKey = fact.geoKey?.trim() ?? "";
  if (!geoKey) return null;
  const scope = scopeOf(region);
  if (hits(geoKey, scope.requested)) return makeMatch("requested", region);
  if (hits(geoKey, scope.gemeinde)) return makeMatch("gemeinde", region);
  if (hits(geoKey, scope.kreis)) return makeMatch("kreis", region);
  if (hits(geoKey, scope.land)) return makeMatch("land", region);
  return null;
}

function makeMatch(tier: FactGeoTier, region: AnalysisRegion): FactGeoMatch {
  const requestedLevel = requestedLevelOf(region);
  return {
    tier,
    requestedLevel,
    sourceLevel: sourceLevelFor(tier, requestedLevel),
  };
}

function sourceLevelFor(tier: FactGeoTier, requestedLevel: SeriesLevel | null): SeriesLevel {
  if (tier === "gemeinde") return "gemeinde";
  if (tier === "kreis") return "kreis";
  if (tier === "land") return "land";
  return requestedLevel ?? "gemeinde";
}

function scopeOf(region: AnalysisRegion): RegionScope {
  const requestedLevel = requestedLevelOf(region);
  const requestedGeoKey = requestedGeoKeyOf(region);
  const gemeindeAgs = municipalityAgsFrom(region);
  const kreisAgs = kreisAgsFrom(region);
  const landAgs = kreisAgs
    ? parentsFromGemeinde(kreisAgs).land
    : gemeindeAgs
      ? parentsFromGemeinde(gemeindeAgs).land
      : null;

  if (!requestedLevel || !requestedGeoKey) {
    return {
      requestedLevel,
      requested: expandKeys([region.geoKey, region.ags, region.plz]),
      gemeinde: expandKeys([gemeindeAgs]),
      kreis: expandKeys([kreisAgs, kreisAgs && kreisAgs.length === 5 ? `${kreisAgs}000` : null]),
      land: expandKeys([landAgs, landAgs ? `land:${landAgs}` : null]),
    };
  }

  const keys = keysForResolvedPlace(requestedLevel, requestedGeoKey, gemeindeAgs, kreisAgs, landAgs, {
    plz: region.plz,
  });
  return {
    requestedLevel,
    requested: expandKeys([...keys.requested, ...keys.plz, ...keys.bezirk, region.geoKey, region.ags, region.plz]),
    gemeinde: expandKeys(keys.gemeinde),
    kreis: expandKeys(keys.kreis),
    land: expandKeys(keys.land),
  };
}

function hits(geoKey: string, keys: Set<string>): boolean {
  if (keys.size === 0) return false;
  for (const candidate of expandKeys([geoKey])) {
    if (keys.has(candidate)) return true;
  }
  return false;
}

function expandKeys(values: Array<string | null | undefined>): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    for (const variant of matchingGeoKeys(trimmed)) {
      keys.add(variant);
      const stripped = stripPrefixedKey(variant);
      if (stripped) keys.add(stripped);
    }
    const stripped = stripPrefixedKey(trimmed);
    if (stripped && stripped !== trimmed) {
      for (const variant of matchingGeoKeys(stripped)) {
        keys.add(variant);
        keys.add(stripPrefixedKey(variant));
      }
    }
  }
  return keys;
}

function stripPrefixedKey(value: string): string {
  const match = /^(?:ags|ags5|land|plz5|plz8|stadtteil|ortsteil|stadtbezirk|bezirk):(.+)$/i.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function isDestatisTheme(theme: string | null): boolean {
  if (!theme) return false;
  return theme.trim().toLowerCase() === "destatis";
}

function levelRank(level: SeriesLevel): number {
  if (level === "ortsteil" || level === "stadtteil" || level === "plz") return 0;
  if (level === "bezirk" || level === "stadtbezirk") return 1;
  if (level === "gemeinde") return 2;
  if (level === "kreis") return 3;
  if (level === "land") return 4;
  return 2;
}
