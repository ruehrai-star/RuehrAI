import { LonLatBounds, RegionGeometry } from "../geo/region-geometry";
import { Grain } from "../target-region/dto";
import { YearlySeries } from "./yearly-series";

export type { SeriesCoverage, SeriesGranularity, SeriesLevel, SeriesPoint, YearlySeries } from "./yearly-series";

export type RevenueDirection = "up" | "down" | "flat";
export type CriterionDirection = RevenueDirection | "unknown";
export type PatternSource = "llm" | "heuristic";
export type BrainSearchMode = "vector" | "sql";

export type VectorUnavailableReason =
  | "embeddings_disabled"
  | "embeddings_unconfigured"
  | "embeddings_unreachable"
  | "embeddings_rejected"
  | "vector_query_failed"
  | "no_embeddings_in_region"
  | "features_unavailable";

export interface AnalysisRevenuePoint {
  year: number;
  month: number;
  revenueEur: number | null;
}

export interface AnalysisRevenueChange {
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
  fromRevenueEur: number;
  toRevenueEur: number;
  changeEur: number;
}

export interface AnalysisStoreInput {
  id: string;
  label: string | null;
  street: string;
  postalCode: string;
  city: string;
  lon: number | null;
  lat: number | null;
  points: AnalysisRevenuePoint[];
  changes: AnalysisRevenueChange[];
}

export interface AnalysisRegion {
  label: string;
  grain: Grain | null;
  geoKey: string | null;
  level?: string | null;
  parentLabel?: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | null;
  lat: number | null;
  bounds: LonLatBounds | null;
  geometry: RegionGeometry | null;
  updatedAt: string;
}

export interface AnalysisInput {
  region: AnalysisRegion;
  /** Full target-region list. Location search uses this set when present. */
  regions?: AnalysisRegion[];
  stores: AnalysisStoreInput[];
  revenueDirection: RevenueDirection;
  capturedAt: string;
}

/** The set used for location search. Older snapshots only stored `region`. */
export function analysisRegions(input: AnalysisInput): AnalysisRegion[] {
  if (input.regions && input.regions.length > 0) return input.regions;
  return [input.region];
}

export interface BrainSignal {
  key: string;
  value: string;
}

export type BrainMatch = "region" | "store" | "label";

export interface BrainFact {
  id: string;
  geoKey: string;
  grain: string;
  title: string;
  name: string | null;
  refPeriod: string | null;
  excerpt: string;
  distance: number | null;
  matchedBy: BrainMatch;
  signals: BrainSignal[];
}

export interface AnalysisBrain {
  mode: BrainSearchMode;
  vectorUnavailableReason: VectorUnavailableReason | null;
  factCount: number;
  facts: BrainFact[];
}

export interface PatternCriterion {
  key: string;
  label: string;
  direction: CriterionDirection;
  evidence: string;
}

export interface AnalysisPattern {
  source: PatternSource;
  summary: string;
  revenueDirection: RevenueDirection;
  criteria: PatternCriterion[];
  /** Three-year Brain series for the Zielregionen. Not store revenue. */
  yearlySeries?: YearlySeries[];
}

export interface AnalysisRun {
  id: string;
  status: "completed";
  createdAt: string;
  input: AnalysisInput;
  brain: AnalysisBrain;
  pattern: AnalysisPattern;
}

export interface AnalysisPatternResponse {
  runId: string;
  createdAt: string;
  pattern: AnalysisPattern;
}
