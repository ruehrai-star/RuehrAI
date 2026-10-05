import { PatternCriterion } from "./types";
import { criteriaFromYearlySeries, seriesLevelRank } from "./series-criteria";
import {
  SeriesRegionInput,
  YearlySeries,
  requestedGeoKeyOf,
  requestedLevelOf,
} from "./yearly-series";

/** Finest → coarse store-surroundings Ebenen. Kreis is Rahmen only. */
export const PATTERN_LEVELS = [
  "address",
  "grid100",
  "lor",
  "quartier",
  "ortsteil",
  "plz",
  "bezirk",
  "gemeinde",
  "kreis",
] as const;

export type PatternLevel = (typeof PATTERN_LEVELS)[number];
export type PatternLevelRole = "pattern" | "frame";

export interface PatternLevelProfile {
  level: PatternLevel;
  role: PatternLevelRole;
  geoKeys: string[];
  yearlySeries: YearlySeries[];
  criteria: PatternCriterion[];
}

const LEVEL_ALIASES: Record<string, PatternLevel> = {
  address: "address",
  grid100: "grid100",
  lor: "lor",
  quartier: "quartier",
  ortsteil: "ortsteil",
  stadtteil: "ortsteil",
  plz: "plz",
  bezirk: "bezirk",
  stadtbezirk: "bezirk",
  gemeinde: "gemeinde",
  kreis: "kreis",
};

export function canonicalPatternLevel(level: string | null | undefined): PatternLevel | null {
  if (!level) return null;
  return LEVEL_ALIASES[level] ?? null;
}

/**
 * Group store-surrounding series into one Musterprofil per Ebene.
 * Kreis stays `role: frame` and is not a differentiating pattern.
 */
export function buildPatternByLevel(
  regions: SeriesRegionInput[],
  series: YearlySeries[],
): PatternLevelProfile[] {
  const geoKeysByLevel = new Map<PatternLevel, string[]>();
  const seriesByLevel = new Map<PatternLevel, YearlySeries[]>();

  for (const region of regions) {
    const level = canonicalPatternLevel(requestedLevelOf(region) ?? region.level);
    if (!level) continue;
    const key = requestedGeoKeyOf(region);
    if (key) pushUnique(geoKeysByLevel, level, key);
  }

  for (const item of series) {
    const level = canonicalPatternLevel(item.requestedLevel);
    if (!level) continue;
    const list = seriesByLevel.get(level) ?? [];
    list.push(item);
    seriesByLevel.set(level, list);
    pushUnique(geoKeysByLevel, level, item.requestedGeoKey);
  }

  const profiles: PatternLevelProfile[] = [];
  for (const level of PATTERN_LEVELS) {
    const geoKeys = geoKeysByLevel.get(level) ?? [];
    const allSeries = seriesByLevel.get(level) ?? [];
    if (geoKeys.length === 0 && allSeries.length === 0) continue;
    const usable = allSeries.filter((item) => item.coverage !== "none");
    const role: PatternLevelRole = level === "kreis" ? "frame" : "pattern";
    profiles.push({
      level,
      role,
      geoKeys,
      yearlySeries: usable,
      criteria: criteriaFromYearlySeries(usable).map((criterion) => withScope(criterion, level)),
    });
  }
  return profiles;
}

/** Same-Ebene criteria. Missing profile or Kreis frame → empty (score 0). */
export function criteriaForPatternLevel(
  level: string | null | undefined,
  profiles: PatternLevelProfile[] | undefined,
  fallback: PatternCriterion[],
): PatternCriterion[] {
  if (!profiles) return fallback;
  const canonical = canonicalPatternLevel(level);
  if (!canonical) return [];
  const profile = profiles.find((item) => item.level === canonical);
  if (!profile || profile.role === "frame") return [];
  return profile.criteria;
}

/** Flattened `pattern.criteria` for older clients: non-Kreis Ebenen, finest source wins. */
export function flattenedPatternCriteria(profiles: PatternLevelProfile[]): PatternCriterion[] {
  return criteriaFromYearlySeries(
    profiles.filter((item) => item.role === "pattern").flatMap((item) => item.yearlySeries),
  );
}

function withScope(criterion: PatternCriterion, profileLevel: PatternLevel): PatternCriterion {
  const source = criterion.sourceLevel;
  const scope =
    source && seriesLevelRank(source) > seriesLevelRank(profileLevel) ? "inherited" : "local";
  return { ...criterion, scope };
}

function pushUnique(map: Map<PatternLevel, string[]>, level: PatternLevel, key: string): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  const list = map.get(level) ?? [];
  if (!list.includes(trimmed)) list.push(trimmed);
  map.set(level, list);
}
