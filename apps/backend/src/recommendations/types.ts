import { Grain } from "../target-region/dto";
import { PatternLevelProfile, PatternDatasetProfile } from "../analysis/pattern-profile";
import { SeriesBaseline } from "../analysis/series-baseline";
import { AnalysisPattern, CriterionDirection, PatternSource } from "../analysis/types";
import { SeriesCoverage, SeriesPoint, SeriesPointStatus } from "../analysis/yearly-series";
import { AreaKind } from "./area-candidates";

export interface RecommendationWindow {
  from: string;
  to: string;
}

export interface RecommendationLocation {
  geoKey: string;
  grain: Grain;
  lon: number | null;
  lat: number | null;
  name: string | null;
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
}

export interface ScoredLocation {
  id: string;
  title: string;
  kind: AreaKind;
  location: RecommendationLocation;
  score: number;
  criteriaEvidence: RecommendationEvidence[];
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
  items: RecommendationItem[];
}

export interface RecommendationSet extends RecommendationPayload {
  id: string;
  createdAt: string;
}
