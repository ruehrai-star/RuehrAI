import { AnalysisRegion, PatternCriterion } from "../analysis/types";
import { emptyToNull } from "../customer/values";
import { minNumber, pushAll } from "../common/safe-array";
import {
  absentEvidence,
  directionFromPoints,
  frameNoun,
  kindFromCoverage,
  metricIdsForCriterion,
  metricLabel,
  presentPoints,
  seriesEvidence,
  seriesLevelRank,
} from "../analysis/series-criteria";
import type { BaselineMethod } from "../analysis/area-baseline";
import { PatternDatasetProfile } from "../analysis/pattern-profile";
import {
  attachNormalizedValues,
  baselineForMetric,
  latestBaselineMethod,
  latestNormalizedValue,
  latestRawValue,
  presentNormalizedPoints,
  SeriesBaseline,
} from "../analysis/series-baseline";
import { SeriesPoint, YearlySeries, isSeriesCoverage } from "../analysis/yearly-series";
import { AreaCandidate, AreaKind, areaKindRank } from "./area-candidates";
import { areaGroupKey, displayAreaName, hitParentLabel } from "./hit-display";
import {
  canonicalScoreLevel,
  combineCandidateScore,
  datasetCloseness,
  grainWeight,
  patternRefForCriterion,
  readScoreFormulaConfig,
  robustSpread,
  sampleFromPoints,
  ScoreFormulaConfig,
} from "./score-formula";
import {
  EvidenceScope,
  RecommendationEvidence,
  RecommendationIntersectionPart,
  RecommendationItem,
  RecommendationTrend,
  ScoredLocation,
} from "./types";

export interface RankTeilflaechenOptions {
  patternByDataset?: PatternDatasetProfile[];
  config?: ScoreFormulaConfig;
}

export const MAX_RANKED_ITEMS = 200;
/** Ranking / analysis accepts at most this many Zielregionen. No silent drop. */
export const MAX_TARGET_REGIONS = 200;
/** n ≤ this still gets at least 3 ranked slots per region (66 × 3 = 198 ≤ 200). */
export const TARGET_REGION_FULL_QUOTA_MAX_N = 66;

export function tooManyTargetRegionsError(regionCount: number): Error {
  return Object.assign(new Error(`too many target regions: ${regionCount}`), {
    code: "TOO_MANY_TARGET_REGIONS",
    regionCount,
  });
}

/**
 * Guaranteed ranked slots per Zielregion inside the 200-item set cap.
 * n ≤ 66 → at least 3 (`max(3, floor(200/n))`); 67–200 → at least 1
 * (`floor(200/n)`, min 1). n > 200 throws — callers must reject the run.
 */
export function rankedSlotsPerTargetRegion(regionCount: number): number {
  if (regionCount <= 0) return 0;
  if (regionCount > MAX_TARGET_REGIONS) throw tooManyTargetRegionsError(regionCount);
  const share = Math.floor(MAX_RANKED_ITEMS / regionCount);
  if (regionCount <= TARGET_REGION_FULL_QUOTA_MAX_N) return Math.max(3, share);
  return Math.max(1, share);
}

/**
 * Rank Teilflächen against the store-surroundings **dataset** pattern.
 * Score is closeness to the Musterwert on the baseline (trend before
 * niveau), not a binary direction match. Inherited parent-level series
 * are labeled and stay neutral. The listed Fläche is the smallest common
 * hit: finest kind that still has local data for a pattern dataset.
 */
export function rankTeilflaechen(
  candidates: AreaCandidate[],
  series: YearlySeries[],
  criteria: PatternCriterion[],
  regions: AnalysisRegion[] = [],
  options: RankTeilflaechenOptions = {},
): ScoredLocation[] {
  const config = options.config ?? readScoreFormulaConfig();
  const patternByDataset = options.patternByDataset ?? [];
  const normalized = attachNormalizedValues(series);
  const hits = selectDatasetHits(candidates, normalized, criteria);
  const byGeoKey = groupSeries(normalized);
  const byGroup = indexByGroup(candidates);
  const patternRefs = new Map(
    criteria.map((criterion) => [criterion.key, patternRefForCriterion(criterion, patternByDataset)] as const),
  );

  const pending = hits.map((candidate) => {
    const local = byGeoKey.get(candidate.geoKey) ?? [];
    const evidence = criteria.map((criterion) => evidenceForCandidate(criterion, local, candidate.kind));
    return { candidate, evidence };
  });

  const niveauBuckets = new Map<string, number[]>();
  const trendBuckets = new Map<string, number[]>();
  for (const item of pending) {
    for (const entry of item.evidence) {
      const sample = sampleFromEvidence(entry);
      const bucket = spreadKey(entry.key, entry.sourceLevel ?? item.candidate.kind);
      if (sample.niveau != null) pushNumber(niveauBuckets, bucket, sample.niveau);
      if (sample.trend != null) pushNumber(trendBuckets, bucket, sample.trend);
    }
  }
  const niveauSpread = spreadMap(niveauBuckets, config.minDispersionN);
  const trendSpread = spreadMap(trendBuckets, config.minDispersionN);

  const scored: ScoredLocation[] = [];
  for (const item of pending) {
    const parts: Array<{ closeness: number; weight: number }> = [];
    const withBaseline = item.evidence.map((entry) => {
      const baselineMatch =
        entry.baselineMatch ?? baselinesMatch(entry.baseline, criteria.find((c) => c.key === entry.key)?.baseline);
      const sample = sampleFromEvidence(entry);
      const bucket = spreadKey(entry.key, entry.sourceLevel ?? item.candidate.kind);
      const closeness = datasetCloseness(
        sample,
        patternRefs.get(entry.key) ?? { niveau: null, trend: null },
        {
          niveau: niveauSpread.get(bucket) ?? null,
          trend: trendSpread.get(bucket) ?? null,
        },
        config,
      );
      if (closeness != null) {
        parts.push({ closeness, weight: grainWeight(entry.sourceLevel ?? item.candidate.kind) });
      }
      return {
        ...entry,
        baselineMatch,
        ...(closeness != null ? { proximity: roundScore(closeness) } : {}),
      };
    });
    const combined = combineCandidateScore(parts, config);
    const name = displayAreaName(item.candidate);
    const parentLabel = hitParentLabel(item.candidate, candidates, regions, byGroup);
    const intersectionOf = intersectionParts(item.candidate, byGroup, byGeoKey, criteria);
    const targetRegionGeoKey = item.candidate.targetRegionGeoKey?.trim() ?? "";
    scored.push({
      id: item.candidate.id,
      title: name,
      kind: item.candidate.kind,
      grain: item.candidate.grain,
      name,
      parentLabel,
      ...(intersectionOf.length >= 2 ? { intersectionOf } : {}),
      targetRegionGeoKey,
      dataAsOf: dataAsOfFromEvidence(withBaseline),
      location: {
        geoKey: item.candidate.geoKey,
        grain: item.candidate.grain,
        lon: item.candidate.lon,
        lat: item.candidate.lat,
        name,
      },
      score: combined.score,
      criteriaEvidence: withBaseline,
      geometry: item.candidate.geometry ?? null,
      geometryUnavailableReason:
        item.candidate.geometry
          ? null
          : item.candidate.geometryUnavailableReason ?? "Die Fläche kann noch nicht gezeichnet werden.",
      trend: buildHitTrend(withBaseline),
    });
  }

  scored.sort(compareScoredLocations);
  return capRankedByTargetRegion(scored);
}

/** Newest present `points[].period` (`YYYY` or `YYYY-MM`). Null when none. */
export function dataAsOfFromEvidence(evidence: RecommendationEvidence[]): string | null {
  let latest: string | null = null;
  for (const entry of evidence) {
    for (const point of entry.points ?? []) {
      if (point.status && point.status !== "present") continue;
      const period = point.period?.trim() ?? "";
      if (!/^\d{4}(-\d{2})?$/.test(period)) continue;
      if (latest == null || period > latest) latest = period;
    }
  }
  return latest;
}

/**
 * Tie-break: score, then coverage (active datasets), then overlaps-share,
 * then stable id. Never the visible name.
 */
export function compareScoredLocations(left: ScoredLocation, right: ScoredLocation): number {
  if (right.score !== left.score) return right.score - left.score;
  const leftCoverage = activeCoverageCount(left.criteriaEvidence);
  const rightCoverage = activeCoverageCount(right.criteriaEvidence);
  if (rightCoverage !== leftCoverage) return rightCoverage - leftCoverage;
  const leftShare = maxOverlapShare(left);
  const rightShare = maxOverlapShare(right);
  if (rightShare !== leftShare) return rightShare - leftShare;
  return left.id.localeCompare(right.id, "de");
}

/**
 * Per-Zielregion cap so every region that has hits stays in the set.
 * n ≤ 66 → ≥3 slots; 67–200 → ≥1 (`floor(200/n)`). Leftover filled by
 * global score. Total ≤ `MAX_RANKED_ITEMS`. n > 200 throws.
 * Identical in the worker and setImmediate path.
 */
export function capRankedByTargetRegion(scored: ScoredLocation[]): ScoredLocation[] {
  const groups = groupScoredByTargetRegion(scored);
  if (groups.size > MAX_TARGET_REGIONS) throw tooManyTargetRegionsError(groups.size);
  if (scored.length <= MAX_RANKED_ITEMS) return scored;
  const perRegionCap = rankedSlotsPerTargetRegion(groups.size);
  const selected: ScoredLocation[] = [];
  const leftover: ScoredLocation[] = [];
  for (const items of groups.values()) {
    const quota = Math.min(perRegionCap, items.length);
    selected.push(...items.slice(0, quota));
    leftover.push(...items.slice(quota));
  }
  leftover.sort(compareScoredLocations);
  const missing = MAX_RANKED_ITEMS - selected.length;
  if (missing > 0) selected.push(...leftover.slice(0, missing));
  return selected.slice(0, MAX_RANKED_ITEMS);
}

/**
 * Rank 1-based and gapless inside each `targetRegionGeoKey`. List order is
 * input-region order, then rank. Tie-break is `compareScoredLocations`.
 */
export function assignRanksByTargetRegion(
  items: Array<Omit<RecommendationItem, "rank">>,
  regionOrder: string[],
): RecommendationItem[] {
  const groups = new Map<string, Array<Omit<RecommendationItem, "rank">>>();
  for (const item of items) {
    const key = item.targetRegionGeoKey?.trim() || "_unassigned";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const orderIndex = new Map<string, number>();
  regionOrder.forEach((key, index) => {
    const trimmed = key.trim();
    if (trimmed && !orderIndex.has(trimmed)) orderIndex.set(trimmed, index);
  });
  const keys = [...groups.keys()].sort((left, right) => {
    const leftIndex = orderIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.localeCompare(right, "de");
  });
  const ranked: RecommendationItem[] = [];
  for (const key of keys) {
    const group = groups.get(key) ?? [];
    group.sort(compareScoredLocations);
    group.forEach((item, index) => {
      ranked.push({
        ...item,
        targetRegionGeoKey: item.targetRegionGeoKey ?? "",
        dataAsOf: item.dataAsOf !== undefined ? item.dataAsOf : dataAsOfFromEvidence(item.criteriaEvidence),
        rank: index + 1,
      });
    });
  }
  return ranked;
}

function groupScoredByTargetRegion(scored: ScoredLocation[]): Map<string, ScoredLocation[]> {
  const grouped = new Map<string, ScoredLocation[]>();
  for (const item of scored) {
    const key = item.targetRegionGeoKey?.trim() || "_unassigned";
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}

/**
 * Per municipality (AGS), keep the finest kind that still has **local**
 * series for a pattern dataset. That is the intersection grain: not the
 * smallest admin Ebene at all costs, and not a global finest that would
 * drop Köln PLZ when Berlin LOR/Bezirk also exists.
 */
export function selectDatasetHits(
  candidates: AreaCandidate[],
  series: YearlySeries[],
  criteria: PatternCriterion[],
): AreaCandidate[] {
  if (candidates.length === 0) return [];
  const wanted = new Set(criteria.flatMap((criterion) => metricIdsForCriterion(criterion.key)));
  const byGeoKey = groupSeries(series);
  const withLocal = candidates.filter((candidate) => {
    const local = byGeoKey.get(candidate.geoKey) ?? [];
    return local.some(
      (item) =>
        wanted.has(item.metricId) &&
        evidenceScope(candidate.kind, item.sourceLevel) === "local" &&
        presentPoints(item.points).length > 0,
    );
  });
  const pool = withLocal.length > 0 ? withLocal : candidates;
  const groups = new Map<string, AreaCandidate[]>();
  for (const candidate of pool) {
    const key = datasetHitGroup(candidate);
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }
  const hits: AreaCandidate[] = [];
  for (const group of groups.values()) {
    const finest = minNumber(group.map((candidate) => areaKindRank(candidate.kind)));
    pushAll(
      hits,
      group.filter((candidate) => areaKindRank(candidate.kind) === finest),
    );
  }
  return hits;
}

function datasetHitGroup(candidate: AreaCandidate): string {
  return areaGroupKey(candidate);
}

function indexByGroup(pool: AreaCandidate[]): Map<string, AreaCandidate[]> {
  const grouped = new Map<string, AreaCandidate[]>();
  for (const candidate of pool) {
    const key = datasetHitGroup(candidate);
    const list = grouped.get(key) ?? [];
    list.push(candidate);
    grouped.set(key, list);
  }
  return grouped;
}

function intersectionParts(
  hit: AreaCandidate,
  byGroup: Map<string, AreaCandidate[]>,
  byGeoKey: Map<string, YearlySeries[]>,
  criteria: PatternCriterion[],
): RecommendationIntersectionPart[] {
  const group = byGroup.get(datasetHitGroup(hit)) ?? [];
  const parts: RecommendationIntersectionPart[] = [];
  const seen = new Set<string>();
  for (const criterion of criteria) {
    const wanted = new Set(metricIdsForCriterion(criterion.key));
    const matches: AreaCandidate[] = [];
    for (const candidate of group) {
      const local = byGeoKey.get(candidate.geoKey) ?? [];
      if (
        local.some(
          (item) =>
            wanted.has(item.metricId) &&
            evidenceScope(candidate.kind, item.sourceLevel) === "local" &&
            presentPoints(item.points).length > 0,
        )
      ) {
        matches.push(candidate);
      }
    }
    if (matches.length === 0) continue;
    const finest = minNumber(matches.map((candidate) => areaKindRank(candidate.kind)));
    const chosen = matches.find((candidate) => areaKindRank(candidate.kind) === finest);
    if (!chosen) continue;
    const name = displayAreaName(chosen);
    if (seen.has(chosen.geoKey)) continue;
    seen.add(chosen.geoKey);
    const part: RecommendationIntersectionPart = {
      geoKey: chosen.geoKey,
      grain: chosen.grain,
      name,
    };
    const datasetKey = emptyToNull(criterion.metricId) ?? emptyToNull(criterion.key);
    if (datasetKey) part.datasetKey = datasetKey;
    parts.push(part);
  }
  return parts;
}

export function isTrendCriterion(criterion: PatternCriterion): boolean {
  if (criterion.kind === "trend") return true;
  if (criterion.kind === "stichtag") return false;
  return criterion.direction === "up" || criterion.direction === "down" || criterion.direction === "flat";
}

export function evidenceScope(candidateKind: AreaKind, sourceLevel?: string | null): EvidenceScope {
  if (!sourceLevel) return "local";
  return seriesLevelRank(sourceLevel) > seriesLevelRank(candidateKind) ? "inherited" : "local";
}

function evidenceForCandidate(
  criterion: PatternCriterion,
  local: YearlySeries[],
  candidateKind: AreaKind,
): RecommendationEvidence {
  const series = findSeries(criterion, local, candidateKind);
  const baseline = criterion.baseline ?? baselineForMetric(criterion.key);
  const label = criterion.label || metricLabel(criterion.key);
  if (!series) {
    return absentEvidenceRow(criterion, label, baseline, "local");
  }

  const scope = evidenceScope(candidateKind, series.sourceLevel);
  const present = presentPoints(series.points);
  if (present.length === 0) {
    return {
      ...absentEvidenceRow(criterion, metricLabel(series.metricId, series.sourceLevel, series.sourceGeoKey), baseline, scope),
      coverage: series.coverage,
      sourceLevel: series.sourceLevel,
      sourceGeoKey: series.sourceGeoKey,
      points: withoutInventedZero(series.points),
      evidence: withScopeNote(absentEvidence(criterion.key, label), scope, series.sourceLevel),
    };
  }

  const candidateBaseline = baselineForMetric(series.metricId, series.valueKey);
  const patternBaseline = criterion.baseline ?? baselineForMetric(criterion.key);
  const candidateMethod = latestBaselineMethod(series.points);
  const patternMethod = criterion.baselineMethod;
  const baselineMatch =
    baselinesMatch(candidateBaseline, patternBaseline) && methodsMatch(candidateMethod, patternMethod);

  if (!baselineMatch) {
    return {
      key: criterion.key,
      metricId: criterion.metricId ?? series.metricId,
      label: metricLabel(series.metricId, series.sourceLevel, series.sourceGeoKey),
      direction: "unknown",
      patternDirection: criterion.direction,
      evidence: withScopeNote(absentEvidence(criterion.key, label), scope, series.sourceLevel),
      kind: "absent",
      status: "absent",
      match: false,
      coverage: series.coverage,
      scope,
      sourceLevel: series.sourceLevel,
      sourceGeoKey: series.sourceGeoKey,
      baseline: candidateBaseline,
      rawValue: latestRawValue(series.points),
      baselineMethod: candidateMethod ?? patternMethod,
      baselineMatch: false,
      points: withoutNormalizedValues(withoutInventedZero(series.points)),
    };
  }

  const normalized = presentNormalizedPoints(series.points);
  const kind = normalized.length >= 2 ? "trend" : kindFromCoverage(series.coverage) ?? "stichtag";
  const direction = kind === "trend" ? directionFromPoints(series.points, "normalizedValue") : "unknown";
  const match =
    kind === "trend" &&
    criterion.direction !== "unknown" &&
    direction !== "unknown" &&
    direction === criterion.direction &&
    scope !== "inherited";

  return {
    key: criterion.key,
    metricId: criterion.metricId ?? series.metricId,
    label: metricLabel(series.metricId, series.sourceLevel, series.sourceGeoKey),
    direction,
    patternDirection: criterion.direction,
    evidence: withScopeNote(seriesEvidence(series, direction, baseline), scope, series.sourceLevel),
    kind: normalized.length === 0 ? "absent" : kind,
    status: normalized.length === 0 ? "absent" : "present",
    match,
    coverage: series.coverage,
    scope,
    sourceLevel: series.sourceLevel,
    sourceGeoKey: series.sourceGeoKey,
    baseline,
    rawValue: latestRawValue(series.points),
    normalizedValue: latestNormalizedValue(series.points),
    baselineMethod: latestBaselineMethod(series.points) ?? criterion.baselineMethod,
    baselineMatch: true,
    points: withoutInventedZero(series.points),
  };
}

function absentEvidenceRow(
  criterion: PatternCriterion,
  label: string,
  baseline: SeriesBaseline,
  scope: EvidenceScope,
): RecommendationEvidence {
  return {
    key: criterion.key,
    metricId: criterion.metricId ?? criterion.key,
    label,
    direction: "unknown",
    patternDirection: criterion.direction,
    evidence: absentEvidence(criterion.key, label),
    kind: "absent",
    status: "absent",
    match: false,
    coverage: "none",
    scope,
    baseline,
    baselineMatch: true,
    points: [],
  };
}

function withScopeNote(evidence: string, scope: EvidenceScope, sourceLevel?: string): string {
  if (scope !== "inherited") return evidence;
  const noun = frameNoun(sourceLevel);
  const suffix = noun
    ? ` Übernommen von ${noun} — unterscheidet Geschwisterflächen nicht.`
    : " Übernommen von einer übergeordneten Ebene — unterscheidet Geschwisterflächen nicht.";
  return `${evidence.replace(/\s+$/, "")}${suffix}`;
}

function findSeries(
  criterion: PatternCriterion,
  local: YearlySeries[],
  candidateKind: AreaKind,
): YearlySeries | null {
  const wanted = new Set(metricIdsForCriterion(criterion.key));
  const matches = local.filter((item) => wanted.has(item.metricId));
  if (matches.length === 0) return null;
  const ranked = [...matches].sort((left, right) => {
    const leftScore = seriesPreference(left, candidateKind);
    const rightScore = seriesPreference(right, candidateKind);
    if (leftScore !== rightScore) return leftScore - rightScore;
    return seriesLevelRank(left.sourceLevel) - seriesLevelRank(right.sourceLevel);
  });
  return ranked[0] ?? null;
}

function seriesPreference(series: YearlySeries, candidateKind: AreaKind): number {
  const present = presentPoints(series.points).length > 0 ? 0 : 2;
  const local = evidenceScope(candidateKind, series.sourceLevel) === "local" ? 0 : 1;
  return present + local;
}

function groupSeries(series: YearlySeries[]): Map<string, YearlySeries[]> {
  const grouped = new Map<string, YearlySeries[]>();
  for (const item of series) {
    const list = grouped.get(item.requestedGeoKey) ?? [];
    list.push(item);
    grouped.set(item.requestedGeoKey, list);
  }
  return grouped;
}

function withoutInventedZero(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((point) => {
    if (point.status === "absent") return { period: point.period, status: "absent" };
    const next: SeriesPoint = { period: point.period, status: "present" };
    if (typeof point.value === "number") next.value = point.value;
    if (typeof point.normalizedValue === "number") next.normalizedValue = point.normalizedValue;
    if (point.baselineMethod) next.baselineMethod = point.baselineMethod;
    if (point.baselineYear != null) next.baselineYear = point.baselineYear;
    if (point.baselineYearRule) next.baselineYearRule = point.baselineYearRule;
    return next;
  });
}

function activeCoverageCount(evidence: RecommendationEvidence[]): number {
  return evidence.filter((entry) => typeof entry.proximity === "number").length;
}

function maxOverlapShare(item: Pick<ScoredLocation, "overlaps">): number {
  const shares = item.overlaps?.map((part) => part.share) ?? [];
  if (shares.length === 0) return 0;
  return Math.max(...shares);
}

function sampleFromEvidence(entry: RecommendationEvidence) {
  if (entry.scope === "inherited") return { niveau: null, trend: null };
  if (entry.kind === "absent" || entry.status === "absent") return { niveau: null, trend: null };
  if (entry.baselineMatch === false) return { niveau: null, trend: null };
  return sampleFromPoints(entry.points ?? [], entry.coverage);
}

function spreadKey(criterionKey: string, level: string): string {
  return `${criterionKey}::${canonicalScoreLevel(level)}`;
}

function pushNumber(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function spreadMap(buckets: Map<string, number[]>, minN: number): Map<string, number | null> {
  const result = new Map<string, number | null>();
  for (const [key, values] of buckets) {
    result.set(key, robustSpread(values, minN));
  }
  return result;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function baselinesMatch(
  left: SeriesBaseline | undefined,
  right: SeriesBaseline | undefined,
): boolean {
  if (!left || !right) return true;
  return left === right;
}

function methodsMatch(left?: BaselineMethod, right?: BaselineMethod): boolean {
  if (!left || !right) return true;
  return left === right;
}

function withoutNormalizedValues(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((point) => {
    if (point.normalizedValue === undefined) return point;
    const next = { ...point };
    delete next.normalizedValue;
    return next;
  });
}

/** Backend-only Entwicklungssatz; empty when no local series trend. */
export function buildHitTrend(evidence: RecommendationEvidence[]): RecommendationTrend {
  const localTrends = evidence.filter(
    (entry) =>
      entry.scope !== "inherited" &&
      entry.kind === "trend" &&
      isSeriesCoverage(entry.coverage) &&
      entry.direction !== "unknown",
  );
  if (localTrends.length === 0) {
    return { direction: "unknown", summary: "" };
  }
  const primary = localTrends.find((entry) => entry.match) ?? localTrends[0]!;
  return {
    direction: primary.direction,
    summary: primary.evidence,
  };
}
