import { Grain } from "../target-region/dto";
import { AnalysisPattern, CriterionDirection, PatternSource } from "../analysis/types";

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

export interface RecommendationEvidence {
  key: string;
  label: string;
  direction: CriterionDirection;
  patternDirection: CriterionDirection;
  evidence: string;
}

export interface ScoredLocation {
  id: string;
  title: string;
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
  items: RecommendationItem[];
}

export interface RecommendationSet extends RecommendationPayload {
  id: string;
  createdAt: string;
}

export interface CandidateRow {
  id: string;
  geoKey: string;
  grain: string;
  name: string | null;
  title: string;
  refPeriod: string | null;
  metadata: unknown;
  lon: number | null;
  lat: number | null;
}
