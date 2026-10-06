import { Grain } from "../target-region/dto";
import { RegionGeometry } from "../geo/region-geometry";
import { PatternLevelProfile, PatternDatasetProfile } from "../analysis/pattern-profile";
import type { BaselineMethod } from "../analysis/area-baseline";
import { SeriesBaseline } from "../analysis/series-baseline";
import { AnalysisPattern, CriterionDirection, PatternSource } from "../analysis/types";
import { SeriesCoverage, SeriesPoint, SeriesPointStatus } from "../analysis/yearly-series";
import { AreaKind } from "./area-candidates";

export interface RecommendationWindow {
  from: string;
  to: string;
}


export interface RecommendationTrend {
  direction: CriterionDirection;
  summary: string;
}
export interface RecommendationLocation {
  geoKey: string;
  grain: Grain;
  lon: number | null;
  lat: number | null;
  name: string | null;
}

export interface RecommendationIntersectionPart {
  geoKey: string;
  grain: Grain;
  name: string | null;
  datasetKey?: string;
}

/** Spatial parent (Stadtbezirk/Bezirk) that a hit overlaps, with area share 0–1. */
export interface RecommendationOverlap {
  geoKey: string;
  label: string;
  kind: AreaKind;
  share: number;
}

export type EvidenceKind = "trend" | "stichtag" | "absent";
export type EvidenceScope = "local" | "inherited";

export interface RecommendationEvidence {
  key: string;
  label: string;
  direction: CriterionDirection;
  patternDirection: CriterionDirection;
  evidence: string;
  kind?: EvidenceKind;
  status?: SeriesPointStatus;
  match?: boolean;
  coverage?: SeriesCoverage;
  scope?: EvidenceScope;
  sourceLevel?: string;
  sourceGeoKey?: string;
  points?: SeriesPoint[];
  metricId?: string;
  baseline?: SeriesBaseline;
  rawValue?: number;
  normalizedValue?: number;
  baselineMethod?: BaselineMethod;
  /** Same Bezugsgröße as Muster patternByDataset for this metric. */
  baselineMatch?: boolean;
  /**
   * Closeness of this dataset to the store pattern on the baseline (0..1).
   * Omitted when the dataset is absent, inherited, or statistically neutral.
   * Additive; missing data is never stored as `0`.
   */
  proximity?: number;
}

export interface ScoredLocation {
  id: string;
  title: string;
  kind: AreaKind;
  grain: Grain;
  name: string;
  parentLabel: string | null;
  intersectionOf?: RecommendationIntersectionPart[];
  overlaps?: RecommendationOverlap[];
  /** Zielregion this hit was loaded for (`AnalysisRegion.geoKey`). */
  targetRegionGeoKey: string;
  /** Newest `criteriaEvidence.points[].period` used for this hit (`YYYY` or `YYYY-MM`). */
  dataAsOf: string | null;
  location: RecommendationLocation;
  score: number;
  criteriaEvidence: RecommendationEvidence[];
  geometry?: RegionGeometry | null;
  geometryUnavailableReason?: string | null;
  trend?: RecommendationTrend;
}

export interface RecommendationItem extends ScoredLocation {
  rank: number;
  rationale: string;
  source: PatternSource;
}

export interface RecommendationPayload {
  runId: string;
  window: RecommendationWindow;
  count: number;
  reason: string | null;
  pattern: AnalysisPattern;
  /** Store-surroundings Musterprofil je Ebene. Omitted on older stored sets. */
  patternByLevel?: PatternLevelProfile[];
  /** Store-surroundings Musterprofil je Datensatz (normalized trend). */
  patternByDataset?: PatternDatasetProfile[];
  /**
   * Zielregionen of this set in snapshot order. `geoKey` is the key used as
   * `items[].targetRegionGeoKey` (geoKey → `ags:{ags}` → `label:{normalized}`).
   */
  targetRegions?: Array<{ geoKey: string; label: string }>;
  items: RecommendationItem[];
}

export interface RecommendationSet extends RecommendationPayload {
  id: string;
  createdAt: string;
}
