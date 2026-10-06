import { AnalysisRegion, PatternCriterion } from "./types";
import { AreaBaselineRow, MetricCatalogEntry } from "./area-baseline";
import {
  RegionSourceKeys,
  SeriesFeatureRow,
  YearlySeries,
  buildAllMetricSeries,
  indexSeriesDocs,
} from "./yearly-series";
import { PatternDatasetProfile } from "./pattern-profile";
import { AreaCandidate } from "../recommendations/area-candidates";
import { rankTeilflaechen } from "../recommendations/score";
import { capCandidatesForSeries } from "../recommendations/candidate-cap";
import { ScoredLocation } from "../recommendations/types";

export interface YearlySeriesComputeJob {
  type: "yearlySeries";
  resolved: RegionSourceKeys[];
  docs: SeriesFeatureRow[];
  asOfIso: string;
  catalog: Array<[string, MetricCatalogEntry]>;
  rows: AreaBaselineRow[];
}

export interface RankComputeJob {
  type: "rank";
  candidates: AreaCandidate[];
  series: YearlySeries[];
  criteria: PatternCriterion[];
  regions: AnalysisRegion[];
  patternByDataset?: PatternDatasetProfile[];
}

export interface CapComputeJob {
  type: "cap";
  candidates: AreaCandidate[];
  regions: AnalysisRegion[];
  cap: number;
}

export type ComputeJob = YearlySeriesComputeJob | RankComputeJob | CapComputeJob;

export interface ComputeStats {
  docs: number;
  regions: number;
  chunks: number;
  maxSyncMs: number;
}

export interface YearlySeriesComputeResult {
  type: "yearlySeries";
  series: YearlySeries[];
  stats: ComputeStats;
}

export interface RankComputeResult {
  type: "rank";
  ranked: ScoredLocation[];
}

export interface CapComputeResult {
  type: "cap";
  selected: AreaCandidate[];
  candidateCount: number;
  cappedCount: number;
  truncated: boolean;
}

export type ComputeResult = YearlySeriesComputeResult | RankComputeResult | CapComputeResult;

/** Pure CPU. Safe to run on a worker thread (no DB, no Nest). */
export function handleComputeJobSync(job: ComputeJob): ComputeResult {
  if (job.type === "yearlySeries") {
    const started = Date.now();
    const index = indexSeriesDocs(job.docs);
    const series = buildAllMetricSeries(job.resolved, index, new Date(job.asOfIso));
    return {
      type: "yearlySeries",
      series,
      stats: {
        docs: job.docs.length,
        regions: job.resolved.length,
        chunks: 1,
        maxSyncMs: Date.now() - started,
      },
    };
  }
  if (job.type === "rank") {
    return {
      type: "rank",
      ranked: rankTeilflaechen(job.candidates, job.series, job.criteria, job.regions, {
        patternByDataset: job.patternByDataset,
      }),
    };
  }
  const capped = capCandidatesForSeries(job.candidates, job.regions, job.cap);
  return {
    type: "cap",
    selected: capped.selected,
    candidateCount: capped.candidateCount,
    cappedCount: capped.cappedCount,
    truncated: capped.truncated,
  };
}
