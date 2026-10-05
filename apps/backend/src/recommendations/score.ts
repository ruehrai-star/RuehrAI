import { PatternCriterion } from "../analysis/types";
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
import { SeriesPoint, YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate, AreaKind, areaKindRank } from "./area-candidates";
import { EvidenceScope, RecommendationEvidence, ScoredLocation } from "./types";

/**
 * Rank every Teilfläche against the store-surroundings pattern.
 * Primary score is the share of **local** three-year trend criteria whose
 * direction matches. Inherited (parent-level) criteria are labeled and do
 * not differentiate siblings. Stichtag values are labeled, never treated as
 * month-to-month. Missing series stay absent — never 0.
 */
export function rankTeilflaechen(
  candidates: AreaCandidate[],
  series: YearlySeries[],
  criteria: PatternCriterion[],
): ScoredLocation[] {
  const byGeoKey = groupSeries(series);
  const scored: ScoredLocation[] = [];

  for (const candidate of candidates) {
    const local = byGeoKey.get(candidate.geoKey) ?? [];
    const evidence = criteria.map((criterion) => evidenceForCandidate(criterion, local, candidate.kind));
    const localTrend = evidence.filter(
      (entry, index) => isTrendCriterion(criteria[index]!) && entry.scope !== "inherited",
    );
    const matched = localTrend.filter((entry) => entry.match).length;
    const score = localTrend.length === 0 ? 0 : roundScore(matched / localTrend.length);
    scored.push({
      id: candidate.id,
      title: candidate.title,
      kind: candidate.kind,
      location: {
        geoKey: candidate.geoKey,
        grain: candidate.grain,
        lon: candidate.lon,
        lat: candidate.lat,
        name: candidate.name,
      },
      score,
      criteriaEvidence: evidence,
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
  return scored;
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
  const label = criterion.label || metricLabel(criterion.key);
  if (!series) {
    return {
      key: criterion.key,
      label,
      direction: "unknown",
      patternDirection: criterion.direction,
      evidence: absentEvidence(criterion.key, label),
      kind: "absent",
      status: "absent",
      match: false,
      coverage: "none",
      scope: "local",
      points: [],
    };
  }

  const scope = evidenceScope(candidateKind, series.sourceLevel);
  const present = presentPoints(series.points);
  if (present.length === 0) {
    return {
      key: criterion.key,
      label: metricLabel(series.metricId, series.sourceLevel),
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
      points: withoutInventedZero(series.points),
    };
  }

  const kind = kindFromCoverage(series.coverage) ?? "stichtag";
  const direction = kind === "stichtag" ? "unknown" : directionFromPoints(series.points);
  const match =
    kind === "trend" &&
    criterion.direction !== "unknown" &&
    direction !== "unknown" &&
    direction === criterion.direction;

  return {
    key: criterion.key,
    label: metricLabel(series.metricId, series.sourceLevel),
    direction,
    patternDirection: criterion.direction,
    evidence: withScopeNote(seriesEvidence(series, direction), scope, series.sourceLevel),
    kind,
    status: "present",
    match,
    coverage: series.coverage,
    scope,
    sourceLevel: series.sourceLevel,
    sourceGeoKey: series.sourceGeoKey,
    points: withoutInventedZero(series.points),
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
    return point;
  });
}

function presentEvidenceCount(evidence: RecommendationEvidence[]): number {
  return evidence.filter((entry) => entry.status === "present" || (!entry.status && entry.kind !== "absent")).length;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
