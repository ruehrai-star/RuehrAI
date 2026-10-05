import { PatternCriterion } from "../analysis/types";
import {
  absentEvidence,
  directionFromPoints,
  kindFromCoverage,
  metricIdsForCriterion,
  metricLabel,
  presentPoints,
  seriesEvidence,
} from "../analysis/series-criteria";
import { SeriesPoint, YearlySeries } from "../analysis/yearly-series";
import { AreaCandidate, areaKindRank } from "./area-candidates";
import { RecommendationEvidence, ScoredLocation } from "./types";

/**
 * Rank every Teilfläche against the store-surroundings pattern.
 * Primary score is the share of three-year trend criteria whose direction
 * matches. Stichtag values are labeled, never treated as month-to-month.
 * Missing series stay absent — never 0. Candidates without a match still
 * remain on the list; empty is only "no sub-area".
 */
export function rankTeilflaechen(
  candidates: AreaCandidate[],
  series: YearlySeries[],
  criteria: PatternCriterion[],
): ScoredLocation[] {
  const byGeoKey = groupSeries(series);
  const trendCriteria = criteria.filter((criterion) => isTrendCriterion(criterion));
  const scored: ScoredLocation[] = [];

  for (const candidate of candidates) {
    const local = byGeoKey.get(candidate.geoKey) ?? [];
    const evidence = criteria.map((criterion) => evidenceForCandidate(criterion, local));
    const trendEvidence = evidence.filter((_, index) => isTrendCriterion(criteria[index]!));
    const matched = trendEvidence.filter((entry) => entry.match).length;
    const score = trendCriteria.length === 0 ? 0 : roundScore(matched / trendCriteria.length);
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
    const leftKind = areaKindRank(left.kind ?? "gemeinde");
    const rightKind = areaKindRank(right.kind ?? "gemeinde");
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

function evidenceForCandidate(criterion: PatternCriterion, local: YearlySeries[]): RecommendationEvidence {
  const series = findSeries(criterion, local);
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
      points: [],
    };
  }

  const present = presentPoints(series.points);
  if (present.length === 0) {
    return {
      key: criterion.key,
      label: metricLabel(series.metricId, series.sourceLevel),
      direction: "unknown",
      patternDirection: criterion.direction,
      evidence: absentEvidence(criterion.key, label),
      kind: "absent",
      status: "absent",
      match: false,
      coverage: series.coverage,
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
    evidence: seriesEvidence(series, direction),
    kind,
    status: "present",
    match,
    coverage: series.coverage,
    points: withoutInventedZero(series.points),
  };
}

function findSeries(criterion: PatternCriterion, local: YearlySeries[]): YearlySeries | null {
  const wanted = metricIdsForCriterion(criterion.key);
  for (const id of wanted) {
    const hit = local.find((item) => item.metricId === id && presentPoints(item.points).length > 0);
    if (hit) return hit;
  }
  for (const id of wanted) {
    const hit = local.find((item) => item.metricId === id);
    if (hit) return hit;
  }
  return null;
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
