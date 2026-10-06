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
import { areaGroupKey, hitParentLabel, visibleAreaName } from "./hit-display";
import {
  EvidenceScope,
  RecommendationEvidence,
  RecommendationIntersectionPart,
  RecommendationTrend,
  ScoredLocation,
} from "./types";

export const MAX_RANKED_ITEMS = 200;

/**
 * Rank Teilflächen against the store-surroundings **dataset** pattern.
 * Trends use normalized values (e.g. je 1.000 Einwohner). Inherited
 * parent-level series are labeled and do not differentiate siblings.
 * The listed Fläche is the smallest common hit: finest kind that still
 * has local data for a pattern dataset, grouped so mixed Zielregionen
 * (Berlin Bezirk + Köln PLZ) can coexist.
 */
export function rankTeilflaechen(
  candidates: AreaCandidate[],
  series: YearlySeries[],
  criteria: PatternCriterion[],
  regions: AnalysisRegion[] = [],
): ScoredLocation[] {
  const normalized = attachNormalizedValues(series);
  const hits = selectDatasetHits(candidates, normalized, criteria);
  const byGeoKey = groupSeries(normalized);
  const byGroup = indexByGroup(candidates);
  const scored: ScoredLocation[] = [];

  for (const candidate of hits) {
    const local = byGeoKey.get(candidate.geoKey) ?? [];
    const evidence = criteria.map((criterion) => evidenceForCandidate(criterion, local, candidate.kind));
    const localTrend = evidence.filter(
      (entry, index) => isTrendCriterion(criteria[index]!) && entry.scope !== "inherited",
    );
    const matched = localTrend.filter((entry) => entry.match).length;
    const score = localTrend.length === 0 ? 0 : roundScore(matched / localTrend.length);
    const withBaseline = evidence.map((entry) => ({
      ...entry,
      baselineMatch: entry.baselineMatch ?? baselinesMatch(entry.baseline, criteria.find((c) => c.key === entry.key)?.baseline),
    }));
    const name = visibleAreaName(candidate.name) ?? visibleAreaName(candidate.title);
    const parentLabel = hitParentLabel(candidate, candidates, regions, byGroup);
    const intersectionOf = intersectionParts(candidate, byGroup, byGeoKey, criteria);
    scored.push({
      id: candidate.id,
      title: candidate.title,
      kind: candidate.kind,
      grain: candidate.grain,
      name,
      parentLabel,
      ...(intersectionOf.length >= 2 ? { intersectionOf } : {}),
      location: {
        geoKey: candidate.geoKey,
        grain: candidate.grain,
        lon: candidate.lon,
        lat: candidate.lat,
        name,
      },
      score,
      criteriaEvidence: withBaseline,
      geometry: candidate.geometry ?? null,
      geometryUnavailableReason:
        candidate.geometry
          ? null
          : candidate.geometryUnavailableReason ?? "Die Fläche kann noch nicht gezeichnet werden.",
      trend: buildHitTrend(withBaseline),
    });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftKind = areaKindRank(left.kind);
    const rightKind = areaKindRank(right.kind);
    if (leftKind !== rightKind) return leftKind - rightKind;
    const leftPresent = presentEvidenceCount(left.criteriaEvidence);
    const rightPresent = presentEvidenceCount(right.criteriaEvidence);
    if (rightPresent !== leftPresent) return rightPresent - leftPresent;
    const byTitle = left.title.localeCompare(right.title, "de");
    if (byTitle !== 0) return byTitle;
    return left.id.localeCompare(right.id, "de");
  });
  return scored.slice(0, MAX_RANKED_ITEMS);
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
    const name = visibleAreaName(chosen.name) ?? visibleAreaName(chosen.title);
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

function presentEvidenceCount(evidence: RecommendationEvidence[]): number {
  return evidence.filter((entry) => entry.status === "present" || (!entry.status && entry.kind !== "absent")).length;
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
