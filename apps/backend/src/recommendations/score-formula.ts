import { PatternDatasetProfile } from "../analysis/pattern-profile";
import {
  latestNormalizedValue,
  presentNormalizedPoints,
} from "../analysis/series-baseline";
import { seriesLevelRank } from "../analysis/series-criteria";
import { PatternCriterion } from "../analysis/types";
import { SeriesCoverage, SeriesPoint } from "../analysis/yearly-series";

/**
 * Ranking closeness to the store-surroundings pattern on the baseline.
 * Trend before niveau. Missing cells stay absent (never 0).
 */
export const SCORE_FORMULA_DEFAULTS = {
  trendWeight: 0.6,
  niveauWeight: 0.4,
  minActiveDatasets: 2,
  minDispersionN: 3,
} as const;

/** Consistency constant: σ ≈ 1.4826 · MAD for a normal distribution. */
export const MAD_TO_SIGMA = 1.4826;
/** Consistency constant: σ ≈ IQR / 1.349 for a normal distribution. */
export const IQR_TO_SIGMA = 1.349;

export interface ScoreFormulaConfig {
  trendWeight: number;
  niveauWeight: number;
  minActiveDatasets: number;
  minDispersionN: number;
}

export interface PatternNumericRef {
  niveau: number | null;
  trend: number | null;
}

export interface DatasetComponentSample {
  niveau: number | null;
  trend: number | null;
}

export function readScoreFormulaConfig(
  read: (name: string) => string | undefined = (name) => process.env[name],
): ScoreFormulaConfig {
  const trendWeight = unitWeight(read("ANALYSIS_SCORE_TREND_WEIGHT"), SCORE_FORMULA_DEFAULTS.trendWeight);
  const niveauWeight = unitWeight(read("ANALYSIS_SCORE_NIVEAU_WEIGHT"), SCORE_FORMULA_DEFAULTS.niveauWeight);
  const minActiveDatasets = positiveInt(
    read("ANALYSIS_SCORE_MIN_ACTIVE_DATASETS"),
    SCORE_FORMULA_DEFAULTS.minActiveDatasets,
  );
  const minDispersionN = positiveInt(
    read("ANALYSIS_SCORE_MIN_DISPERSION_N"),
    SCORE_FORMULA_DEFAULTS.minDispersionN,
  );
  return normalizeWeights({ trendWeight, niveauWeight, minActiveDatasets, minDispersionN });
}

export function normalizeWeights(config: ScoreFormulaConfig): ScoreFormulaConfig {
  const trend = Math.max(0, config.trendWeight);
  const niveau = Math.max(0, config.niveauWeight);
  const sum = trend + niveau;
  if (sum <= 0) {
    return {
      ...config,
      trendWeight: SCORE_FORMULA_DEFAULTS.trendWeight,
      niveauWeight: SCORE_FORMULA_DEFAULTS.niveauWeight,
    };
  }
  return {
    ...config,
    trendWeight: trend / sum,
    niveauWeight: niveau / sum,
    minActiveDatasets: Math.max(2, config.minActiveDatasets),
    minDispersionN: Math.max(3, config.minDispersionN),
  };
}

/** Median of a non-empty finite list. Caller must not pass []. */
export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median absolute deviation around the median. */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

/** Interquartile range (Q3 − Q1). */
export function iqr(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  return Math.max(0, q3 - q1);
}

/**
 * Robust scale for proximity (σ-equivalent). Neutral (`null`) when n < minN
 * or both MAD and IQR are 0 — never divide by 0.
 * MAD is scaled by 1.4826; IQR fallback by 1/1.349.
 */
export function robustSpread(values: number[], minN: number = SCORE_FORMULA_DEFAULTS.minDispersionN): number | null {
  if (values.length < minN) return null;
  const scale = mad(values) * MAD_TO_SIGMA;
  if (scale > 0) return scale;
  const range = iqr(values);
  return range > 0 ? range / IQR_TO_SIGMA : null;
}

/** 1 − min(1, |candidate − pattern| / spread). Spread must be > 0. */
export function closeness(candidate: number, pattern: number, spread: number): number {
  if (!(spread > 0)) return 0;
  return 1 - Math.min(1, Math.abs(candidate - pattern) / spread);
}

export function coverageFactor(nActive: number, kMin: number): number {
  if (nActive <= 0 || kMin <= 0) return 0;
  return Math.min(1, nActive / kMin);
}

/**
 * Fineness weight of the Ebene the dataset is present on.
 * Address/Raster > LOR/Quartier > Ortsteil/PLZ > Bezirk > Gemeinde.
 */
export function grainWeight(level: string | null | undefined): number {
  const rank = seriesLevelRank(level ?? "");
  if (rank <= 1) return 5;
  if (rank === 2) return 4;
  if (rank <= 4) return 3;
  if (rank === 5) return 2;
  if (rank === 6) return 1;
  return 1;
}

/**
 * Yearly rate of the baselined series: (last − first present
 * normalizedValue) / year span. Coverage `single` / `none` is not a
 * trend. Needs at least two calendar years. Gaps do not inflate the
 * rate — a two-year jump over 2023–2025 is half a same-sized 2024–2025 jump.
 */
export function trendDelta(points: SeriesPoint[], coverage?: SeriesCoverage): number | null {
  const span = trendYearSpan(points, coverage);
  if (span == null) return null;
  const present = presentNormalizedPoints(points);
  return (present[present.length - 1]!.normalizedValue - present[0]!.normalizedValue) / span;
}

/** Distinct calendar years in a valid trend (2 or 3 typically). Null when no trend. */
export function trendYearCount(points: SeriesPoint[], coverage?: SeriesCoverage): number | null {
  if (coverage === "single" || coverage === "none") return null;
  const years = trendYears(points);
  return years.length >= 2 ? years.length : null;
}

/** Last year − first year of a valid trend. Null when no trend. */
export function trendYearSpan(points: SeriesPoint[], coverage?: SeriesCoverage): number | null {
  if (coverage === "single" || coverage === "none") return null;
  const years = trendYears(points);
  if (years.length < 2) return null;
  const span = years[years.length - 1]! - years[0]!;
  return span > 0 ? span : null;
}

function trendYears(points: SeriesPoint[]): number[] {
  const present = presentNormalizedPoints(points);
  const years: number[] = [];
  const seen = new Set<number>();
  for (const point of present) {
    const year = Number.parseInt(point.period.slice(0, 4), 10);
    if (!Number.isInteger(year) || year < 1000 || year > 9999 || seen.has(year)) continue;
    seen.add(year);
    years.push(year);
  }
  return years;
}

/** Top-N for leave-one-out: max(3, ceil(n/10)). */
export function leaveOneOutTopN(candidateCount: number): number {
  if (candidateCount <= 0) return 3;
  return Math.max(3, Math.ceil(candidateCount / 10));
}

export function niveauValue(points: SeriesPoint[]): number | null {
  const value = latestNormalizedValue(points);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sampleFromPoints(points: SeriesPoint[], coverage?: SeriesCoverage): DatasetComponentSample {
  return {
    niveau: niveauValue(points),
    trend: trendDelta(points, coverage),
  };
}

/**
 * Weighted closeness for one dataset. Missing components are absent, never 0.
 * Returns null when nothing can be scored (neutral / absent).
 */
export function datasetCloseness(
  sample: DatasetComponentSample,
  pattern: PatternNumericRef,
  spreads: { niveau: number | null; trend: number | null },
  config: ScoreFormulaConfig,
): number | null {
  let weighted = 0;
  let mass = 0;
  if (sample.trend != null && pattern.trend != null && spreads.trend != null) {
    weighted += config.trendWeight * closeness(sample.trend, pattern.trend, spreads.trend);
    mass += config.trendWeight;
  }
  if (sample.niveau != null && pattern.niveau != null && spreads.niveau != null) {
    weighted += config.niveauWeight * closeness(sample.niveau, pattern.niveau, spreads.niveau);
    mass += config.niveauWeight;
  }
  if (mass <= 0) return null;
  return weighted / mass;
}

/** Item score 0..1 after grain weights and the single-dataset cap. */
export function combineCandidateScore(
  parts: Array<{ closeness: number; weight: number }>,
  config: ScoreFormulaConfig,
): { score: number; nActive: number } {
  const active = parts.filter((part) => part.weight > 0);
  if (active.length === 0) return { score: 0, nActive: 0 };
  const mass = active.reduce((sum, part) => sum + part.weight, 0);
  const raw = mass <= 0 ? 0 : active.reduce((sum, part) => sum + part.closeness * part.weight, 0) / mass;
  const score = raw * coverageFactor(active.length, config.minActiveDatasets);
  return { score: clampUnit(score), nActive: active.length };
}

export function patternRefForCriterion(
  criterion: PatternCriterion,
  profiles: PatternDatasetProfile[] = [],
): PatternNumericRef {
  const profile = profiles.find(
    (item) =>
      item.metricId === criterion.metricId ||
      item.metricId === criterion.key ||
      item.criterion.key === criterion.key,
  );
  if (profile) {
    const sample = sampleFromPoints(profile.yearlySeries.points, profile.yearlySeries.coverage);
    return {
      niveau: sample.niveau ?? finiteOrNull(criterion.normalizedValue) ?? finiteOrNull(profile.criterion.normalizedValue),
      trend: sample.trend,
    };
  }
  return {
    niveau: finiteOrNull(criterion.normalizedValue),
    trend: null,
  };
}

export function canonicalScoreLevel(level: string | null | undefined): string {
  if (level === "stadtteil") return "ortsteil";
  if (level === "stadtbezirk") return "bezirk";
  return level?.trim() || "unknown";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function unitWeight(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 10_000) / 10_000;
}
